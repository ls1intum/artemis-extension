import * as vscode from 'vscode';
import * as assert from 'assert';
import * as sinon from 'sinon';

import type { SessionDetail } from '@shared/types/serverContext';

import { ArtemisApiService } from '@extension/api';
import { ChatWebviewProvider } from '@extension/provider/chatWebviewProvider';
import type { ChatAvailabilityCoordinator } from '@extension/services/iris/chat/chatAvailabilityCoordinator';
import type { ChatNavigationController } from '@extension/services/iris/chat/chatNavigationController';
import type { ChatSendController } from '@extension/services/iris/chat/chatSendController';
import { IrisWebSocketMessageHandler } from '@extension/services/iris/chat/irisWebSocketMessageHandler';
import { IrisRunStateMachine } from '@extension/services/iris/irisRunStateMachine';
import { WorkspaceExerciseTracker } from '@extension/services/workspace/workspaceExerciseTracker';
import { MockExtensionContext } from '@test/unit/mocks/vscodeMocks';

/**
 * Recovery of a run whose terminal frame was missed during a websocket drop.
 *
 * The logic under test is `ChatSendController`'s, but the provider is what
 * builds it against the real conversation service, websocket handler and run
 * machine. So the harness constructs a provider and reaches the controller
 * through it, rather than re-creating that wiring by hand.
 *
 * The live path is `onDidResubscribe` -> `recoverOnResubscribe` ->
 * `IrisConversationService.onSubscriptionActive` (re-read + merge) -> run
 * resolution. The tests call the controller directly, because an event
 * listener's promise cannot be awaited.
 */

interface Harness {
    provider: ChatWebviewProvider;
    api: sinon.SinonStubbedInstance<ArtemisApiService>;
    postSpy: sinon.SinonSpy;
    publishSpy: sinon.SinonSpy;
    sandbox: sinon.SinonSandbox;
}

/** The provider's collaborators, reached through the provider that built them. */
interface ProviderCollaborators {
    _runs: IrisRunStateMachine;
    _availability: ChatAvailabilityCoordinator;
    _navigation: ChatNavigationController;
    _sendController: ChatSendController;
    _websocketMessageHandler: IrisWebSocketMessageHandler;
    _postMessageSafe(message: unknown): void;
}

function parts(provider: ChatWebviewProvider): ProviderCollaborators {
    return provider as unknown as ProviderCollaborators;
}

/**
 * The controller's recovery bookkeeping. White-box on purpose: whether a
 * baseline is open, and which generation it belongs to, has no observable
 * projection, and several tests here are about nothing else.
 */
interface SendControllerInternals {
    _recovery: { generation: number; sessionId: number; baselineMessageId: number } | undefined;
    _lastSendGeneration: number | undefined;
    _sendCoordinator: { send: (input: unknown) => Promise<unknown> } | undefined;
}

function sendInternals(provider: ChatWebviewProvider): SendControllerInternals {
    return parts(provider)._sendController as unknown as SendControllerInternals;
}

function buildHarness(): Harness {
    const sandbox = sinon.createSandbox();
    const leaked = vscode.commands.registerCommand as unknown as { restore?: () => void; isSinonProxy?: boolean };
    if (leaked.isSinonProxy && typeof leaked.restore === 'function') {
        leaked.restore();
    }
    sandbox.stub(vscode.commands, 'registerCommand').returns({ dispose: () => undefined });
    sandbox.stub(vscode.window, 'showErrorMessage');
    sandbox.stub(vscode.window, 'showWarningMessage');

    const mockContext = new MockExtensionContext();
    const api = sinon.createStubInstance(ArtemisApiService);
    // BOTH services, so the conversation is actually constructed: the recovery
    // path does not exist without it.
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
    const courseCatalog = {
        onCoursesLoaded: new vscode.EventEmitter<unknown>().event,
        fetch: async () => undefined,
        projection: () => ({ courses: [], exercises: [] }),
        courseTitle: () => undefined,
        exerciseTitle: () => undefined,
    };
    const sessionIdentity = { state: { kind: 'anonymous', serverKey: 'https://artemis.test' }, epoch: 0 };

    const provider = new ChatWebviewProvider(
        vscode.Uri.file('/tmp'),
        mockContext as unknown as vscode.ExtensionContext,
        api as unknown as ArtemisApiService,
        websocket as never,
        noAi as never,
        registry as never,
        courseCatalog as never,
        undefined,
        new WorkspaceExerciseTracker(),
        { getAccessTimestamp: () => undefined } as never,
        sessionIdentity as never,
    );

    const postSpy = sandbox.spy(parts(provider), '_postMessageSafe');
    const publishSpy = sandbox.spy(parts(provider)._websocketMessageHandler, 'publishCurrentRunUi');

    return { provider, api, postSpy, publishSpy, sandbox };
}

const tick = () => new Promise(resolve => setTimeout(resolve, 5));

function detail(over: Partial<SessionDetail> = {}): SessionDetail {
    return {
        sessionId: 100,
        courseId: 42,
        context: { mode: 'PROGRAMMING_EXERCISE_CHAT', entityId: 5 },
        lastActivity: 0,
        messages: [],
        ...over,
    };
}

/** A persisted assistant answer, as the detail endpoint returns it. */
const answer = (id: number, final = true) => ({
    id,
    sender: 'LLM',
    content: [{ type: 'text', textContent: 'because' }],
    sentAt: '2025-01-01T00:00:00Z',
    final,
});

/** Opens the conversation the whole suite recovers, exactly as production does. */
async function openConversation(h: Harness, sessionId = 100): Promise<void> {
    // The acquisition fires an overview refresh; answer it so the course
    // session list is a real array (an unstubbed sinon method returns
    // undefined, which `setOverview` then stores and every later read trips on).
    h.api.listChatSessionsForCourse.resolves([]);
    h.api.getCurrentChat.resolves(detail({ sessionId }));
    await h.provider.askIrisAbout({ mode: 'PROGRAMMING_EXERCISE_CHAT', entityId: 5 }, 42);
}

/**
 * Stands in for `SendCoordinator`: opens a generation through the same machine
 * the real runLifecycle wrapper uses, records it the way that wrapper does, and
 * reports a persisted message. `supersede` mimics an inbound run opening a
 * newer generation before the POST returns.
 */
function injectSendCoordinator(
    provider: ChatWebviewProvider,
    opts: { messageId?: number; supersede?: boolean },
): void {
    const runs = parts(provider)._runs;
    const inner = sendInternals(provider);
    inner._sendCoordinator = {
        send: async () => {
            const generation = runs.beginGeneration();
            runs.admit({ runId: 'run-send' } as never);
            inner._lastSendGeneration = generation;
            if (opts.supersede) {
                runs.beginGeneration();
                runs.admit({ runId: 'run-inbound' } as never);
            }
            return { kind: 'sent', messageId: opts.messageId };
        },
    };
    const availability = parts(provider)._availability;
    const check = availability.check as unknown as { isSinonProxy?: boolean };
    if (!check.isSinonProxy) {
        sinon.stub(availability, 'check').resolves({ kind: 'enabled' } as never);
    }
}

/** Open a generation and bind it to `runId`, leaving the machine waiting. */
function beginBoundRun(runs: IrisRunStateMachine, runId: string): number {
    const generation = runs.beginGeneration();
    runs.admit({ runId } as never);
    return generation;
}

const mergeCalls = (postSpy: sinon.SinonSpy) =>
    postSpy.getCalls().filter(c => (c.args[0] as { type?: string })?.type === 'mergeSessionMessages');
const runUiCalls = (postSpy: sinon.SinonSpy) =>
    postSpy.getCalls().filter(c => (c.args[0] as { type?: string })?.type === 'updateIrisRunUi');

suite('ChatSendController reconnect recovery', () => {
    let h: Harness;

    setup(() => { h = buildHarness(); });

    teardown(() => {
        h.provider.dispose();
        h.sandbox.restore();
    });

    test('a resubscribe with no outstanding send still re-reads the conversation', async () => {
        await openConversation(h);
        h.api.getChatSessionById.resolves(detail({ sessionId: 100, messages: [answer(99)] as never }));
        h.postSpy.resetHistory();

        await parts(h.provider)._sendController.recoverOnResubscribe(100);
        await tick();

        // The transcript repair is unconditional; only the RUN resolution needs
        // a baseline.
        assert.strictEqual(mergeCalls(h.postSpy).length, 1);
        assert.strictEqual(sendInternals(h.provider)._recovery, undefined);
    });

    test('conclusive history resolves the run and republishes clean run UI', async () => {
        await openConversation(h);
        injectSendCoordinator(h.provider, { messageId: 10 });
        await parts(h.provider)._sendController.send({ text: 'why?', localId: 'l1', sessionId: 100 });
        const runs = parts(h.provider)._runs;
        assert.strictEqual(runs.waiting, true, 'the send must leave the machine waiting');

        // A stale handler-side draft, mirroring the real scenario: PARTIAL
        // frames landed before the socket dropped mid-answer, and a pure
        // disconnect never clears the handler's own projection.
        parts(h.provider)._websocketMessageHandler.handleIrisWebSocketMessage({
            type: 'PARTIAL', runId: 'run-send', partialResult: 'stale partial answer', partialSeq: 1,
        }, 100);
        h.api.getChatSessionById.resolves(detail({ sessionId: 100, messages: [answer(99)] as never }));
        h.postSpy.resetHistory();
        h.publishSpy.resetHistory();

        await parts(h.provider)._sendController.recoverOnResubscribe(100);
        await tick();

        assert.strictEqual(mergeCalls(h.postSpy).length, 1, 'the answer must reach the transcript');
        assert.strictEqual(runs.waiting, false, 'conclusive history must resolve the run');
        assert.ok(h.publishSpy.called, 'run UI must be republished after resolution');
        assert.strictEqual(sendInternals(h.provider)._recovery, undefined, 'the resolved baseline must be cleared');

        const projection = runUiCalls(h.postSpy).at(-1)?.args[0] as { projection?: { draft: unknown; waiting: boolean } };
        assert.strictEqual(projection?.projection?.draft, null, 'the stale partial must not survive as a phantom bubble');
        assert.strictEqual(projection?.projection?.waiting, false);
    });

    test('inconclusive history merges but leaves the run waiting', async () => {
        await openConversation(h);
        injectSendCoordinator(h.provider, { messageId: 10 });
        await parts(h.provider)._sendController.send({ text: 'why?', localId: 'l1', sessionId: 100 });
        // Nothing newer than the baseline: a missed FAILED frame leaves no
        // message, so history can never prove THAT, and guessing would clear an
        // indicator for a run that may still be going.
        h.api.getChatSessionById.resolves(detail({ sessionId: 100, messages: [answer(5)] as never }));
        h.postSpy.resetHistory();

        await parts(h.provider)._sendController.recoverOnResubscribe(100);
        await tick();

        assert.strictEqual(mergeCalls(h.postSpy).length, 1);
        assert.strictEqual(parts(h.provider)._runs.waiting, true);
        assert.ok(sendInternals(h.provider)._recovery, 'the baseline stays open for the next attempt');
    });

    test('a baseline from an older generation resolves nothing', async () => {
        await openConversation(h);
        injectSendCoordinator(h.provider, { messageId: 10 });
        await parts(h.provider)._sendController.send({ text: 'why?', localId: 'l1', sessionId: 100 });
        const runs = parts(h.provider)._runs;
        // B starts and binds its own run: the generation advances, so only the
        // generation guard can catch this.
        beginBoundRun(runs, 'run-B');
        h.api.getChatSessionById.resolves(detail({ sessionId: 100, messages: [answer(99)] as never }));

        await parts(h.provider)._sendController.recoverOnResubscribe(100);
        await tick();

        assert.strictEqual(runs.waiting, true, 'B is still waiting; A must not resolve it');
    });

    test('pendingGeneration (the first frame never arrived) resolves nothing', async () => {
        await openConversation(h);
        const runs = parts(h.provider)._runs;
        // beginGeneration WITHOUT an admitted frame: the run was never bound,
        // so resolveCurrentRun would finalize the wrong one.
        const generation = runs.beginGeneration();
        sendInternals(h.provider)._recovery = { generation, sessionId: 100, baselineMessageId: 10 };
        h.api.getChatSessionById.resolves(detail({ sessionId: 100, messages: [answer(99)] as never }));

        await parts(h.provider)._sendController.recoverOnResubscribe(100);
        await tick();

        assert.strictEqual(runs.waiting, true);
        assert.ok(sendInternals(h.provider)._recovery);
    });

    test('a newer generation starting DURING the re-read aborts the resolve', async () => {
        await openConversation(h);
        injectSendCoordinator(h.provider, { messageId: 10 });
        await parts(h.provider)._sendController.send({ text: 'why?', localId: 'l1', sessionId: 100 });
        const runs = parts(h.provider)._runs;

        let resolveFetch: (v: unknown) => void = () => { /* noop */ };
        h.api.getChatSessionById.returns(new Promise(res => { resolveFetch = res; }) as never);
        const p = parts(h.provider)._sendController.recoverOnResubscribe(100);
        await tick();

        // While the re-read is in flight, B starts and binds.
        beginBoundRun(runs, 'run-B');
        resolveFetch(detail({ sessionId: 100, messages: [answer(99)] as never }));
        await p;
        await tick();

        assert.strictEqual(runs.waiting, true, 'the post-await re-check must abort the resolve');
    });

    test('a same-generation run rebind DURING the re-read aborts the resolve', async () => {
        await openConversation(h);
        injectSendCoordinator(h.provider, { messageId: 10 });
        await parts(h.provider)._sendController.send({ text: 'why?', localId: 'l1', sessionId: 100 });
        const runs = parts(h.provider)._runs;
        const generation = runs.generation;

        let resolveFetch: (v: unknown) => void = () => { /* noop */ };
        h.api.getChatSessionById.returns(new Promise(res => { resolveFetch = res; }) as never);
        const p = parts(h.provider)._sendController.recoverOnResubscribe(100);
        await tick();

        // A late unknown frame rebinds currentRunId within the SAME generation.
        runs.admit({ runId: 'run-C' } as never);
        assert.strictEqual(runs.generation, generation, 'the rebind must not bump the generation');
        resolveFetch(detail({ sessionId: 100, messages: [answer(99)] as never }));
        await p;
        await tick();

        assert.strictEqual(runs.waiting, true, 'history proving the old run finished must not finalize C');
    });

    test('a send opens the baseline for the generation it began, keyed on the conversation', async () => {
        await openConversation(h);
        injectSendCoordinator(h.provider, { messageId: 100 });

        await parts(h.provider)._sendController.send({ text: 'b', localId: 'l2', sessionId: 100 });

        const baseline = sendInternals(h.provider)._recovery;
        assert.strictEqual(baseline?.baselineMessageId, 100);
        assert.strictEqual(baseline?.sessionId, 100, 'the conversation, not a local session id');
        assert.strictEqual(baseline?.generation, parts(h.provider)._runs.generation);
    });

    test('an older POST completing late must not replace the newer baseline', async () => {
        // The coordinator serialises OUR sends, but an inbound run can still
        // open a newer generation, and a late completion must not point
        // recovery at a run it did not start.
        await openConversation(h);
        injectSendCoordinator(h.provider, { messageId: 100 });
        await parts(h.provider)._sendController.send({ text: 'b', localId: 'l2', sessionId: 100 });
        const newer = sendInternals(h.provider)._recovery;

        injectSendCoordinator(h.provider, { messageId: 50, supersede: true });
        await parts(h.provider)._sendController.send({ text: 'a', localId: 'l1', sessionId: 100 });

        assert.deepStrictEqual(sendInternals(h.provider)._recovery, newer, 'the stale POST must not replace it');
    });

    test('a send superseded by a newer generation opens no baseline', async () => {
        await openConversation(h);
        injectSendCoordinator(h.provider, { messageId: 100, supersede: true });

        await parts(h.provider)._sendController.send({ text: 'b', localId: 'l2', sessionId: 100 });

        assert.strictEqual(sendInternals(h.provider)._recovery, undefined);
    });

    test('opening another conversation resets the run machine and clears the baseline', async () => {
        await openConversation(h);
        injectSendCoordinator(h.provider, { messageId: 10 });
        await parts(h.provider)._sendController.send({ text: 'why?', localId: 'l1', sessionId: 100 });
        assert.ok(sendInternals(h.provider)._recovery);

        // A navigation: the outgoing conversation's in-flight run has nothing
        // to do with the one now open.
        h.api.getChatSessionById.resolves(detail({ sessionId: 200 }));
        await parts(h.provider)._navigation.openConversation({ courseId: 42, sessionId: 200 });

        assert.strictEqual(sendInternals(h.provider)._recovery, undefined, 'a navigation must clear the baseline');
        assert.strictEqual(parts(h.provider)._runs.waiting, false, 'and reset the run machine');
    });
});
