import * as vscode from 'vscode';

import { logger } from '@extension/services/loggingService';
import type { TrackedCourse, TrackedExercise } from '@extension/types';

import type { StoredState } from './contextStateTypes';

const STORE_KEY = 'iris.contextStore';
const STORE_VERSION = 3;

/** Retired keys. A store labelled v3 that still carries one is corrupt. */
const RETIRED_KEYS = ['sessions', 'activeContext', 'activeSessionId'] as const;

type LegacyItem = Record<string, unknown> & { id?: unknown; lastViewed?: unknown };

/**
 * Strip fields that no longer exist: `priority` and `lastUpdated`. Pure and
 * module-scoped so the migration has exactly one stripping implementation.
 */
function stripDeprecated(item: LegacyItem): Record<string, unknown> {
    const { priority, lastUpdated, ...rest } = item;
    void priority; void lastUpdated;
    return rest;
}

/**
 * Union two legacy lists by id. `base` (the v1 `all*` list) wins on
 * field conflicts because it tends to carry the richer record. `fallback`
 * fills in missing fields. `lastViewed` becomes the max finite value
 * across both. `priority` and `lastUpdated` are stripped: they no
 * longer exist.
 */
function unionAndStrip(base: LegacyItem[], fallback: LegacyItem[]): Array<Record<string, unknown>> {
    const byId = new Map<number, Record<string, unknown>>();

    for (const item of base) {
        if (typeof item.id !== 'number') { continue; }
        byId.set(item.id, stripDeprecated(item));
    }
    for (const item of fallback) {
        if (typeof item.id !== 'number') { continue; }
        const stripped = stripDeprecated(item);
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

/**
 * Pure migration into v3, from the real v2 shape or from anything older.
 * Exported so it is testable without an ExtensionContext.
 */
export function migrateStoredStateToV3(previous: Record<string, unknown>): StoredState {
    // v2 stores the arrays under their final names. Anything older stores them
    // as `allExercises` + `recentExercises` and `allCourses` + `recentCourses`,
    // and the v2 migration UNIONED each pair. Reading only `allExercises` and
    // `courses` would drop every recent-only exercise and every legacy course
    // for a user upgrading straight from v1, silently and permanently.
    const exercises = Array.isArray(previous['exercises'])
        ? previous['exercises'] as StoredState['exercises']
        : unionAndStrip(
            (previous['allExercises'] as LegacyItem[]) ?? [],
            (previous['recentExercises'] as LegacyItem[]) ?? [],
        ) as unknown as StoredState['exercises'];
    const courses = Array.isArray(previous['courses'])
        ? previous['courses'] as StoredState['courses']
        : unionAndStrip(
            (previous['allCourses'] as LegacyItem[]) ?? [],
            (previous['recentCourses'] as LegacyItem[]) ?? [],
        ) as unknown as StoredState['courses'];
    // Everything else (activeContext, activeSessionId, sessions) is dropped.
    return { version: 3, exercises, courses };
}

/**
 * Light-touch runtime guard for a v3 `StoredState` read out of `globalState`
 * (#183 part C). Validates the top-level shape — version, expected field
 * presence, basic types — but trusts per-element contents of the
 * `exercises` / `courses` collections. Runtime corruption of an already-v3
 * store is exceedingly unlikely (own-process writes only), so per-item
 * validation is not worth its cost; the migrate path is where item shape
 * actually matters.
 *
 * A value that still carries a retired key is rejected rather than trimmed:
 * it means something wrote a v3 version number over a pre-v3 body, and the
 * migration is the only thing allowed to produce a v3 store.
 *
 * Returns `null` on shape failure so `load()` can fall back to
 * `defaultState()` rather than crash on a malformed persisted value.
 */
export function parseStoredState(data: unknown): StoredState | null {
    if (data === null || typeof data !== 'object' || Array.isArray(data)) { return null; }
    const d = data as Record<string, unknown>;
    if (d.version !== STORE_VERSION) { return null; }
    if (RETIRED_KEYS.some(key => key in d)) { return null; }
    if (!Array.isArray(d.exercises)) { return null; }
    if (!Array.isArray(d.courses)) { return null; }
    return {
        version: STORE_VERSION,
        exercises: d.exercises as TrackedExercise[],
        courses: d.courses as TrackedCourse[],
    };
}

export class ContextPersistence {
    constructor(private readonly _context: vscode.ExtensionContext) {}

    public load(): StoredState {
        const raw = this._context.globalState.get<{ version?: number } & Record<string, unknown>>(STORE_KEY);
        if (!raw) { return this.defaultState(); }
        if (raw.version !== STORE_VERSION) {
            const migrated = migrateStoredStateToV3(raw);
            this._context.globalState.update(STORE_KEY, migrated).then(undefined,
                (err: unknown) => logger.error('Failed to persist v3 migration', undefined, err));
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
        return valid;
    }

    public save(state: StoredState): void {
        this._context.globalState.update(STORE_KEY, state).then(undefined,
            (err: unknown) => logger.error('Failed to persist state', undefined, err));
    }

    private defaultState(): StoredState {
        return {
            version: STORE_VERSION,
            exercises: [],
            courses: [],
        };
    }
}
