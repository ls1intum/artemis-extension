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
    version: 2,
    activeContext: null,
    activeSessionId: null,
    exercises: [],
    courses: [],
    sessions: {},
};

suite('parseStoredState — happy paths', () => {
    test('minimal valid v2 store roundtrips', () => {
        assert.deepStrictEqual(parseStoredState(minimal), minimal);
    });

    test('populated store with activeContext + tracked items', () => {
        const populated: StoredState = {
            version: 2,
            activeContext: {
                type: 'exercise', id: 7, title: 'Ex 7',
                source: 'workspace-detected', locked: false, selectedAt: 1700000000000,
            },
            activeSessionId: 'sess-1',
            exercises: [{ id: 7, title: 'Ex 7' }],
            courses: [{ id: 1, title: 'C1' }],
            sessions: { 'exercise:7': [] },
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
        assert.strictEqual(parseStoredState('v2'), null);
        assert.strictEqual(parseStoredState(2), null);
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
        const bad = { ...minimal, version: '2' };
        assert.strictEqual(parseStoredState(bad), null);
    });

    test('rejects non-finite version', () => {
        const bad = { ...minimal, version: NaN };
        assert.strictEqual(parseStoredState(bad), null);
    });

    test('rejects activeContext that is an array (not object | null)', () => {
        const bad = { ...minimal, activeContext: [] };
        assert.strictEqual(parseStoredState(bad), null);
    });

    test('rejects activeContext that is a string (not object | null)', () => {
        const bad = { ...minimal, activeContext: 'exercise:7' };
        assert.strictEqual(parseStoredState(bad), null);
    });

    test('accepts activeContext: null', () => {
        const parsed = parseStoredState({ ...minimal, activeContext: null });
        assert.ok(parsed);
        assert.strictEqual(parsed.activeContext, null);
    });

    test('rejects activeSessionId that is a number', () => {
        const bad = { ...minimal, activeSessionId: 42 };
        assert.strictEqual(parseStoredState(bad), null);
    });

    test('accepts activeSessionId: null', () => {
        const parsed = parseStoredState({ ...minimal, activeSessionId: null });
        assert.ok(parsed);
        assert.strictEqual(parsed.activeSessionId, null);
    });

    test('rejects exercises that is not an array', () => {
        const bad = { ...minimal, exercises: {} };
        assert.strictEqual(parseStoredState(bad), null);
    });

    test('rejects courses that is not an array', () => {
        const bad = { ...minimal, courses: 'all of them' };
        assert.strictEqual(parseStoredState(bad), null);
    });

    test('rejects sessions that is not an object', () => {
        const bad = { ...minimal, sessions: [] };
        assert.strictEqual(parseStoredState(bad), null);
    });

    test('rejects sessions that is null', () => {
        const bad = { ...minimal, sessions: null };
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
        // version === 2 hits the parseStoredState path; an array is rejected
        // as the top-level shape, so load() must return defaultState() rather
        // than crash on undefined.exercises downstream.
        const cp = new ContextPersistence(makeContextWithStoredValue({
            version: 2, exercises: 'not-an-array',
        }));
        const result = cp.load();
        assert.deepStrictEqual(result, {
            version: 2,
            activeContext: null,
            activeSessionId: null,
            exercises: [],
            courses: [],
            sessions: {},
        });
    });

    test('returns the loaded state when persisted value is a valid v2 store', () => {
        // Seed non-null sessions / activeSessionId so the assertion that load()
        // clears them can actually distinguish "cleared" from "already empty".
        const cp = new ContextPersistence(makeContextWithStoredValue({
            version: 2,
            activeContext: null,
            activeSessionId: 'sess-1',
            exercises: [{ id: 7, title: 'Ex 7' }],
            courses: [{ id: 1, title: 'C1' }],
            sessions: { 'exercise:7': [{ id: 'sess-1' }] },
        }));
        const result = cp.load();
        assert.deepStrictEqual(result.exercises, [{ id: 7, title: 'Ex 7' }]);
        assert.deepStrictEqual(result.courses, [{ id: 1, title: 'C1' }]);
        // load() clears sessions / activeSessionId on every call regardless
        // of the persisted value. With non-null seeds above, this assertion
        // proves the clearing behaviour (not just that it stayed empty).
        assert.deepStrictEqual(result.sessions, {});
        assert.strictEqual(result.activeSessionId, null);
    });
});

suite('parseStoredState — trust on inner items (light-touch contract)', () => {
    // Deliberate: the guard does NOT validate per-element TrackedExercise /
    // TrackedCourse / StoredSession shape. The store is written and read by
    // the same process, so the only realistic failure is top-level
    // structural corruption. Documenting the contract here.

    test('accepts exercises with arbitrary item shape (trust)', () => {
        const bad = {
            ...minimal,
            exercises: [{ id: 'not-a-number', title: undefined } as unknown],
        };
        const parsed = parseStoredState(bad);
        assert.ok(parsed, 'light-touch guard accepts malformed inner items');
    });

    test('accepts sessions with arbitrary value shape (trust)', () => {
        const bad = { ...minimal, sessions: { foo: 'not an array' as unknown } };
        const parsed = parseStoredState(bad);
        assert.ok(parsed, 'light-touch guard accepts malformed inner items');
    });
});

// ── migrateStoredStateToV3 (Task 9 prep, consumed by Task 15) ──────────

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

    // The two below assert on the LIVE parser, which only becomes v3 in Task 15.
    // Written now, skipped now, un-skipped there, so the deletion commit has a
    // test waiting for it instead of one written after the fact.
    test.skip('a v3 state round-trips unchanged (un-skip in Task 15)', () => {
        const state = { version: 3, exercises: [], courses: [] };
        assert.deepStrictEqual(parseStoredState(state), state);
    });

    test.skip('parseStoredState rejects a v3 shape that still carries sessions (un-skip in Task 15)', () => {
        assert.strictEqual(parseStoredState({ version: 3, exercises: [], courses: [], sessions: {} }), null);
    });
});
