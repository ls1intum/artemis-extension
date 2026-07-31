import * as vscode from 'vscode';
import * as assert from 'assert';
import * as sinon from 'sinon';

import type { SessionDetail } from '@shared/types/serverContext';

import { ArtemisApiService } from '@extension/api';
import { ChatWebviewProvider } from '@extension/provider/chatWebviewProvider';
import { ContextStore } from '@extension/services/iris/context/contextStore';
import type { TopicChangeOutcome } from '@extension/services/iris/conversation/conversationService';
import { MockExtensionContext } from '@test/unit/mocks/vscodeMocks';

interface Harness {
    provider: ChatWebviewProvider;
    contextStore: ContextStore;
    api: sinon.SinonStubbedInstance<ArtemisApiService>;
    exerciseEvents: number[];
    sandbox: sinon.SinonSandbox;
}

/**
 * Builds a provider with BOTH the API service and a websocket service, which
 * is what makes `_conversation` (and, from Task 14, the send coordinator)
 * actually get constructed. The websocket service is a bare event source: the
 * conversation-first paths never touch anything else on it.
 */
function buildHarness(): Harness {
    const sandbox = sinon.createSandbox();
    sandbox.stub(vscode.commands, 'registerCommand').returns({ dispose: () => undefined });
    sandbox.stub(vscode.window, 'showErrorMessage');
    sandbox.stub(vscode.window, 'showWarningMessage');

    const mockContext = new MockExtensionContext();
    const contextStore = new ContextStore(mockContext);
    const api = sinon.createStubInstance(ArtemisApiService);
    const websocket = {
        onDidChangeConnectionState: new vscode.EventEmitter<{ connected: boolean }>().event,
        isConnected: () => true,
    };
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
        websocket as never,
        noAi as never,
        registry as never,
        courseDataCache as never,
        undefined,
        contextStore,
    );

    const exerciseEvents: number[] = [];
    provider.onDidChangeExerciseContext(({ exerciseId }) => exerciseEvents.push(exerciseId));

    return { provider, contextStore, api, exerciseEvents, sandbox };
}

function detail(over: Partial<SessionDetail> = {}): SessionDetail {
    return {
        sessionId: 1,
        courseId: 42,
        context: { mode: 'PROGRAMMING_EXERCISE_CHAT', entityId: 5 },
        lastActivity: 0,
        messages: [],
        ...over,
    };
}

suite('ChatWebviewProvider: struggle decoupling', () => {
    let h: Harness;

    setup(() => { h = buildHarness(); });
    teardown(() => { h.provider.dispose(); h.sandbox.restore(); });

    test('changing the chat topic does not retarget struggle detection', () => {
        // The provider used to fire _onDidChangeExerciseContext whenever the
        // active chat context became an exercise, pointing the detector at an
        // exercise whose code is not open.
        h.contextStore.registerExercise({ id: 7, title: 'Topic only', courseId: 42 });
        h.contextStore.setActiveContext({
            type: 'exercise', id: 7, title: 'Topic only', courseId: 42,
            source: 'user-selected', locked: false, selectedAt: Date.now(),
        });

        assert.deepStrictEqual(h.exerciseEvents, []);
    });

    test('a workspace detection change does retarget it', () => {
        h.provider.registerWorkspaceExercise({
            id: 5, title: 'BFS', courseId: 42, source: 'workspace-detected', isWorkspace: true,
        });

        assert.deepStrictEqual(h.exerciseEvents, [5]);
    });

    test('the second workspace exercise carries the first as previousExerciseId', () => {
        const previous: Array<number | undefined> = [];
        h.provider.onDidChangeExerciseContext(({ previousExerciseId }) => previous.push(previousExerciseId));

        h.provider.registerWorkspaceExercise({
            id: 5, title: 'BFS', courseId: 42, source: 'workspace-detected', isWorkspace: true,
        });
        h.contextStore.clearWorkspaceFlag();
        h.provider.registerWorkspaceExercise({
            id: 6, title: 'DFS', courseId: 42, source: 'workspace-detected', isWorkspace: true,
        });

        assert.deepStrictEqual(h.exerciseEvents, [5, 6]);
        assert.deepStrictEqual(previous, [undefined, 5]);
    });
});

suite('ChatWebviewProvider: Ask Iris', () => {
    let h: Harness;

    setup(() => { h = buildHarness(); });
    teardown(() => { h.provider.dispose(); h.sandbox.restore(); });

    test('with no conversation open, Ask-Iris acquires one instead of refusing', async () => {
        // The cold-start row of the resolution table. Without the course hint
        // travelling with the target, the service can only answer
        // `rejected: no-course` and the dashboard button is dead on a fresh
        // window, so assert the real outcome, not a recorded call name.
        h.api.getCurrentChat.resolves(detail({ sessionId: 1 }));

        const outcome = await h.provider.askIrisAbout(
            { mode: 'PROGRAMMING_EXERCISE_CHAT', entityId: 5, name: 'BFS' },
            42,
        );

        assert.deepStrictEqual(outcome, { kind: 'opened', sessionId: 1 });
        assert.deepStrictEqual(h.api.getCurrentChat.firstCall.args, ['PROGRAMMING_EXERCISE_CHAT', 5, 42]);
        const conversation = (h.provider as unknown as { _conversation: { state: { snapshot(): { currentSessionId?: number } } } })._conversation;
        assert.strictEqual(conversation.state.snapshot().currentSessionId, 1);
    });

    test('Ask-Iris resolves the course when the payload omits it', async () => {
        h.contextStore.registerExercise({ id: 5, title: 'BFS', courseId: 42 });
        h.api.getCurrentChat.resolves(detail({ sessionId: 1 }));

        await h.provider.askIrisAbout({ mode: 'PROGRAMMING_EXERCISE_CHAT', entityId: 5, name: 'BFS' });

        assert.deepStrictEqual(h.api.getCurrentChat.firstCall.args, ['PROGRAMMING_EXERCISE_CHAT', 5, 42]);
    });

    test('Ask-Iris is rejected while a send is in flight', async () => {
        const conversation = (h.provider as unknown as { _conversation: { state: { beginSend(): void } } })._conversation;
        conversation.state.beginSend();

        const outcome = await h.provider.askIrisAbout(
            { mode: 'PROGRAMMING_EXERCISE_CHAT', entityId: 5, name: 'BFS' },
            42,
        );

        assert.deepStrictEqual(outcome, { kind: 'rejected', reason: 'send-in-flight' });
        assert.strictEqual(h.api.getCurrentChat.callCount, 0);
    });
});

suite('ChatWebviewProvider: reload Iris chat', () => {
    let h: Harness;
    let calls: string[];

    setup(() => {
        h = buildHarness();
        calls = [];
        // A recording double: the point of these two tests is WHICH service
        // calls the command makes, and the real service's `reload` decides
        // internally between reload and start.
        (h.provider as unknown as { _conversation: unknown })._conversation = {
            state: { snapshot: () => ({ currentSessionId: 7, courseId: 42 }) },
            reload: async () => { calls.push('reload'); },
            refreshOverview: async () => { calls.push('refreshOverview'); },
        };
    });
    teardown(() => { h.provider.dispose(); h.sandbox.restore(); });

    test('re-acquires the conversation and refreshes the overview', async () => {
        await h.provider.reloadIrisChat();
        assert.deepStrictEqual(calls, ['reload', 'refreshOverview']);
    });

    test('with no conversation open it re-runs start instead of failing', async () => {
        // The real service's `reload` falls back to `start` when nothing is
        // open, so the command must simply not refuse: it drops the caches and
        // re-reads, and the overview refresh is a no-op without a course.
        const started: string[] = [];
        (h.provider as unknown as { _conversation: unknown })._conversation = {
            state: { snapshot: () => ({ currentSessionId: undefined, courseId: undefined }) },
            reload: async () => { started.push('start'); },
            refreshOverview: async () => { started.push('refreshOverview'); },
        };

        await h.provider.reloadIrisChat();

        assert.strictEqual(started[0], 'start');
    });
});

/**
 * The dispatcher cut-over. A recording double stands in for the conversation
 * service so each test can assert WHICH navigation the host performed, and so
 * the host's own gating can be told apart from the service's internal one
 * (both exist; only the host's is under test here).
 */
interface FakeConversation {
    calls: Array<{ name: string; args?: unknown }>;
    sendInFlight: boolean;
    topicOutcome: TopicChangeOutcome;
    newOutcome: TopicChangeOutcome;
    navigateThrows: boolean;
}

function injectFakeConversation(provider: ChatWebviewProvider): FakeConversation {
    const fake: FakeConversation = {
        calls: [],
        sendInFlight: false,
        topicOutcome: { kind: 'staged' },
        newOutcome: { kind: 'opened', sessionId: 9 },
        navigateThrows: false,
    };
    (provider as unknown as { _conversation: unknown })._conversation = {
        state: {
            get sendInFlight() { return fake.sendInFlight; },
            snapshot: () => ({ currentSessionId: 1, courseId: 42 }),
        },
        resolveTopicChange: async (target: unknown) => {
            fake.calls.push({ name: 'resolveTopicChange', args: target });
            return fake.topicOutcome;
        },
        newConversation: async () => {
            fake.calls.push({ name: 'newConversation' });
            return fake.newOutcome;
        },
        navigateTo: async (params: unknown) => {
            fake.calls.push({ name: 'navigateTo', args: params });
            if (fake.navigateThrows) { throw new Error('gone'); }
        },
        switchCourse: async (courseId: unknown) => {
            fake.calls.push({ name: 'switchCourse', args: courseId });
        },
    };
    return fake;
}

function dispatch(provider: ChatWebviewProvider, command: string, payload?: unknown): void {
    (provider as unknown as { _handleCommand: (m: unknown) => void })
        ._handleCommand({ type: 'command', command, payload });
}

const settle = () => new Promise(resolve => setTimeout(resolve, 0));

function noticesFrom(postSpy: sinon.SinonSpy): string[] {
    return postSpy.getCalls()
        .map(c => c.args[0] as { type?: string; text?: string })
        .filter(m => m?.type === 'showChatNotice')
        .map(m => String(m.text));
}

suite('ChatWebviewProvider: the conversation-first dispatcher', () => {
    let h: Harness;
    let fake: FakeConversation;
    let postSpy: sinon.SinonSpy;

    setup(() => {
        h = buildHarness();
        fake = injectFakeConversation(h.provider);
        postSpy = h.sandbox.spy(h.provider as unknown as { _postMessageSafe: (m: unknown) => void }, '_postMessageSafe');
    });
    teardown(() => { h.provider.dispose(); h.sandbox.restore(); });

    test('selectTopic resolves the topic change', async () => {
        dispatch(h.provider, 'selectTopic', { mode: 'PROGRAMMING_EXERCISE_CHAT', entityId: 7, name: 'BFS' });
        await settle();

        assert.deepStrictEqual(fake.calls, [{
            name: 'resolveTopicChange',
            args: { mode: 'PROGRAMMING_EXERCISE_CHAT', entityId: 7, name: 'BFS' },
        }]);
    });

    test('a topic pick that opened another conversation posts exactly one notice', async () => {
        fake.topicOutcome = { kind: 'opened', sessionId: 12 };

        dispatch(h.provider, 'selectTopic', { mode: 'PROGRAMMING_EXERCISE_CHAT', entityId: 7 });
        await settle();

        assert.deepStrictEqual(noticesFrom(postSpy), ['Switched to a different conversation.']);
    });

    test('a topic pick that only staged posts none: the transcript did not move', async () => {
        fake.topicOutcome = { kind: 'staged' };

        dispatch(h.provider, 'selectTopic', { mode: 'PROGRAMMING_EXERCISE_CHAT', entityId: 7 });
        await settle();

        assert.deepStrictEqual(noticesFrom(postSpy), []);
    });

    test('openConversation navigates by id and explains nothing: the student asked for it', async () => {
        dispatch(h.provider, 'openConversation', { courseId: 42, sessionId: 5 });
        await settle();

        assert.deepStrictEqual(fake.calls, [{ name: 'navigateTo', args: { courseId: 42, sessionId: 5 } }]);
        assert.deepStrictEqual(noticesFrom(postSpy), []);
    });

    test('a failed openConversation surfaces an open error instead of rejecting', async () => {
        fake.navigateThrows = true;

        dispatch(h.provider, 'openConversation', { courseId: 42, sessionId: 5 });
        await settle();

        assert.ok(postSpy.getCalls().some(c => (c.args[0] as { type?: string })?.type === 'openSessionError'));
    });

    test('switchCourse records the course BEFORE acquiring, so the cold-start path sees it', async () => {
        dispatch(h.provider, 'switchCourse', { courseId: 43 });
        await settle();

        assert.strictEqual(h.contextStore.getCurrentCourseId(), 43);
        assert.deepStrictEqual(fake.calls, [{ name: 'switchCourse', args: 43 }]);
    });

    test('newConversation announces the fresh conversation', async () => {
        dispatch(h.provider, 'newConversation');
        await settle();

        assert.deepStrictEqual(fake.calls, [{ name: 'newConversation' }]);
        assert.deepStrictEqual(noticesFrom(postSpy), ['Started a new conversation.']);
    });

    test('every navigation is refused while a send is in flight', async () => {
        fake.sendInFlight = true;

        dispatch(h.provider, 'selectTopic', { mode: 'COURSE_CHAT', entityId: 42 });
        dispatch(h.provider, 'openConversation', { courseId: 42, sessionId: 5 });
        dispatch(h.provider, 'switchCourse', { courseId: 43 });
        dispatch(h.provider, 'newConversation');
        await settle();

        assert.deepStrictEqual(fake.calls, [], 'the host must not reach the service at all');
        assert.deepStrictEqual(noticesFrom(postSpy), []);
    });

    test('the retired commands are no longer answered', async () => {
        const createSpy = h.sandbox.spy(h.provider, 'createNewSession');
        const switchSpy = h.sandbox.spy(h.provider, 'switchToSession');
        const openSpy = h.sandbox.spy(h.provider, 'openArtemisSession');

        dispatch(h.provider, 'createNewSession');
        dispatch(h.provider, 'switchSession', { sessionId: 'local-1' });
        dispatch(h.provider, 'openArtemisSession', { courseId: 42, artemisSessionId: 5 });
        dispatch(h.provider, 'selectChatContext', { context: 'course', itemId: 42, itemName: 'Algorithms' });
        dispatch(h.provider, 'switchToWorkspaceContext');
        await settle();

        assert.strictEqual(createSpy.callCount, 0);
        assert.strictEqual(switchSpy.callCount, 0);
        assert.strictEqual(openSpy.callCount, 0);
        assert.strictEqual(h.contextStore.getActiveContext(), null,
            'a dropped selectChatContext must not change the active context');
    });
});

suite('ChatWebviewProvider: the conversation-first send path', () => {
    let h: Harness;
    let postSpy: sinon.SinonSpy;

    setup(() => {
        h = buildHarness();
        postSpy = h.sandbox.spy(h.provider as unknown as { _postMessageSafe: (m: unknown) => void }, '_postMessageSafe');
        // The availability gate stays in front of the coordinator; it is the
        // only thing that knows about instructor settings.
        h.contextStore.setActiveContext({
            type: 'exercise', id: 5, title: 'BFS', courseId: 42,
            source: 'workspace-detected', locked: false, selectedAt: Date.now(),
        });
        h.sandbox.stub(
            (h.provider as unknown as { _chatSessionService: { checkAndLoadIrisSettings: () => Promise<unknown> } })._chatSessionService,
            'checkAndLoadIrisSettings',
        ).resolves({ kind: 'enabled' } as never);
    });
    teardown(() => { h.provider.dispose(); h.sandbox.restore(); });

    const send = (over: Record<string, unknown> = {}) =>
        (h.provider as unknown as { _handleChatMessage: (m: unknown) => Promise<void> })
            ._handleChatMessage({ text: 'why does this loop?', localId: 'l1', localSessionId: 'local-1', ...over });

    test('a send goes through the coordinator and confirms the bubble in its origin session', async () => {
        h.api.getCurrentChat.resolves(detail({ sessionId: 1 }));
        await h.provider.askIrisAbout({ mode: 'PROGRAMMING_EXERCISE_CHAT', entityId: 5 }, 42);
        h.api.sendChatMessage.resolves({ id: 77, sender: 'USER' } as never);

        await send();

        const confirm = postSpy.getCalls()
            .map(c => c.args[0] as { type?: string; localSessionId?: string; sessionId?: number; id?: number })
            .find(m => m?.type === 'confirmSentMessage');
        assert.ok(confirm, 'the optimistic bubble must be confirmed');
        assert.strictEqual(confirm.id, 77);
        assert.strictEqual(confirm.sessionId, 1, 'addressed to the conversation it was drawn in');
        assert.strictEqual(confirm.localSessionId, 'local-1');
    });

    test('with no conversation to send to, the bubble is failed rather than left hanging', async () => {
        await send();

        const rejected = postSpy.getCalls()
            .map(c => c.args[0] as { type?: string; reason?: string })
            .find(m => m?.type === 'sendRejected');
        assert.ok(rejected, 'a send that cannot be carried must fail its bubble');
        assert.strictEqual(rejected.reason, 'no-conversation');
    });
});
