import * as vscode from 'vscode';
import type { StoredState } from './contextStateTypes';
import type { TrackedExercise, TrackedCourse } from '../../../types';
import { logger } from '../../loggingService';

const STORE_KEY = 'iris.contextStore';
const STORE_VERSION = 2;

type LegacyItem = Record<string, unknown> & { id?: unknown; lastViewed?: unknown };

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
        const valid = raw as unknown as StoredState;
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
