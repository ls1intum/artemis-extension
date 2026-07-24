import * as assert from 'assert';

import { SessionManager } from '@extension/services/iris/context/sessionManager';
import type { ActiveContext, StoredSession } from '@extension/types';

interface SessionState {
    sessions: Record<string, StoredSession[]>;
    activeSessionId: string | null;
}

function makeState(): SessionState {
    return { sessions: {}, activeSessionId: null };
}

function makeManager(state: SessionState, active: ActiveContext | null) {
    return new SessionManager(() => state, () => active, () => {}, () => {});
}

function makeManagerWithFireSpy(state: SessionState, active: ActiveContext | null) {
    const fired: string[][] = [];
    const mgr = new SessionManager(() => state, () => active, () => {}, keys => fired.push(keys));
    return { mgr, fired };
}

suite('SessionManager.upsertSessionFromOverview', () => {
    test('creates once and updates in place on repeat (idempotent by artemisSessionId)', () => {
        const state = makeState();
        const mgr = makeManager(state, { type: 'course', id: 1 } as ActiveContext);

        const id1 = mgr.upsertSessionFromOverview({
            contextKey: 'course:1',
            artemisSessionId: 42,
            title: 'A',
            lastActivity: 100,
        });
        const id2 = mgr.upsertSessionFromOverview({
            contextKey: 'course:1',
            artemisSessionId: 42,
            title: 'B',
            lastActivity: 200,
        });

        assert.strictEqual(id1, id2);
        assert.strictEqual(state.sessions['course:1'].length, 1);
        assert.strictEqual(state.sessions['course:1'][0].title, 'B');
        assert.strictEqual(state.sessions['course:1'][0].lastActivity, 200);
        assert.strictEqual(state.sessions['course:1'][0].id, 'session-42');
    });

    test('preserves the existing title when a later overview entry has none', () => {
        const state = makeState();
        const mgr = makeManager(state, { type: 'course', id: 1 } as ActiveContext);

        mgr.upsertSessionFromOverview({
            contextKey: 'course:1',
            artemisSessionId: 42,
            title: 'A',
            lastActivity: 100,
        });
        mgr.upsertSessionFromOverview({
            contextKey: 'course:1',
            artemisSessionId: 42,
            lastActivity: 200,
        });

        assert.strictEqual(state.sessions['course:1'][0].title, 'A');
        assert.strictEqual(state.sessions['course:1'][0].lastActivity, 200);
    });

    test('creates a new session with messageCount 0 when not found anywhere', () => {
        const state = makeState();
        const mgr = makeManager(state, { type: 'course', id: 1 } as ActiveContext);

        const id = mgr.upsertSessionFromOverview({
            contextKey: 'course:1',
            artemisSessionId: 7,
            lastActivity: 50,
        });

        assert.strictEqual(id, 'session-7');
        const session = state.sessions['course:1'][0];
        assert.strictEqual(session.messageCount, 0);
        assert.strictEqual(session.artemisSessionId, 7);
        assert.strictEqual(session.contextKey, 'course:1');
    });

    test('rehomes a session found under a different context key so switchSession can select it', () => {
        const state = makeState();
        const mgr = makeManager(state, { type: 'exercise', id: 9 } as ActiveContext);

        // Seed under exercise:9
        const seededId = mgr.upsertSessionFromOverview({
            contextKey: 'exercise:9',
            artemisSessionId: 42,
            title: 'Original',
            lastActivity: 100,
        });

        // Now upsert the same artemisSessionId targeting course:1
        const returnedId = mgr.upsertSessionFromOverview({
            contextKey: 'course:1',
            artemisSessionId: 42,
            title: 'Moved',
            lastActivity: 300,
        });

        assert.strictEqual(returnedId, seededId);
        assert.strictEqual(state.sessions['exercise:9'] === undefined || state.sessions['exercise:9'].length === 0, true);
        assert.strictEqual(state.sessions['course:1'].length, 1);
        assert.strictEqual(state.sessions['course:1'][0].id, returnedId);
        assert.strictEqual(state.sessions['course:1'][0].title, 'Moved');
        assert.strictEqual(state.sessions['course:1'][0].contextKey, 'course:1');

        // After setting active context to course:1, switchSession must succeed
        const activeContext: ActiveContext = { type: 'course', id: 1 } as ActiveContext;
        const mgr2 = makeManager(state, activeContext);
        mgr2.switchSession(returnedId);
        assert.strictEqual(state.activeSessionId, returnedId);
    });

    test('collapses pre-existing duplicates of the same artemisSessionId to one', () => {
        const state = makeState();
        state.sessions['course:1'] = [
            {
                id: 'session-42',
                contextKey: 'course:1',
                preview: 'dup1',
                messageCount: 3,
                createdAt: 10,
                lastActivity: 20,
                artemisSessionId: 42,
            },
            {
                id: 'session-42-dup',
                contextKey: 'course:1',
                preview: 'dup2',
                messageCount: 5,
                createdAt: 15,
                lastActivity: 25,
                artemisSessionId: 42,
            },
        ];
        const mgr = makeManager(state, { type: 'course', id: 1 } as ActiveContext);

        const id = mgr.upsertSessionFromOverview({
            contextKey: 'course:1',
            artemisSessionId: 42,
            title: 'Collapsed',
            lastActivity: 999,
        });

        assert.strictEqual(state.sessions['course:1'].length, 1);
        assert.strictEqual(state.sessions['course:1'][0].id, id);
        assert.strictEqual(state.sessions['course:1'][0].title, 'Collapsed');
    });
});

// Task 12: session mutations report the affected context key(s) through the
// `_fireSessionsChanged` callback (mirrors the `_saveState` threading pattern)
// so `ContextStore` can fire `onDidChangeSessions` and the provider can drop
// only the invalidated course(s) from its history cache.
suite('SessionManager session-change notifications', () => {
    test('createSession fires with the active context key', () => {
        const state = makeState();
        const { mgr, fired } = makeManagerWithFireSpy(state, { type: 'course', id: 1 } as ActiveContext);

        mgr.createSession('Hello');

        assert.deepStrictEqual(fired, [['course:1']]);
    });

    test('createSessionWithDetails fires with the active context key', () => {
        const state = makeState();
        const { mgr, fired } = makeManagerWithFireSpy(state, { type: 'exercise', id: 7 } as ActiveContext);

        mgr.createSessionWithDetails('Hello', 0, Date.now());

        assert.deepStrictEqual(fired, [['exercise:7']]);
    });

    test('incrementActiveSessionMessageCount fires with the active context key', () => {
        const state = makeState();
        const { mgr, fired } = makeManagerWithFireSpy(state, { type: 'course', id: 1 } as ActiveContext);
        mgr.createSession('Hello');
        fired.length = 0;

        mgr.incrementActiveSessionMessageCount();

        assert.deepStrictEqual(fired, [['course:1']]);
    });

    test('setActiveSessionMessageCount fires with the active context key', () => {
        const state = makeState();
        const { mgr, fired } = makeManagerWithFireSpy(state, { type: 'course', id: 1 } as ActiveContext);
        mgr.createSession('Hello');
        fired.length = 0;

        mgr.setActiveSessionMessageCount(5);

        assert.deepStrictEqual(fired, [['course:1']]);
    });

    test('does not fire when there is no active context', () => {
        const state = makeState();
        const { mgr, fired } = makeManagerWithFireSpy(state, null);

        mgr.createSession('Hello');
        mgr.incrementActiveSessionMessageCount();
        mgr.setActiveSessionMessageCount(5);

        assert.deepStrictEqual(fired, []);
    });

    test('does not fire when there are no sessions to increment/set', () => {
        const state = makeState();
        const { mgr, fired } = makeManagerWithFireSpy(state, { type: 'course', id: 1 } as ActiveContext);

        mgr.incrementActiveSessionMessageCount();
        mgr.setActiveSessionMessageCount(5);

        assert.deepStrictEqual(fired, []);
    });

    test('updateSessionTitle fires with the key of the context actually holding the session', () => {
        const state = makeState();
        const seedMgr = makeManager(state, { type: 'exercise', id: 9 } as ActiveContext);
        seedMgr.upsertSessionFromOverview({ contextKey: 'exercise:9', artemisSessionId: 42, lastActivity: 100 });

        const { mgr, fired } = makeManagerWithFireSpy(state, null);
        const ok = mgr.updateSessionTitle(42, 'New Title');

        assert.strictEqual(ok, true);
        assert.deepStrictEqual(fired, [['exercise:9']]);
    });

    test('updateSessionTitle does not fire when the session is not found', () => {
        const state = makeState();
        const { mgr, fired } = makeManagerWithFireSpy(state, null);

        const ok = mgr.updateSessionTitle(999, 'New Title');

        assert.strictEqual(ok, false);
        assert.deepStrictEqual(fired, []);
    });

    test('upsertSessionFromOverview fires only the new key when creating fresh (no prior match)', () => {
        const state = makeState();
        const { mgr, fired } = makeManagerWithFireSpy(state, { type: 'course', id: 1 } as ActiveContext);

        mgr.upsertSessionFromOverview({ contextKey: 'course:1', artemisSessionId: 42, lastActivity: 100 });

        assert.deepStrictEqual(fired, [['course:1']]);
    });

    test('upsertSessionFromOverview fires only the new key when updating in place (same key)', () => {
        const state = makeState();
        const { mgr, fired } = makeManagerWithFireSpy(state, { type: 'course', id: 1 } as ActiveContext);

        mgr.upsertSessionFromOverview({ contextKey: 'course:1', artemisSessionId: 42, lastActivity: 100 });
        fired.length = 0;
        mgr.upsertSessionFromOverview({ contextKey: 'course:1', artemisSessionId: 42, title: 'Updated', lastActivity: 200 });

        assert.deepStrictEqual(fired, [['course:1']]);
    });

    test('upsertSessionFromOverview fires BOTH the old and new key when rehoming', () => {
        const state = makeState();
        const { mgr, fired } = makeManagerWithFireSpy(state, { type: 'exercise', id: 9 } as ActiveContext);

        mgr.upsertSessionFromOverview({ contextKey: 'exercise:9', artemisSessionId: 42, lastActivity: 100 });
        fired.length = 0;
        mgr.upsertSessionFromOverview({ contextKey: 'course:1', artemisSessionId: 42, title: 'Moved', lastActivity: 300 });

        assert.deepStrictEqual(fired, [['exercise:9', 'course:1']]);
    });
});

// #364 A0: the refresh transaction needs to read the RAW active-session
// pointer (not the ContextSnapshot.activeSession display fallback, which
// silently substitutes sessions[0]) and to re-select a session by its
// stable artemisSessionId after a local-id-changing re-import.
suite('SessionManager.getActiveArtemisSessionId / selectByArtemisSessionId', () => {
    test('returns undefined when activeSessionId is null, even with sessions present (no display fallback)', () => {
        const state = makeState();
        const active: ActiveContext = { type: 'course', id: 1 } as ActiveContext;
        state.sessions['course:1'] = [
            {
                id: 'session-a', contextKey: 'course:1', preview: 'A',
                messageCount: 1, createdAt: 100, lastActivity: 100, artemisSessionId: 77,
            },
            {
                id: 'session-b', contextKey: 'course:1', preview: 'B',
                messageCount: 1, createdAt: 200, lastActivity: 200, artemisSessionId: 78,
            },
        ];
        state.activeSessionId = null;
        const mgr = makeManager(state, active);

        assert.strictEqual(mgr.getActiveArtemisSessionId(), undefined);
    });

    test('returns the artemisSessionId of the session the raw activeSessionId points at', () => {
        const state = makeState();
        const active: ActiveContext = { type: 'course', id: 1 } as ActiveContext;
        state.sessions['course:1'] = [
            {
                id: 'session-a', contextKey: 'course:1', preview: 'A',
                messageCount: 1, createdAt: 100, lastActivity: 100, artemisSessionId: 77,
            },
            {
                id: 'session-b', contextKey: 'course:1', preview: 'B',
                messageCount: 1, createdAt: 200, lastActivity: 200, artemisSessionId: 78,
            },
        ];
        state.activeSessionId = 'session-a';
        const mgr = makeManager(state, active);

        assert.strictEqual(mgr.getActiveArtemisSessionId(), 77);
    });

    test('returns undefined when activeSessionId does not resolve within the active context', () => {
        const state = makeState();
        const active: ActiveContext = { type: 'course', id: 1 } as ActiveContext;
        state.sessions['course:1'] = [
            {
                id: 'session-a', contextKey: 'course:1', preview: 'A',
                messageCount: 1, createdAt: 100, lastActivity: 100, artemisSessionId: 77,
            },
        ];
        // Points at a session that only exists under a different context.
        state.activeSessionId = 'session-elsewhere';
        const mgr = makeManager(state, active);

        assert.strictEqual(mgr.getActiveArtemisSessionId(), undefined);
    });

    test('returns undefined when there is no active context', () => {
        const state = makeState();
        state.activeSessionId = 'session-a';
        const mgr = makeManager(state, null);

        assert.strictEqual(mgr.getActiveArtemisSessionId(), undefined);
    });

    test('selectByArtemisSessionId sets active to the session carrying that id and returns true', () => {
        const state = makeState();
        const active: ActiveContext = { type: 'course', id: 1 } as ActiveContext;
        state.sessions['course:1'] = [
            {
                id: 'session-77', contextKey: 'course:1', preview: 'A',
                messageCount: 1, createdAt: 100, lastActivity: 100, artemisSessionId: 77,
            },
        ];
        const mgr = makeManager(state, active);

        const ok = mgr.selectByArtemisSessionId(77);

        assert.strictEqual(ok, true);
        assert.strictEqual(state.activeSessionId, 'session-77');
    });

    test('selectByArtemisSessionId returns false and does not change activeSessionId when no session carries that id', () => {
        const state = makeState();
        const active: ActiveContext = { type: 'course', id: 1 } as ActiveContext;
        state.sessions['course:1'] = [
            {
                id: 'session-77', contextKey: 'course:1', preview: 'A',
                messageCount: 1, createdAt: 100, lastActivity: 100, artemisSessionId: 77,
            },
        ];
        state.activeSessionId = 'session-77';
        const mgr = makeManager(state, active);

        const ok = mgr.selectByArtemisSessionId(999);

        assert.strictEqual(ok, false);
        assert.strictEqual(state.activeSessionId, 'session-77');
    });

    test('selectByArtemisSessionId returns false when there is no active context', () => {
        const state = makeState();
        const mgr = makeManager(state, null);

        assert.strictEqual(mgr.selectByArtemisSessionId(77), false);
    });
});
