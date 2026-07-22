import * as vscode from 'vscode';
import * as assert from 'assert';
import * as sinon from 'sinon';

import { ArtemisApiService } from '@extension/api';
import { ChatWebviewProvider } from '@extension/provider/chatWebviewProvider';
import { ContextStore } from '@extension/services/iris/context/contextStore';
import { IrisWebSocketSessionClient } from '@extension/services/iris/transport/irisWebSocketSessionClient';
import { ActiveContext } from '@extension/types';
import { MockExtensionContext } from '@test/unit/mocks/vscodeMocks';

interface Harness {
    provider: ChatWebviewProvider;
    contextStore: ContextStore;
    api: sinon.SinonStubbedInstance<ArtemisApiService>;
    sessionClient: sinon.SinonStubbedInstance<IrisWebSocketSessionClient>;
    postSpy: sinon.SinonSpy;
    sandbox: sinon.SinonSandbox;
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

    // ws service is undefined so the constructor does not create/subscribe a
    // live IrisWebSocketSessionClient; we inject a stubbed one below.
    const provider = new ChatWebviewProvider(
        vscode.Uri.file('/tmp'),
        mockContext as unknown as vscode.ExtensionContext,
        api as unknown as ArtemisApiService,
        undefined,
        noAi as never,
        registry as never,
        courseDataCache as never,
        contextStore,
    );

    const sessionClient = sinon.createStubInstance(IrisWebSocketSessionClient);
    (provider as unknown as { _irisSessionManager: unknown })._irisSessionManager = sessionClient;

    const postSpy = sandbox.spy(provider as unknown as { _postMessageSafe: (m: unknown) => void }, '_postMessageSafe');

    return { provider, contextStore, api, sessionClient, postSpy, sandbox };
}

const tick = () => new Promise(resolve => setTimeout(resolve, 10));

function summary(over: Partial<Record<string, unknown>> & { id: number; entityId: number; mode: string }) {
    return {
        creationDate: '2024-01-01T10:00:00Z',
        ...over,
    } as never;
}

suite('ChatWebviewProvider.openArtemisSession', () => {
    let h: Harness;

    setup(() => {
        h = buildHarness();
    });

    teardown(() => {
        h.provider.dispose();
        h.sandbox.restore();
    });

    test('sets the course context, selects the upserted session, and corrects messageCount after load', async () => {
        h.api.listChatSessionsForCourse.withArgs(3).resolves([
            summary({ id: 42, entityId: 3, mode: 'COURSE_CHAT', entityName: 'My Course', title: 'Earlier chat', lastActivityDate: '2024-02-01T10:00:00Z' }),
        ]);
        h.sessionClient.initializeSession.resolves(42);
        h.api.getChatMessages.withArgs(42).resolves([
            { id: 1, sender: 'USER', content: [{ textContent: 'a' }] },
            { id: 2, sender: 'LLM', content: [{ textContent: 'b' }] },
            { id: 3, sender: 'USER', content: [{ textContent: 'c' }] },
        ] as never);

        await h.provider.openArtemisSession({ courseId: 3, artemisSessionId: 42 });
        await tick();

        const active = h.contextStore.getActiveContext();
        assert.ok(active, 'a context must be active');
        assert.strictEqual(active.type, 'course');
        assert.strictEqual(active.id, 3);

        const snapshot = h.contextStore.snapshot();
        assert.strictEqual(snapshot.activeSession?.artemisSessionId, 42,
            'the upserted session (artemis id 42) must be the active session');
        assert.strictEqual(snapshot.activeSession?.messageCount, 3,
            'messageCount must be corrected to the number of loaded messages');
    });

    test('maps PROGRAMMING_EXERCISE_CHAT to an exercise context keyed on entityId', async () => {
        h.api.listChatSessionsForCourse.withArgs(7).resolves([
            summary({ id: 55, entityId: 88, mode: 'PROGRAMMING_EXERCISE_CHAT', entityName: 'Sorting', title: 'Q' }),
        ]);
        h.sessionClient.initializeSession.resolves(55);
        h.api.getChatMessages.withArgs(55).resolves([] as never);

        await h.provider.openArtemisSession({ courseId: 7, artemisSessionId: 55 });
        await tick();

        const active = h.contextStore.getActiveContext();
        assert.ok(active);
        assert.strictEqual(active.type, 'exercise');
        assert.strictEqual(active.id, 88, 'exercise context id must be the entityId, not the courseId');
        assert.strictEqual(active.courseId, 7);
    });

    test('missing id posts openSessionError and leaves the active context/session unchanged', async () => {
        const initial: ActiveContext = {
            type: 'exercise', id: 99, title: 'Existing', courseId: 3,
            source: 'user-selected', locked: false, selectedAt: Date.now(),
        };
        h.contextStore.setActiveContext(initial);
        h.contextStore.createSession();
        const sessionsBefore = h.contextStore.snapshot().sessions.length;

        h.api.listChatSessionsForCourse.withArgs(3).resolves([
            summary({ id: 1, entityId: 3, mode: 'COURSE_CHAT' }),
        ]);

        await h.provider.openArtemisSession({ courseId: 3, artemisSessionId: 42 });
        await tick();

        assert.ok(
            h.postSpy.getCalls().some(c => (c.args[0] as { type?: string })?.type === 'openSessionError'),
            'openSessionError must be posted when the id is absent from the overview',
        );

        const active = h.contextStore.getActiveContext();
        assert.strictEqual(active?.type, 'exercise');
        assert.strictEqual(active?.id, 99, 'active context must be unchanged');
        assert.strictEqual(h.contextStore.snapshot().sessions.length, sessionsBefore,
            'no session may be created/upserted on a missing-id open');
        assert.ok(!h.contextStore.snapshot().sessions.some(s => s.artemisSessionId === 42),
            'no session for the requested id may exist');
    });

    test('overview fetch failure posts openSessionError and mutates nothing', async () => {
        h.api.listChatSessionsForCourse.withArgs(3).rejects(new Error('network'));

        await h.provider.openArtemisSession({ courseId: 3, artemisSessionId: 42 });
        await tick();

        assert.ok(
            h.postSpy.getCalls().some(c => (c.args[0] as { type?: string })?.type === 'openSessionError'),
            'openSessionError must be posted on a fetch failure',
        );
        assert.strictEqual(h.contextStore.getActiveContext(), null, 'no context may be set on failure');
    });

    test('race: a stale open (A) that resolves after a newer open (B) mutates nothing and posts no error', async () => {
        // A targets course 7 (exercise chat), its overview is held open.
        let resolveA: (v: unknown) => void = () => { /* noop */ };
        h.api.listChatSessionsForCourse.withArgs(7).returns(
            new Promise(res => { resolveA = res; }) as never,
        );
        // B targets course 3 (course chat), resolves immediately.
        h.api.listChatSessionsForCourse.withArgs(3).resolves([
            summary({ id: 99, entityId: 3, mode: 'COURSE_CHAT', entityName: 'Course B' }),
        ]);
        h.sessionClient.initializeSession.resolves(99);
        h.api.getChatMessages.withArgs(99).resolves([] as never);

        // A starts first (captures token, awaits the held overview).
        const pA = h.provider.openArtemisSession({ courseId: 7, artemisSessionId: 55 });
        // B starts second, advancing the token, and completes.
        const pB = h.provider.openArtemisSession({ courseId: 3, artemisSessionId: 99 });
        await pB;
        await tick();

        // Sanity: B won.
        assert.strictEqual(h.contextStore.getActiveContext()?.id, 3);

        h.postSpy.resetHistory();

        // Now A's overview finally resolves. It must detect the stale token.
        resolveA([summary({ id: 55, entityId: 55, mode: 'PROGRAMMING_EXERCISE_CHAT', entityName: 'Ex A' })]);
        await pA;
        await tick();

        const active = h.contextStore.getActiveContext();
        assert.strictEqual(active?.type, 'course', 'B must remain the active context');
        assert.strictEqual(active?.id, 3, 'stale open A must NOT switch to exercise 55');
        assert.ok(!h.contextStore.snapshot().sessions.some(s => s.artemisSessionId === 55),
            'stale open A must NOT upsert its session');
        assert.ok(
            !h.postSpy.getCalls().some(c => (c.args[0] as { type?: string })?.type === 'openSessionError'),
            'stale open A must post NO openSessionError',
        );
    });

    test('race: a context-select advancing the token invalidates an in-flight open', async () => {
        let resolveA: (v: unknown) => void = () => { /* noop */ };
        h.api.listChatSessionsForCourse.withArgs(7).returns(
            new Promise(res => { resolveA = res; }) as never,
        );

        const pA = h.provider.openArtemisSession({ courseId: 7, artemisSessionId: 55 });

        // A user context-select bumps the navigation token (via
        // loadAllSessionsForContext) while A's overview is still pending.
        h.api.getIrisCourseChatSettings.resolves({ settings: { enabled: false } } as never);
        h.provider.setCourseContext(500, 'Picked Course', 'user-selected');
        await tick();

        h.postSpy.resetHistory();

        resolveA([summary({ id: 55, entityId: 55, mode: 'PROGRAMMING_EXERCISE_CHAT', entityName: 'Ex A' })]);
        await pA;
        await tick();

        assert.strictEqual(h.contextStore.getActiveContext()?.id, 500,
            'the user-selected context must win over the stale open');
        assert.ok(!h.contextStore.snapshot().sessions.some(s => s.artemisSessionId === 55),
            'stale open A must NOT upsert its session');
        assert.ok(
            !h.postSpy.getCalls().some(c => (c.args[0] as { type?: string })?.type === 'openSessionError'),
            'stale open A must post NO openSessionError',
        );
    });
});
