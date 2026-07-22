import * as assert from 'assert';
import * as sinon from 'sinon';

import type { IrisChatSession } from '@shared/types/apiResponses';
import type { ActiveContext } from '@shared/types/context';

import { ContextStore } from '@extension/services/iris/context/contextStore';
import { fetchSessionsWithMessages, importSessionsToStore } from '@extension/services/iris/context/sessionSyncUtils';
import { MockExtensionContext } from '@test/unit/mocks/vscodeMocks';

function makeApi(stubs: Partial<Record<string, sinon.SinonStub>> = {}): any {
    return {
        listChatSessionsForCourse: sinon.stub().resolves([]),
        getChatMessages: sinon.stub().resolves([]),
        getExerciseDetails: sinon.stub().rejects(new Error('not stubbed')),
        ...stubs,
    };
}

function makeStore(stubs: Partial<Record<string, sinon.SinonStub>> = {}): any {
    return {
        getExerciseById: sinon.stub().returns(undefined),
        registerExercise: sinon.stub(),
        ...stubs,
    };
}

const exerciseCtx: ActiveContext = {
    type: 'exercise', id: 123, courseId: 42, title: 'E', source: 'user-selected', locked: false, selectedAt: 0,
};
const courseCtx: ActiveContext = {
    type: 'course', id: 42, title: 'C', source: 'user-selected', locked: false, selectedAt: 0,
};

suite('fetchSessionsWithMessages', () => {
    test('filters summaries by mode + entityId before fetching messages', async () => {
        const summaries = [
            { id: 1, entityId: 42, mode: 'COURSE_CHAT',                creationDate: 't1' },
            { id: 2, entityId: 123, mode: 'PROGRAMMING_EXERCISE_CHAT', creationDate: 't2' },
            { id: 3, entityId: 999, mode: 'PROGRAMMING_EXERCISE_CHAT', creationDate: 't3' },
            { id: 4, entityId: 123, mode: 'LECTURE_CHAT',              creationDate: 't4' },
        ];
        const getChatMessages = sinon.stub().resolves([{ id: 100, sender: 'USER' }]);
        const api = makeApi({
            listChatSessionsForCourse: sinon.stub().withArgs(42).resolves(summaries),
            getChatMessages,
        });

        const result = await fetchSessionsWithMessages(api, makeStore(), exerciseCtx);

        assert.strictEqual(result.length, 1);
        assert.strictEqual(result[0].id, 2);
        assert.ok(getChatMessages.calledOnceWith(2));
        assert.ok(getChatMessages.neverCalledWith(1));
        assert.ok(getChatMessages.neverCalledWith(3));
        assert.ok(getChatMessages.neverCalledWith(4));
    });

    test('course context uses its own id as courseId and filters by COURSE_CHAT', async () => {
        const summaries = [
            { id: 10, entityId: 42, mode: 'COURSE_CHAT',                creationDate: 't1' },
            { id: 11, entityId: 7,  mode: 'PROGRAMMING_EXERCISE_CHAT', creationDate: 't2' },
        ];
        const listStub = sinon.stub().resolves(summaries);
        const api = makeApi({ listChatSessionsForCourse: listStub });

        const result = await fetchSessionsWithMessages(api, makeStore(), courseCtx);

        assert.ok(listStub.calledOnceWith(42));
        assert.strictEqual(result.length, 1);
        assert.strictEqual(result[0].id, 10);
    });

    test('resolves courseId from contextStore when context.courseId is missing', async () => {
        const ctx: ActiveContext = { ...exerciseCtx, courseId: undefined };
        const listStub = sinon.stub().resolves([]);
        const store = makeStore({
            getExerciseById: sinon.stub().withArgs(123).returns({ id: 123, title: 'E', courseId: 77 }),
        });
        const api = makeApi({ listChatSessionsForCourse: listStub });

        await fetchSessionsWithMessages(api, store, ctx);

        assert.ok(listStub.calledOnceWith(77));
    });

    test('returns [] when courseId is fully unresolvable', async () => {
        const ctx: ActiveContext = { ...exerciseCtx, courseId: undefined };
        const listStub = sinon.stub().resolves([]);
        const api = makeApi({
            listChatSessionsForCourse: listStub,
            getExerciseDetails: sinon.stub().resolves({}),
        });

        const result = await fetchSessionsWithMessages(api, makeStore(), ctx);

        assert.deepStrictEqual(result, []);
        assert.ok(listStub.notCalled);
    });

    test('per-session fetch failure yields a session with empty messages', async () => {
        const summaries = [
            { id: 1, entityId: 123, mode: 'PROGRAMMING_EXERCISE_CHAT', creationDate: 't1' },
            { id: 2, entityId: 123, mode: 'PROGRAMMING_EXERCISE_CHAT', creationDate: 't2' },
        ];
        const getChatMessages = sinon.stub();
        getChatMessages.withArgs(1).rejects(new Error('boom'));
        getChatMessages.withArgs(2).resolves([{ id: 999, sender: 'USER' }]);
        const api = makeApi({
            listChatSessionsForCourse: sinon.stub().resolves(summaries),
            getChatMessages,
        });

        const result = await fetchSessionsWithMessages(api, makeStore(), exerciseCtx);

        assert.strictEqual(result.length, 2);
        assert.deepStrictEqual(result.find(s => s.id === 1)?.messages, []);
        assert.strictEqual(result.find(s => s.id === 2)?.messages?.length, 1);
    });

    test('copies lastActivityDate from the summary onto the session base', async () => {
        const summaries = [
            { id: 1, entityId: 123, mode: 'PROGRAMMING_EXERCISE_CHAT', creationDate: 't1', lastActivityDate: 'la1' },
        ];
        const api = makeApi({
            listChatSessionsForCourse: sinon.stub().resolves(summaries),
            getChatMessages: sinon.stub().resolves([]),
        });

        const result = await fetchSessionsWithMessages(api, makeStore(), exerciseCtx);

        assert.strictEqual(result[0].lastActivityDate, 'la1');
    });
});

suite('importSessionsToStore', () => {
    function makeContextStore(): ContextStore {
        const store = new ContextStore(new MockExtensionContext() as any);
        store.setActiveContext({
            type: 'exercise', id: 123, title: 'E', source: 'user-selected', locked: false, selectedAt: 0,
        });
        return store;
    }

    function sessionWithMessage(overrides: Partial<IrisChatSession>): IrisChatSession {
        return {
            id: 0,
            messages: [{ sender: 'USER', content: [{ textContent: 'hi' }] }],
            ...overrides,
        };
    }

    test('an older-created session with a newer lastActivityDate is picked as the most recent', () => {
        const contextStore = makeContextStore();
        const sessions: IrisChatSession[] = [
            sessionWithMessage({
                id: 1,
                creationDate: '2026-01-01T00:00:00.000Z',
                lastActivityDate: '2026-06-01T00:00:00.000Z',
            }),
            sessionWithMessage({
                id: 2,
                creationDate: '2026-05-01T00:00:00.000Z',
                lastActivityDate: '2026-01-15T00:00:00.000Z',
            }),
        ];

        importSessionsToStore(sessions, contextStore);
        contextStore.switchToFirstSession();

        const snapshot = contextStore.snapshot();
        assert.strictEqual(snapshot.activeSession?.artemisSessionId, 1);
    });

    test('falls back to creationDate when lastActivityDate is absent', () => {
        const contextStore = makeContextStore();
        const sessions: IrisChatSession[] = [
            sessionWithMessage({ id: 1, creationDate: '2026-01-01T00:00:00.000Z' }),
            sessionWithMessage({ id: 2, creationDate: '2026-05-01T00:00:00.000Z' }),
        ];

        importSessionsToStore(sessions, contextStore);
        contextStore.switchToFirstSession();

        const snapshot = contextStore.snapshot();
        assert.strictEqual(snapshot.activeSession?.artemisSessionId, 2);
    });

    test('falls back to createdAt when lastActivityDate is an invalid date string', () => {
        const contextStore = makeContextStore();
        const sessions: IrisChatSession[] = [
            sessionWithMessage({
                id: 1,
                creationDate: '2026-01-01T00:00:00.000Z',
                lastActivityDate: 'not-a-date',
            }),
            sessionWithMessage({ id: 2, creationDate: '2026-05-01T00:00:00.000Z' }),
        ];

        importSessionsToStore(sessions, contextStore);
        contextStore.switchToFirstSession();

        // session 1's invalid lastActivityDate falls back to its own createdAt
        // (2026-01-01), which is still older than session 2's createdAt (2026-05-01).
        const snapshot = contextStore.snapshot();
        assert.strictEqual(snapshot.activeSession?.artemisSessionId, 2);
    });
});
