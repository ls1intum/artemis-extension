import * as vscode from 'vscode';
import * as assert from 'assert';
import * as sinon from 'sinon';

import { ArtemisApiService } from '@extension/api';
import { ChatWebviewProvider } from '@extension/provider/chatWebviewProvider';
import { ContextStore } from '@extension/services/iris/context/contextStore';
import { IrisWebSocketSessionClient } from '@extension/services/iris/transport/irisWebSocketSessionClient';
import { MockExtensionContext } from '@test/unit/mocks/vscodeMocks';

interface Harness {
    provider: ChatWebviewProvider;
    api: sinon.SinonStubbedInstance<ArtemisApiService>;
    postSpy: sinon.SinonSpy;
    sandbox: sinon.SinonSandbox;
    contextStore: ContextStore;
}

function buildHarness(): Harness {
    const sandbox = sinon.createSandbox();
    sandbox.stub(vscode.commands, 'registerCommand').returns({ dispose: () => undefined });
    sandbox.stub(vscode.window, 'showErrorMessage');
    sandbox.stub(vscode.window, 'showWarningMessage');

    const mockContext = new MockExtensionContext();
    const contextStore = new ContextStore(mockContext);
    const api = sinon.createStubInstance(ArtemisApiService);

    const noAi = {
        isNoAiEnabled: false,
        onNoAiStatusChanged: new vscode.EventEmitter<boolean>().event,
    };
    const registry = { getAllExercises: () => [] };
    const courseDataCache = {
        onCoursesLoaded: new vscode.EventEmitter<unknown>().event,
        fetch: async () => undefined,
    };

    const provider = new ChatWebviewProvider(
        vscode.Uri.file('/tmp'),
        mockContext as unknown as vscode.ExtensionContext,
        api as unknown as ArtemisApiService,
        undefined,
        noAi as never,
        registry as never,
        courseDataCache as never,
        undefined,
        contextStore,
    );

    const sessionClient = sinon.createStubInstance(IrisWebSocketSessionClient);
    (provider as unknown as { _irisSessionManager: unknown })._irisSessionManager = sessionClient;

    const postSpy = sandbox.spy(provider as unknown as { _postMessageSafe: (m: unknown) => void }, '_postMessageSafe');

    return { provider, api, postSpy, sandbox, contextStore };
}

function summary(over: Partial<Record<string, unknown>> & { id: number; entityId: number; mode: string }) {
    return {
        creationDate: '2024-01-01T10:00:00Z',
        ...over,
    } as never;
}

suite('ChatWebviewProvider.requestCourseHistory', () => {
    let h: Harness;

    setup(() => {
        h = buildHarness();
    });

    teardown(() => {
        h.provider.dispose();
        h.sandbox.restore();
    });

    test('overview fetch failure posts courseHistoryError echoing courseId/requestId, and nothing else', async () => {
        h.api.listChatSessionsForCourse.withArgs(3).rejects(new Error('network'));

        await h.provider.requestCourseHistory({ courseId: 3, requestId: 7 });

        const calls = h.postSpy.getCalls().map(c => c.args[0] as { type?: string; courseId?: number; requestId?: number });
        assert.strictEqual(calls.length, 1, 'exactly one message must be posted');
        assert.strictEqual(calls[0].type, 'courseHistoryError');
        assert.strictEqual(calls[0].courseId, 3);
        assert.strictEqual(calls[0].requestId, 7);
    });

    test('a missing ArtemisApiService (Open VSX build) also posts courseHistoryError without throwing', async () => {
        const contextStore = new ContextStore(new MockExtensionContext());
        const noAi = { isNoAiEnabled: false, onNoAiStatusChanged: new vscode.EventEmitter<boolean>().event };
        const registry = { getAllExercises: () => [] };
        const courseDataCache = { onCoursesLoaded: new vscode.EventEmitter<unknown>().event, fetch: async () => undefined };
        const provider = new ChatWebviewProvider(
            vscode.Uri.file('/tmp'),
            new MockExtensionContext() as unknown as vscode.ExtensionContext,
            undefined,
            undefined,
            noAi as never,
            registry as never,
            courseDataCache as never,
            undefined,
            contextStore,
        );
        const postSpy = h.sandbox.spy(provider as unknown as { _postMessageSafe: (m: unknown) => void }, '_postMessageSafe');

        await provider.requestCourseHistory({ courseId: 9, requestId: 1 });

        assert.ok(
            postSpy.getCalls().some(c => (c.args[0] as { type?: string })?.type === 'courseHistoryError'),
        );
        provider.dispose();
    });

    test('success maps the overview through buildCourseHistory and posts updateCourseHistory', async () => {
        h.api.listChatSessionsForCourse.withArgs(3).resolves([
            summary({ id: 42, entityId: 3, mode: 'COURSE_CHAT', title: 'Earlier chat', lastActivityDate: '2024-02-01T10:00:00Z' }),
            summary({ id: 55, entityId: 88, mode: 'PROGRAMMING_EXERCISE_CHAT', entityName: 'Sorting', title: 'Q', lastActivityDate: '2024-03-01T10:00:00Z' }),
            // Excluded modes (lecture/text-exercise chat) must not appear.
            summary({ id: 66, entityId: 5, mode: 'LECTURE_CHAT' }),
        ]);

        await h.provider.requestCourseHistory({ courseId: 3, requestId: 11 });

        const call = h.postSpy.getCalls().find(c => (c.args[0] as { type?: string })?.type === 'updateCourseHistory');
        assert.ok(call, 'updateCourseHistory must be posted');
        const payload = call!.args[0] as { courseId: number; requestId: number; entries: Array<{ artemisSessionId: number }> };
        assert.strictEqual(payload.courseId, 3);
        assert.strictEqual(payload.requestId, 11);
        assert.strictEqual(payload.entries.length, 2, 'lecture chat must be excluded');
        assert.strictEqual(payload.entries[0].artemisSessionId, 55, 'newest lastActivity must sort first');
    });

    test('caches the last successful result per course', async () => {
        h.api.listChatSessionsForCourse.withArgs(3).resolves([
            summary({ id: 42, entityId: 3, mode: 'COURSE_CHAT', title: 'Earlier chat' }),
        ]);

        await h.provider.requestCourseHistory({ courseId: 3, requestId: 1 });

        const cache = (h.provider as unknown as { _courseHistoryCache: Map<number, unknown[]> })._courseHistoryCache;
        assert.ok(cache.has(3));
        assert.strictEqual(cache.get(3)?.length, 1);
    });

    test('a cached course is served from cache without refetching', async () => {
        h.api.listChatSessionsForCourse.withArgs(3).resolves([
            summary({ id: 42, entityId: 3, mode: 'COURSE_CHAT', title: 'Earlier chat' }),
        ]);

        await h.provider.requestCourseHistory({ courseId: 3, requestId: 1 });
        await h.provider.requestCourseHistory({ courseId: 3, requestId: 2 });

        assert.strictEqual(h.api.listChatSessionsForCourse.withArgs(3).callCount, 1, 'second call must be served from cache');
        const call = h.postSpy.getCalls()[1].args[0] as { type?: string; requestId?: number };
        assert.strictEqual(call.type, 'updateCourseHistory');
        assert.strictEqual(call.requestId, 2, 'the requestId of the cache-served call must still be echoed');
    });

    test('a session mutation resolving to course A invalidates only A (Task 12 per-course isolation)', async () => {
        h.api.listChatSessionsForCourse.withArgs(3).resolves([
            summary({ id: 42, entityId: 3, mode: 'COURSE_CHAT', title: 'A chat' }),
        ]);
        h.api.listChatSessionsForCourse.withArgs(5).resolves([
            summary({ id: 43, entityId: 5, mode: 'COURSE_CHAT', title: 'B chat' }),
        ]);

        // Populate both courses' cache entries.
        await h.provider.requestCourseHistory({ courseId: 3, requestId: 1 });
        await h.provider.requestCourseHistory({ courseId: 5, requestId: 2 });

        // A session mutation whose active context resolves to course 3.
        h.contextStore.setActiveContext({
            type: 'course', id: 3, title: 'A', source: 'user-selected', selectedAt: Date.now(), locked: false,
        });
        h.contextStore.createSession('seed');
        h.contextStore.incrementActiveSessionMessageCount();

        // Course 3 must refetch; course 5 must stay cached (no second API call).
        await h.provider.requestCourseHistory({ courseId: 3, requestId: 3 });
        await h.provider.requestCourseHistory({ courseId: 5, requestId: 4 });

        assert.strictEqual(h.api.listChatSessionsForCourse.withArgs(3).callCount, 2, 'course A must refetch after invalidation');
        assert.strictEqual(h.api.listChatSessionsForCourse.withArgs(5).callCount, 1, 'course B must stay cached');
    });

    test('a session mutation on an exercise context resolves to its courseId and invalidates that course only', async () => {
        h.api.listChatSessionsForCourse.withArgs(3).resolves([
            summary({ id: 42, entityId: 3, mode: 'COURSE_CHAT', title: 'A chat' }),
        ]);
        h.api.listChatSessionsForCourse.withArgs(5).resolves([
            summary({ id: 43, entityId: 5, mode: 'COURSE_CHAT', title: 'B chat' }),
        ]);
        await h.provider.requestCourseHistory({ courseId: 3, requestId: 1 });
        await h.provider.requestCourseHistory({ courseId: 5, requestId: 2 });

        h.contextStore.registerExercise({ id: 77, title: 'Ex 77', courseId: 3 });
        h.contextStore.setActiveContext({
            type: 'exercise', id: 77, title: 'Ex 77', source: 'user-selected', selectedAt: Date.now(), locked: false,
        });
        h.contextStore.createSession('seed');

        await h.provider.requestCourseHistory({ courseId: 3, requestId: 3 });
        await h.provider.requestCourseHistory({ courseId: 5, requestId: 4 });

        assert.strictEqual(h.api.listChatSessionsForCourse.withArgs(3).callCount, 2, 'course A must refetch after invalidation via its exercise');
        assert.strictEqual(h.api.listChatSessionsForCourse.withArgs(5).callCount, 1, 'course B must stay cached');
    });

    test('an unresolvable context key clears the whole cache', async () => {
        h.api.listChatSessionsForCourse.withArgs(3).resolves([
            summary({ id: 42, entityId: 3, mode: 'COURSE_CHAT', title: 'A chat' }),
        ]);
        h.api.listChatSessionsForCourse.withArgs(5).resolves([
            summary({ id: 43, entityId: 5, mode: 'COURSE_CHAT', title: 'B chat' }),
        ]);
        await h.provider.requestCourseHistory({ courseId: 3, requestId: 1 });
        await h.provider.requestCourseHistory({ courseId: 5, requestId: 2 });

        // Exercise 88's course is unknown locally (not registered) -> unresolvable.
        h.contextStore.setActiveContext({
            type: 'exercise', id: 88, title: 'Unknown Ex', source: 'user-selected', selectedAt: Date.now(), locked: false,
        });
        h.contextStore.createSession('seed');

        await h.provider.requestCourseHistory({ courseId: 3, requestId: 3 });
        await h.provider.requestCourseHistory({ courseId: 5, requestId: 4 });

        assert.strictEqual(h.api.listChatSessionsForCourse.withArgs(3).callCount, 2, 'course A must refetch, whole cache was cleared');
        assert.strictEqual(h.api.listChatSessionsForCourse.withArgs(5).callCount, 2, 'course B must also refetch, whole cache was cleared');
    });
});
