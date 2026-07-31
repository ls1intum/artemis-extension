import * as vscode from 'vscode';
import * as assert from 'assert';
import * as sinon from 'sinon';

import type { SessionDetail } from '@shared/types/serverContext';
import { localSessionKeyFor } from '@shared/types/serverContext';

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
        getDisplayStatus: () => 'connected',
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
            state: {
                snapshot: () => ({ currentSessionId: 7, courseId: 42 }),
                // The reload re-checks availability, which reads the topic.
                effectiveContext: () => ({ mode: 'COURSE_CHAT', entityId: 42 }),
            },
            reload: async () => { calls.push('reload'); },
            refreshOverview: async () => { calls.push('refreshOverview'); },
        };
        h.sandbox.stub(
            (h.provider as unknown as { _chatSessionService: { checkAndLoadIrisSettings: () => Promise<unknown> } })._chatSessionService,
            'checkAndLoadIrisSettings',
        ).resolves({ kind: 'enabled' } as never);
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
            state: {
                snapshot: () => ({ currentSessionId: undefined, courseId: undefined }),
                effectiveContext: () => undefined,
            },
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
        // The full surface the presenter reads: the provider posts a snapshot
        // on every conversation change now, so a partial double makes
        // postSnapshot throw rather than fail an assertion.
        state: {
            get sendInFlight() { return fake.sendInFlight; },
            snapshot: () => ({ currentSessionId: 1, courseId: 42, courseSessions: [] }),
            displayMessageCount: () => 0,
            contentState: () => 'content',
        },
        navigationInFlight: false,
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

    test('refreshCourses reads the dashboard into the store and re-posts the snapshot', async () => {
        const populate = h.sandbox.stub(
            h.provider as unknown as { _populateAvailableContexts: () => Promise<void> },
            '_populateAvailableContexts',
        ).callsFake(async () => { h.contextStore.registerCourse({ id: 42, title: 'Algorithms' }); });

        dispatch(h.provider, 'refreshCourses');
        await settle();

        assert.strictEqual(populate.callCount, 1);
        const states = postSpy.getCalls()
            .map(c => c.args[0] as { type?: string; state?: { courses: unknown[] } })
            .filter(m => m?.type === 'updateIrisState');
        assert.ok(states.length > 0, 'the refreshed course list must be posted back');
        assert.strictEqual(states.at(-1)?.state?.courses.length, 1);
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
        // The local key is DERIVED from the origin session, not read from
        // provider state, so a navigation during the POST cannot re-address it.
        assert.strictEqual(confirm.localSessionId, localSessionKeyFor(1));
    });

    test('availability is checked against the CONVERSATION, not a stale selected context', async () => {
        // The old active context does not follow a course switch, so validating
        // against it asks Artemis about the previous course's Iris settings.
        h.contextStore.setActiveContext({
            type: 'course', id: 99, title: 'A course we left', courseId: 99,
            source: 'user-selected', locked: false, selectedAt: 0,
        });
        h.api.getCurrentChat.resolves(detail({ sessionId: 1, courseId: 42, context: { mode: 'COURSE_CHAT', entityId: 42 } }));
        await h.provider.askIrisAbout({ mode: 'COURSE_CHAT', entityId: 42 }, 42);
        const check = (h.provider as unknown as {
            _chatSessionService: { checkAndLoadIrisSettings: sinon.SinonStub };
        })._chatSessionService.checkAndLoadIrisSettings;
        check.resetHistory();
        h.api.sendChatMessage.resolves({ id: 77, sender: 'USER' } as never);

        await send();

        assert.strictEqual(check.firstCall.args[0].id, 42, 'the conversation names the course');
        assert.strictEqual(check.firstCall.args[0].type, 'course');
    });

    test('a bubble is addressed from the ORIGIN argument, never from whatever is open now', async () => {
        // White-box on purpose. Navigation is refused mid-send today, so a
        // divergence is not reachable through the public surface; the argument
        // is what keeps this correct when that changes (and it is the whole
        // reason SendDeps passes the origin session in the first place).
        h.api.getCurrentChat.resolves(detail({ sessionId: 1 }));
        await h.provider.askIrisAbout({ mode: 'PROGRAMMING_EXERCISE_CHAT', entityId: 5 }, 42);
        const deps = (h.provider as unknown as { _sendCoordinator: { _deps: {
            confirmBubble: (sessionId: number, localId: string, id: number) => void;
            failBubble: (sessionId: number, localId: string, reason: string) => void;
        } } })._sendCoordinator._deps;

        deps.confirmBubble(7, 'l1', 99);
        deps.failBubble(7, 'l2', 'rate-limit');

        const addressed = postSpy.getCalls()
            .map(c => c.args[0] as { type?: string; localSessionId?: string; sessionId?: number })
            .filter(m => m?.type === 'confirmSentMessage' || m?.type === 'sendRejected');
        assert.strictEqual(addressed.length, 2);
        for (const message of addressed) {
            assert.strictEqual(message.sessionId, 7);
            assert.strictEqual(message.localSessionId, localSessionKeyFor(7));
        }
    });

    test('with no conversation to send to, the bubble is failed rather than left hanging', async () => {
        // No conversation means no course either, so the availability gate is
        // the first to refuse; what matters is that SOMETHING fails the bubble
        // instead of leaving it stuck in `sending` with the indicator spinning.
        await send();

        const rejected = postSpy.getCalls()
            .map(c => c.args[0] as { type?: string; reason?: string; localId?: string })
            .find(m => m?.type === 'sendRejected');
        assert.ok(rejected, 'a send that cannot be carried must fail its bubble');
        assert.strictEqual(rejected.localId, 'l1');
        assert.strictEqual(rejected.reason, 'no-context');
    });
});

suite('ChatWebviewProvider: reload clears the banner that sent you to Retry', () => {
    let h: Harness;
    let postSpy: sinon.SinonSpy;

    setup(() => {
        h = buildHarness();
        postSpy = h.sandbox.spy(h.provider as unknown as { _postMessageSafe: (m: unknown) => void }, '_postMessageSafe');
    });
    teardown(() => { h.provider.dispose(); h.sandbox.restore(); });

    test('a reload re-checks availability and hides both banners when Iris is back', async () => {
        // A reload re-installs the SAME conversation, so the navigation hook
        // (which keys on a session change) cannot clear anything. Without the
        // re-check, `iris-unavailable` shows the banner, disables the composer,
        // and Retry leaves both exactly as they were: the only escape is
        // navigating to a different conversation.
        h.api.listChatSessionsForCourse.resolves([]);
        h.api.getCurrentChat.resolves(detail({ sessionId: 1 }));
        await h.provider.askIrisAbout({ mode: 'PROGRAMMING_EXERCISE_CHAT', entityId: 5 }, 42);
        h.api.getChatSessionById.resolves(detail({ sessionId: 1 }));
        const check = h.sandbox.stub(
            (h.provider as unknown as { _chatSessionService: { checkAndLoadIrisSettings: () => Promise<unknown> } })._chatSessionService,
            'checkAndLoadIrisSettings',
        ).resolves({ kind: 'enabled' } as never);
        postSpy.resetHistory();

        await h.provider.reloadIrisChat();

        assert.strictEqual(check.callCount, 1, 'the reload must re-check availability');
        const types = postSpy.getCalls().map(c => (c.args[0] as { type?: string })?.type);
        assert.ok(types.includes('hideUnavailableState'), 'the unavailable banner must be cleared');
        assert.ok(types.includes('hideDisabledState'));
    });

    test('a reload that still finds Iris unavailable keeps the banner up', async () => {
        h.api.listChatSessionsForCourse.resolves([]);
        h.api.getCurrentChat.resolves(detail({ sessionId: 1 }));
        await h.provider.askIrisAbout({ mode: 'PROGRAMMING_EXERCISE_CHAT', entityId: 5 }, 42);
        h.api.getChatSessionById.resolves(detail({ sessionId: 1 }));
        h.sandbox.stub(
            (h.provider as unknown as { _chatSessionService: { checkAndLoadIrisSettings: () => Promise<unknown> } })._chatSessionService,
            'checkAndLoadIrisSettings',
        ).resolves({ kind: 'unavailable', reason: 'still down' } as never);
        postSpy.resetHistory();

        await h.provider.reloadIrisChat();

        const types = postSpy.getCalls().map(c => (c.args[0] as { type?: string })?.type);
        assert.ok(types.includes('showUnavailableState'), 'a still-broken Iris must keep saying so');
        assert.ok(!types.includes('hideUnavailableState'));
    });
});

suite('ChatWebviewProvider: the conversation owns the transcript', () => {
    let h: Harness;
    let postSpy: sinon.SinonSpy;

    setup(() => {
        h = buildHarness();
        postSpy = h.sandbox.spy(h.provider as unknown as { _postMessageSafe: (m: unknown) => void }, '_postMessageSafe');
    });
    teardown(() => { h.provider.dispose(); h.sandbox.restore(); });

    const loads = () => postSpy.getCalls()
        .map(c => c.args[0] as { type?: string; sessionId?: number; localSessionId?: string; messages?: Array<{ role: string; content: string }> })
        .filter(m => m?.type === 'loadMessages');

    test('an acquired conversation posts its transcript, keyed by the conversation id', async () => {
        h.api.getCurrentChat.resolves(detail({
            sessionId: 1,
            messages: [
                { id: 3, sender: 'USER', content: [{ type: 'text', textContent: 'why?' }], sentAt: '2025-01-01T00:00:00Z' },
                { id: 4, sender: 'LLM', content: [{ type: 'text', textContent: 'because' }], sentAt: '2025-01-01T00:01:00Z' },
            ] as never,
        }));

        await h.provider.askIrisAbout({ mode: 'PROGRAMMING_EXERCISE_CHAT', entityId: 5 }, 42);

        const posted = loads();
        assert.strictEqual(posted.length, 1, 'exactly one transcript per install');
        assert.strictEqual(posted[0].sessionId, 1);
        assert.strictEqual(posted[0].localSessionId, localSessionKeyFor(1));
        assert.deepStrictEqual(posted[0].messages?.map(m => m.role), ['user', 'assistant']);
    });

    test('the snapshot naming the conversation is posted BEFORE its transcript', async () => {
        // The webview keys an incoming transcript on the conversation the
        // snapshot names. A transcript that overtakes its own snapshot is
        // addressed to the conversation the student just left, and is dropped:
        // an empty chat under a correct header.
        h.api.getCurrentChat.resolves(detail({ sessionId: 1, messages: [{ id: 3, sender: 'USER' }] as never }));

        await h.provider.askIrisAbout({ mode: 'PROGRAMMING_EXERCISE_CHAT', entityId: 5 }, 42);

        const posted = postSpy.getCalls().map(c => c.args[0] as { type?: string; state?: { currentSessionId?: number } });
        const transcriptAt = posted.findIndex(m => m?.type === 'loadMessages');
        assert.ok(transcriptAt > 0, 'the transcript must be posted');
        // The snapshot in force when the transcript lands must already name the
        // conversation it belongs to; an earlier snapshot from the same
        // navigation still names the previous one.
        const inForce = posted.slice(0, transcriptAt).filter(m => m?.type === 'updateIrisState').at(-1);
        assert.strictEqual(inForce?.state?.currentSessionId, 1);
    });

    test('a persisted context-swap row is rendered as a divider, not as an assistant bubble', async () => {
        h.api.getCurrentChat.resolves(detail({
            sessionId: 1,
            messages: [{
                id: 3,
                sender: 'CTXSWAP',
                content: [{ type: 'json', attributes: { transition: 'added', entityMode: 'PROGRAMMING_EXERCISE_CHAT', entityId: 5, name: 'BFS' } }],
            }] as never,
        }));

        await h.provider.askIrisAbout({ mode: 'PROGRAMMING_EXERCISE_CHAT', entityId: 5 }, 42);

        const row = loads()[0].messages?.[0];
        assert.strictEqual(row?.role, 'contextSwap');
        assert.strictEqual(row?.content, 'Topic set to BFS');
    });

    test('the old acquisition never runs beside it: one acquisition, one subscription', async () => {
        // An existing installation still has a PERSISTED active context, so the
        // old path is reachable on the very first launch after the cut-over.
        // That is exactly the case that used to acquire a second session.
        h.contextStore.setActiveContext({
            type: 'exercise', id: 5, title: 'BFS', courseId: 42,
            source: 'workspace-detected', locked: false, selectedAt: Date.now(),
        });
        const loadAll = h.sandbox.stub(
            (h.provider as unknown as { _chatSessionService: { loadAllSessionsForContext: () => Promise<void> } })._chatSessionService,
            'loadAllSessionsForContext',
        ).resolves();
        h.api.getCurrentChat.resolves(detail({ sessionId: 1 }));

        await (h.provider as unknown as { _sendInitData: () => Promise<void> })._sendInitData();

        // The old path imports the server's sessions, skips the empty one the
        // conversation model just acquired, creates ANOTHER, resubscribes the
        // socket to it, and leaves the source check dropping every frame.
        assert.strictEqual(loadAll.callCount, 0);
    });

    test('registering courses does not open a conversation behind the cold start', async () => {
        (h.provider as unknown as { _courseDataCache: unknown })._courseDataCache = {
            fetch: async () => ({ courses: [{ course: { id: 42, title: 'Algorithms' } }] }),
        };

        await (h.provider as unknown as { _populateAvailableContexts: () => Promise<void> })._populateAvailableContexts();

        assert.strictEqual(h.contextStore.snapshot().courses.length, 1, 'the picker still gets its list');
        // Auto-select is what used to select a context, which the old
        // acquisition then turned into a real server session while the webview
        // was telling the student there was nothing to talk about.
        assert.strictEqual(h.contextStore.getActiveContext(), null);
        assert.strictEqual(h.api.getCurrentChat.callCount, 0);
    });
});
