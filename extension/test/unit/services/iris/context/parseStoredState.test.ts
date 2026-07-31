/**
 * Unit tests for parseStoredState (#183 part C — light-touch validation
 * at the globalState parse boundary).
 *
 * The store is written and read by the same process so corruption is
 * unlikely; the guard's job is to handle the manual-edit / version-skew
 * case gracefully rather than crashing on `undefined.exercises`.
 */

import * as assert from 'assert';
import type * as vscode from 'vscode';

import { ContextPersistence, migrateStoredStateToV3, parseStoredState } from '@extension/services/iris/context/contextPersistence';
import type { StoredState } from '@extension/services/iris/context/contextStateTypes';

const minimal: StoredState = {
    version: 3,
    exercises: [],
    courses: [],
};

suite('parseStoredState — happy paths', () => {
    test('minimal valid v3 store roundtrips', () => {
        assert.deepStrictEqual(parseStoredState(minimal), minimal);
    });

    test('populated store with tracked items', () => {
        const populated: StoredState = {
            version: 3,
            exercises: [{ id: 7, title: 'Ex 7' }],
            courses: [{ id: 1, title: 'C1' }],
        };
        assert.deepStrictEqual(parseStoredState(populated), populated);
    });
});

suite('parseStoredState — top-level shape rejection', () => {
    test('rejects null', () => {
        assert.strictEqual(parseStoredState(null), null);
    });

    test('rejects undefined', () => {
        assert.strictEqual(parseStoredState(undefined), null);
    });

    test('rejects primitives', () => {
        assert.strictEqual(parseStoredState('v3'), null);
        assert.strictEqual(parseStoredState(3), null);
    });

    test('rejects arrays', () => {
        assert.strictEqual(parseStoredState([]), null);
    });
});

suite('parseStoredState — per-field rejection', () => {
    test('rejects missing version', () => {
        const bad = { ...minimal, version: undefined };
        assert.strictEqual(parseStoredState(bad), null);
    });

    test('rejects non-numeric version', () => {
        const bad = { ...minimal, version: '3' };
        assert.strictEqual(parseStoredState(bad), null);
    });

    test('rejects an older version (that is the migrate path, not this one)', () => {
        assert.strictEqual(parseStoredState({ ...minimal, version: 2 }), null);
    });

    // A v3 version number over a pre-v3 body means something wrote the store
    // without migrating. Trimming would silently bless it, so it is rejected
    // and `load()` falls back to a clean default.
    test('rejects a v3 shape that still carries activeContext', () => {
        assert.strictEqual(parseStoredState({ ...minimal, activeContext: null }), null);
    });

    test('rejects a v3 shape that still carries activeSessionId', () => {
        assert.strictEqual(parseStoredState({ ...minimal, activeSessionId: null }), null);
    });

    test('rejects exercises that is not an array', () => {
        const bad = { ...minimal, exercises: {} };
        assert.strictEqual(parseStoredState(bad), null);
    });

    test('rejects courses that is not an array', () => {
        const bad = { ...minimal, courses: 'all of them' };
        assert.strictEqual(parseStoredState(bad), null);
    });
});

// ── Integration-shaped: load() falls back to defaultState on bad shape ──

/**
 * Minimal ExtensionContext fake exposing only the `globalState.get/update`
 * surface that ContextPersistence reaches into. Returns whatever value the
 * test seeds in, so we can simulate corrupted persistence.
 */
function makeContextWithStoredValue(value: unknown): vscode.ExtensionContext {
    const fake = {
        globalState: {
            get: () => value,
            update: () => Promise.resolve(),
        },
    };
    return fake as unknown as vscode.ExtensionContext;
}

suite('ContextPersistence.load — fallback behaviour', () => {
    test('falls back to defaultState when persisted value is structurally malformed', () => {
        // version === 3 hits the parseStoredState path; a non-array `exercises`
        // is rejected, so load() must return defaultState() rather than crash
        // on undefined.exercises downstream.
        const cp = new ContextPersistence(makeContextWithStoredValue({
            version: 3, exercises: 'not-an-array', courses: [],
        }));
        const result = cp.load();
        assert.deepStrictEqual(result, { version: 3, exercises: [], courses: [] });
    });

    test('returns the loaded state when persisted value is a valid v3 store', () => {
        const cp = new ContextPersistence(makeContextWithStoredValue({
            version: 3,
            exercises: [{ id: 7, title: 'Ex 7' }],
            courses: [{ id: 1, title: 'C1' }],
        }));
        const result = cp.load();
        assert.deepStrictEqual(result, {
            version: 3,
            exercises: [{ id: 7, title: 'Ex 7' }],
            courses: [{ id: 1, title: 'C1' }],
        });
    });

    test('a persisted v2 store migrates on load: tracked items survive, the rest is dropped', () => {
        const cp = new ContextPersistence(makeContextWithStoredValue({
            version: 2,
            activeContext: { type: 'exercise', id: 7, title: 'Ex 7', source: 'user-selected', locked: false, selectedAt: 1 },
            activeSessionId: 'sess-1',
            exercises: [{ id: 7, title: 'Ex 7' }],
            courses: [{ id: 1, title: 'C1' }],
            sessions: { 'exercise:7': [{ id: 'sess-1' }] },
        }));
        assert.deepStrictEqual(cp.load(), {
            version: 3,
            exercises: [{ id: 7, title: 'Ex 7' }],
            courses: [{ id: 1, title: 'C1' }],
        });
    });
});

suite('parseStoredState — trust on inner items (light-touch contract)', () => {
    // Deliberate: the guard does NOT validate per-element TrackedExercise /
    // TrackedCourse shape. The store is written and read by the same process,
    // so the only realistic failure is top-level structural corruption.
    // Documenting the contract here.

    test('accepts exercises with arbitrary item shape (trust)', () => {
        const bad = {
            ...minimal,
            exercises: [{ id: 'not-a-number', title: undefined } as unknown],
        };
        const parsed = parseStoredState(bad);
        assert.ok(parsed, 'light-touch guard accepts malformed inner items');
    });
});

// ── migrateStoredStateToV3 ────────────────────────────────────────────

suite('migrateStoredStateToV3', () => {
    test('the ACTUAL v2 state migrates: tracked items survive, activeContext does not', () => {
        // The baseline is already at STORE_VERSION 2 (contextPersistence.ts:9),
        // so this migration is v2 to v3 and its input is the real v2 shape.
        // Writing it as "v1 to v2" would leave every existing installation on a
        // version the new code believes is current, and the stale activeContext
        // would survive into cold start.
        const migrated = migrateStoredStateToV3({
            version: 2,
            activeContext: { type: 'exercise', id: 5, title: 'BFS', source: 'user-selected', locked: true, selectedAt: 1 },
            activeSessionId: 'local-1',
            sessions: { 'exercise:5': [{ id: 'local-1', contextKey: 'exercise:5', preview: 'x', messageCount: 2, createdAt: 1, lastActivity: 2 }] },
            exercises: [{ id: 5, title: 'BFS', courseId: 42 }],
            courses: [{ id: 42, title: 'EIST' }],
        });
        assert.strictEqual(migrated.version, 3);
        assert.strictEqual(migrated.exercises.length, 1);
        assert.strictEqual(migrated.courses.length, 1);
        assert.ok(!('activeContext' in migrated));
        assert.ok(!('sessions' in migrated));
        assert.ok(!('activeSessionId' in migrated));
    });

    test('a pre-v2 state unions all* with recent*, losing nothing', () => {
        // Reading only `allExercises` and `courses` drops the recent-only
        // exercise and EVERY legacy course. The baseline migration unions both
        // pairs, so this migration must too.
        const migrated = migrateStoredStateToV3({
            version: 1,
            allExercises: [{ id: 5, title: 'BFS', courseId: 42, priority: 3 }],
            recentExercises: [{ id: 6, title: 'DFS', courseId: 42, lastViewed: 99 }],
            allCourses: [{ id: 42, title: 'EIST' }],
            recentCourses: [{ id: 43, title: 'PSE' }],
        });
        assert.strictEqual(migrated.version, 3);
        assert.deepStrictEqual(migrated.exercises.map((e) => e.id).sort(), [5, 6]);
        assert.deepStrictEqual(migrated.courses.map((c) => c.id).sort(), [42, 43]);
        assert.ok(!('priority' in migrated.exercises[0]));
    });

    // These two assert on the LIVE parser, which is v3 from this commit on.
    test('a v3 state round-trips unchanged', () => {
        const state = { version: 3, exercises: [], courses: [] };
        assert.deepStrictEqual(parseStoredState(state), state);
    });

    test('parseStoredState rejects a v3 shape that still carries sessions', () => {
        assert.strictEqual(parseStoredState({ version: 3, exercises: [], courses: [], sessions: {} }), null);
    });
});
