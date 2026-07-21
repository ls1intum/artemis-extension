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
    return new SessionManager(() => state, () => active, () => {});
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
