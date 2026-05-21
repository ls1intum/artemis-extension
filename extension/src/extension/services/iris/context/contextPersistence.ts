import * as vscode from 'vscode';

import { logger } from '@extension/services/loggingService';
import type { TrackedCourse, TrackedExercise } from '@extension/types';

import type { StoredState } from './contextStateTypes';

const STORE_KEY = 'iris.contextStore';
const STORE_VERSION = 2;

type LegacyItem = Record<string, unknown> & { id?: unknown; lastViewed?: unknown };

/**
 * Light-touch runtime guard for a v2 `StoredState` read out of `globalState`
 * (#183 part C). Validates the top-level shape — version, expected field
 * presence, basic types — but trusts per-element contents of the
 * `exercises` / `courses` / `sessions` collections. The migrate path is
 * the only place per-item validation matters; runtime corruption of an
 * already-v2 store is exceedingly unlikely (own-process writes only) so
 * the cost/benefit of strict per-item validation here is not worth it.
 *
 * Returns `null` on shape failure so `load()` can fall back to
 * `defaultState()` rather than crash on a malformed persisted value.
 */
export function parseStoredState(data: unknown): StoredState | null {
    if (data === null || typeof data !== 'object' || Array.isArray(data)) { return null; }
    const d = data as Record<string, unknown>;
    if (typeof d.version !== 'number' || !Number.isFinite(d.version)) { return null; }
    if (d.activeContext !== null && (typeof d.activeContext !== 'object' || Array.isArray(d.activeContext))) {
        return null;
    }
    if (d.activeSessionId !== null && typeof d.activeSessionId !== 'string') { return null; }
    if (!Array.isArray(d.exercises)) { return null; }
    if (!Array.isArray(d.courses)) { return null; }
    if (d.sessions === null || typeof d.sessions !== 'object' || Array.isArray(d.sessions)) { return null; }
    return {
        version: d.version,
        activeContext: d.activeContext as StoredState['activeContext'],
        activeSessionId: d.activeSessionId as string | null,
        exercises: d.exercises as TrackedExercise[],
        courses: d.courses as TrackedCourse[],
        sessions: d.sessions as StoredState['sessions'],
    };
}

export class ContextPersistence {
    constructor(private readonly _context: vscode.ExtensionContext) {}

    public load(): StoredState {
        const raw = this._context.globalState.get<{ version?: number } & Record<string, unknown>>(STORE_KEY);
        if (!raw) { return this.defaultState(); }
        if (raw.version !== STORE_VERSION) {
            const migrated = this.migrate(raw);
            this._context.globalState.update(STORE_KEY, migrated).then(undefined,
                (err: unknown) => logger.error('Failed to persist v2 migration', undefined, err));
            return migrated;
        }
        const valid = parseStoredState(raw);
        if (!valid) {
            // Persisted store had the correct version but was structurally
            // malformed (manual edit, corruption). Fall back to a clean
            // default rather than crash on `undefined.exercises` downstream.
            logger.error('Malformed iris.contextStore — falling back to default state');
            return this.defaultState();
        }
        return { ...valid, sessions: {}, activeSessionId: null };
    }

    public save(state: StoredState): void {
        const stateToPersist: StoredState = {
            ...state,
            sessions: {},
            activeSessionId: null,
        };
        this._context.globalState.update(STORE_KEY, stateToPersist).then(undefined,
            (err: unknown) => logger.error('Failed to persist state', undefined, err));
    }

    private migrate(previous: { version?: number } & Record<string, unknown>): StoredState {
        const allEx = (previous['allExercises'] as LegacyItem[] | undefined) ?? [];
        const recEx = (previous['recentExercises'] as LegacyItem[] | undefined) ?? [];
        const allCo = (previous['allCourses'] as LegacyItem[] | undefined) ?? [];
        const recCo = (previous['recentCourses'] as LegacyItem[] | undefined) ?? [];

        return {
            version: STORE_VERSION,
            activeContext: (previous['activeContext'] as StoredState['activeContext']) ?? null,
            activeSessionId: null,
            exercises: this._unionAndStrip(allEx, recEx) as unknown as TrackedExercise[],
            courses: this._unionAndStrip(allCo, recCo) as unknown as TrackedCourse[],
            sessions: {},
        };
    }

    /**
     * Union two legacy lists by id. `base` (the v1 `all*` list) wins on
     * field conflicts because it tends to carry the richer record. `fallback`
     * fills in missing fields. `lastViewed` becomes the max finite value
     * across both. `priority` and `lastUpdated` are stripped — they no
     * longer exist in v2.
     */
    private _unionAndStrip(base: LegacyItem[], fallback: LegacyItem[]): Array<Record<string, unknown>> {
        const byId = new Map<number, Record<string, unknown>>();

        for (const item of base) {
            if (typeof item.id !== 'number') { continue; }
            byId.set(item.id, this._stripDeprecated(item));
        }
        for (const item of fallback) {
            if (typeof item.id !== 'number') { continue; }
            const stripped = this._stripDeprecated(item);
            const existing = byId.get(item.id);
            if (!existing) {
                byId.set(item.id, stripped);
                continue;
            }
            for (const [k, v] of Object.entries(stripped)) {
                if (existing[k] === undefined && v !== undefined) {
                    existing[k] = v;
                }
            }
            const a = typeof existing.lastViewed === 'number' && Number.isFinite(existing.lastViewed) ? existing.lastViewed : -Infinity;
            const b = typeof stripped.lastViewed === 'number' && Number.isFinite(stripped.lastViewed) ? stripped.lastViewed : -Infinity;
            const max = Math.max(a, b);
            if (Number.isFinite(max)) {
                existing.lastViewed = max;
            } else {
                delete existing.lastViewed;
            }
        }
        return Array.from(byId.values());
    }

    private _stripDeprecated(item: LegacyItem): Record<string, unknown> {
        const { priority, lastUpdated, ...rest } = item;
        void priority; void lastUpdated;
        return rest;
    }

    private defaultState(): StoredState {
        return {
            version: STORE_VERSION,
            activeContext: null,
            activeSessionId: null,
            exercises: [],
            courses: [],
            sessions: {},
        };
    }
}
