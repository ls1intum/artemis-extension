import * as vscode from 'vscode';
import * as assert from 'assert';
import * as sinon from 'sinon';

import { ArtemisApiService } from '@extension/api';
import { ChatWebviewProvider } from '@extension/provider/chatWebviewProvider';
import { IrisChatSessionService } from '@extension/services/iris/chat/chatSessionService';
import { IrisWebSocketMessageHandler } from '@extension/services/iris/chat/irisWebSocketMessageHandler';
import { ContextStore } from '@extension/services/iris/context/contextStore';
import { IrisRunStateMachine } from '@extension/services/iris/irisRunStateMachine';
import { IrisWebSocketSessionClient } from '@extension/services/iris/transport/irisWebSocketSessionClient';
import { ActiveContext } from '@extension/types';
import { MockExtensionContext } from '@test/unit/mocks/vscodeMocks';

/**
 * Task 8: generation-scoped reconnect reconciliation wired into the provider.
 *
 * These tests exercise `_reconcileOnResubscribe` and the marker-open branch of
 * `_handleChatMessage` directly against the real `IrisRunStateMachine`,
 * `ContextStore` and `IrisWebSocketMessageHandler` the provider constructs.
 * The websocket service is left undefined (matching the sibling provider test
 * harnesses), so `onDidResubscribe` is not subscribed through the constructor;
 * we drive the private reconcile entrypoint that the subscription would call.
 */

interface Harness {
    provider: ChatWebviewProvider;
    contextStore: ContextStore;
    api: sinon.SinonStubbedInstance<ArtemisApiService>;
    sessionClient: sinon.SinonStubbedInstance<IrisWebSocketSessionClient>;
    postSpy: sinon.SinonSpy;
    fetchStub: sinon.SinonStub;
    publishSpy: sinon.SinonSpy;
    sandbox: sinon.SinonSandbox;
    setCurrentSessionId: (id: number | undefined) => void;
}

// Private surface we reach into. Casting once here keeps the tests readable
// without sprinkling `as any` everywhere.
interface ProviderInternals {
    _runs: IrisRunStateMachine;
    _reconcileMarker: unknown;
    _reconcileOnResubscribe: (sessionId: number) => Promise<void>;
    _handleChatMessage: (m: { text?: string; localId?: string; localSessionId?: string }) => Promise<void>;
    _chatSessionService: IrisChatSessionService;
    _chatMessageService: { sendMessage: (input: unknown) => Promise<unknown> };
    _websocketMessageHandler: IrisWebSocketMessageHandler;
}

function internals(provider: ChatWebviewProvider): ProviderInternals {
    return provider as unknown as ProviderInternals;
}

function buildHarness(): Harness {
    const sandbox = sinon.createSandbox();
    // A preceding unit-test suite in the aggregate run sometimes crashes before
    // restoring its sandbox, leaving registerCommand wrapped. Restore a leaked
    // wrapper first so our own stub can attach and be cleaned up in teardown.
    const leaked = vscode.commands.registerCommand as unknown as { restore?: () => void; isSinonProxy?: boolean };
    if (leaked.isSinonProxy && typeof leaked.restore === 'function') {
        leaked.restore();
    }
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

    // ws service undefined => the constructor does not build/subscribe a live
    // IrisWebSocketSessionClient; we inject a stubbed one below.
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
    let currentSessionId: number | undefined;
    Object.defineProperty(sessionClient, 'currentSessionId', {
        get: () => currentSessionId,
        configurable: true,
    });
    (provider as unknown as { _irisSessionManager: unknown })._irisSessionManager = sessionClient;

    const postSpy = sandbox.spy(provider as unknown as { _postMessageSafe: (m: unknown) => void }, '_postMessageSafe');
    const fetchStub = sandbox.stub(internals(provider)._chatSessionService, 'fetchActiveSessionHistory');
    const publishSpy = sandbox.spy(internals(provider)._websocketMessageHandler, 'publishCurrentRunUi');

    return {
        provider,
        contextStore,
        api,
        sessionClient,
        postSpy,
        fetchStub,
        publishSpy,
        sandbox,
        setCurrentSessionId: (id) => { currentSessionId = id; },
    };
}

const tick = () => new Promise(resolve => setTimeout(resolve, 5));

function context(id: number): ActiveContext {
    return {
        type: 'course', id, title: `Course ${id}`, courseId: id,
        source: 'user-selected', locked: false, selectedAt: Date.now(),
    };
}

/**
 * Establish an active session with the given artemis id and return its local
 * session id (`activeSession.id`). Uses the idempotent overview upsert so the
 * session survives the cleanup pass inside switchSession.
 */
function activateSession(contextStore: ContextStore, courseId: number, artemisSessionId: number): string {
    contextStore.setActiveContext(context(courseId));
    const localId = contextStore.upsertSessionFromOverview({
        contextKey: `course:${courseId}`,
        artemisSessionId,
        lastActivity: Date.now(),
    });
    contextStore.switchSession(localId);
    return localId;
}

/** Open a generation and bind it to `runId`. Leaves the machine waiting with
 *  pendingGeneration=false (a frame arrived). Returns the generation id. */
function beginBoundRun(runs: IrisRunStateMachine, runId: string): number {
    const generation = runs.beginGeneration();
    runs.admit({ runId } as never);
    return generation;
}

function assistant(id: number, over: Partial<{ final: boolean }> = {}) {
    return { id, role: 'assistant' as const, content: 'a', timestamp: Date.now(), final: true, ...over };
}

const mergeCalls = (postSpy: sinon.SinonSpy) =>
    postSpy.getCalls().filter(c => (c.args[0] as { type?: string })?.type === 'mergeSessionMessages');
const confirmCalls = (postSpy: sinon.SinonSpy) =>
    postSpy.getCalls().filter(c => (c.args[0] as { type?: string })?.type === 'confirmSentMessage');

suite('ChatWebviewProvider reconnect reconciliation', () => {
    let h: Harness;

    setup(() => {
        h = buildHarness();
    });

    teardown(() => {
        h.provider.dispose();
        h.sandbox.restore();
    });

    test('initial subscribe with no marker => no fetch', async () => {
        activateSession(h.contextStore, 5, 42);
        beginBoundRun(internals(h.provider)._runs, 'run-A');
        // No marker was ever opened.
        assert.strictEqual(internals(h.provider)._reconcileMarker, undefined);

        await internals(h.provider)._reconcileOnResubscribe(42);

        assert.strictEqual(h.fetchStub.callCount, 0, 'a resubscribe without a marker must not fetch');
    });

    test('run A marker (gen G) cannot reconcile once B started (gen G+1), gate fails', async () => {
        const runs = internals(h.provider)._runs;
        activateSession(h.contextStore, 5, 42);
        const genA = beginBoundRun(runs, 'run-A');
        internals(h.provider)._reconcileMarker = {
            generation: genA, localSessionId: 'session-42', artemisSessionId: 42, baselineMessageId: 10,
        };
        // B starts and binds its own run: generation advances to G+1, pending
        // is false again so only the generation-mismatch guard can catch this.
        beginBoundRun(runs, 'run-B');
        assert.strictEqual(runs.pendingGeneration, false);
        assert.strictEqual(runs.generation, genA + 1);

        await internals(h.provider)._reconcileOnResubscribe(42);

        assert.strictEqual(h.fetchStub.callCount, 0, 'stale-generation marker must not fetch');
    });

    test('reconciliation for A completing after B starts cannot resolve or merge (post-await re-check)', async () => {
        const runs = internals(h.provider)._runs;
        activateSession(h.contextStore, 5, 42);
        const genA = beginBoundRun(runs, 'run-A');
        internals(h.provider)._reconcileMarker = {
            generation: genA, localSessionId: 'session-42', artemisSessionId: 42, baselineMessageId: 10,
        };

        let resolveFetch: (v: unknown) => void = () => { /* noop */ };
        h.fetchStub.onFirstCall().returns(new Promise(res => { resolveFetch = res; }) as never);

        // Passes the pre-fetch gate, then parks on the await.
        const p = internals(h.provider)._reconcileOnResubscribe(42);
        await tick();
        assert.strictEqual(h.fetchStub.callCount, 1, 'fetch must have started');

        // While the fetch is in flight, B starts and binds, generation advances.
        beginBoundRun(runs, 'run-B');

        // The fetch now returns conclusive history for A. The post-await
        // re-validation must still abort: neither merge nor resolve.
        resolveFetch([assistant(99)]);
        await p;
        await tick();

        assert.strictEqual(mergeCalls(h.postSpy).length, 0, 'stale fetch must not merge into the webview');
        assert.strictEqual(runs.waiting, true, 'B is still waiting; A must not resolve it');
        assert.ok(internals(h.provider)._reconcileMarker, 'marker must not be cleared by the aborted reconcile');
    });

    test('gen 2 POST resolves before gen 1: gen 1 late completion does not replace/clear gen 2 marker (but still confirms its bubble)', async () => {
        const runs = internals(h.provider)._runs;
        activateSession(h.contextStore, 5, 42);
        h.setCurrentSessionId(42);
        // Drive the machine to generation 2, waiting.
        beginBoundRun(runs, 'run-1');
        beginBoundRun(runs, 'run-2');
        assert.strictEqual(runs.generation, 2);

        const sendStub = h.sandbox.stub(internals(h.provider)._chatMessageService, 'sendMessage');
        sendStub.onFirstCall().resolves({ sent: true, sentMessageId: 100, generation: 2 });
        sendStub.onSecondCall().resolves({ sent: true, sentMessageId: 50, generation: 1 });

        // gen 2's POST returns first and opens the marker.
        await internals(h.provider)._handleChatMessage({ text: 'b', localId: 'l2', localSessionId: 'session-42' });
        const markerAfterGen2 = internals(h.provider)._reconcileMarker as { generation: number; baselineMessageId: number };
        assert.strictEqual(markerAfterGen2.generation, 2);
        assert.strictEqual(markerAfterGen2.baselineMessageId, 100);

        // gen 1's POST returns late. It must NOT overwrite the newer marker...
        await internals(h.provider)._handleChatMessage({ text: 'a', localId: 'l1', localSessionId: 'session-42' });
        const markerAfterGen1 = internals(h.provider)._reconcileMarker as { generation: number; baselineMessageId: number };
        assert.strictEqual(markerAfterGen1.generation, 2, 'gen 1 must not replace the gen 2 marker');
        assert.strictEqual(markerAfterGen1.baselineMessageId, 100, 'gen 2 baseline must survive');

        // ...but its optimistic bubble is still confirmed, independent of the marker.
        const confirms = confirmCalls(h.postSpy);
        assert.ok(confirms.some(c => (c.args[0] as { id?: number }).id === 100), 'gen 2 bubble confirmed');
        assert.ok(confirms.some(c => (c.args[0] as { id?: number }).id === 50), 'gen 1 bubble still confirmed');
    });

    test('same-generation run rebind (A -> C) during fetch aborts resolution (currentRunId re-check)', async () => {
        const runs = internals(h.provider)._runs;
        activateSession(h.contextStore, 5, 42);
        const genA = beginBoundRun(runs, 'run-A');
        internals(h.provider)._reconcileMarker = {
            generation: genA, localSessionId: 'session-42', artemisSessionId: 42, baselineMessageId: 10,
        };

        let resolveFetch: (v: unknown) => void = () => { /* noop */ };
        h.fetchStub.onFirstCall().returns(new Promise(res => { resolveFetch = res; }) as never);

        const p = internals(h.provider)._reconcileOnResubscribe(42);
        await tick();

        // A late unknown frame rebinds currentRunId within the SAME generation.
        runs.admit({ runId: 'run-C' } as never);
        assert.strictEqual(runs.currentRunId, 'run-C');
        assert.strictEqual(runs.generation, genA, 'generation must be unchanged by the rebind');

        // Conclusive history for A returns, but the run it proves finished is no
        // longer the bound run, so nothing may resolve or merge.
        resolveFetch([assistant(99)]);
        await p;
        await tick();

        assert.strictEqual(mergeCalls(h.postSpy).length, 0, 'rebind must abort the merge');
        assert.strictEqual(runs.waiting, true, 'C must not be resolved by A history');
        assert.ok(internals(h.provider)._reconcileMarker, 'marker must not be cleared');
    });

    test('a real context change resets _runs and clears the marker', async () => {
        const runs = internals(h.provider)._runs;
        // Establish a first context (this itself resets, so set up state AFTER).
        h.contextStore.setActiveContext(context(5));
        beginBoundRun(runs, 'run-A');
        internals(h.provider)._reconcileMarker = {
            generation: runs.generation, localSessionId: 'session-42', artemisSessionId: 42, baselineMessageId: 10,
        };
        assert.strictEqual(runs.waiting, true);

        // Change to a genuinely different context.
        h.contextStore.setActiveContext(context(6));

        assert.strictEqual(internals(h.provider)._reconcileMarker, undefined, 'context change must clear the marker');
        assert.strictEqual(runs.waiting, false, 'context change must reset the run machine');
    });

    test('pendingGeneration true (first frame never arrived) => no out-of-band resolution', async () => {
        const runs = internals(h.provider)._runs;
        activateSession(h.contextStore, 5, 42);
        // beginGeneration WITHOUT an admitted frame: pendingGeneration stays true.
        const gen = runs.beginGeneration();
        assert.strictEqual(runs.pendingGeneration, true);
        internals(h.provider)._reconcileMarker = {
            generation: gen, localSessionId: 'session-42', artemisSessionId: 42, baselineMessageId: 10,
        };

        await internals(h.provider)._reconcileOnResubscribe(42);

        assert.strictEqual(h.fetchStub.callCount, 0, 'pendingGeneration must block the fetch');
    });

    test('a second resubscribe during an in-flight fetch is coalesced (re-runs once)', async () => {
        const runs = internals(h.provider)._runs;
        activateSession(h.contextStore, 5, 42);
        const gen = beginBoundRun(runs, 'run-A');
        internals(h.provider)._reconcileMarker = {
            generation: gen, localSessionId: 'session-42', artemisSessionId: 42, baselineMessageId: 10,
        };

        let resolveFetch: (v: unknown) => void = () => { /* noop */ };
        h.fetchStub.onFirstCall().returns(new Promise(res => { resolveFetch = res; }) as never);
        // Inconclusive history keeps the marker + waiting alive so the coalesced
        // re-run passes the gate again.
        h.fetchStub.resolves([] as never);

        const p = internals(h.provider)._reconcileOnResubscribe(42);
        await tick();
        assert.strictEqual(h.fetchStub.callCount, 1);

        // Second resubscribe while the first fetch is in flight: must be coalesced.
        void internals(h.provider)._reconcileOnResubscribe(42);
        assert.strictEqual(h.fetchStub.callCount, 1, 'the second trigger must not start a parallel fetch');

        resolveFetch([]);
        await p;
        await tick();

        assert.strictEqual(h.fetchStub.callCount, 2, 'the coalesced trigger must re-run the fetch exactly once');
    });

    test('conclusive history resolves the run and publishes run UI', async () => {
        const runs = internals(h.provider)._runs;
        activateSession(h.contextStore, 5, 42);
        const gen = beginBoundRun(runs, 'run-A');
        internals(h.provider)._reconcileMarker = {
            generation: gen, localSessionId: 'session-42', artemisSessionId: 42, baselineMessageId: 10,
        };
        h.fetchStub.resolves([assistant(99)] as never);
        h.publishSpy.resetHistory();

        await internals(h.provider)._reconcileOnResubscribe(42);
        await tick();

        assert.strictEqual(mergeCalls(h.postSpy).length, 1, 'history must be merged');
        assert.strictEqual(runs.waiting, false, 'conclusive history must resolve the run');
        assert.ok(h.publishSpy.called, 'run UI must be republished after resolution');
        assert.strictEqual(internals(h.provider)._reconcileMarker, undefined, 'the resolved marker must be cleared');
    });

    test('inconclusive history merges but leaves waiting true', async () => {
        const runs = internals(h.provider)._runs;
        activateSession(h.contextStore, 5, 42);
        const gen = beginBoundRun(runs, 'run-A');
        internals(h.provider)._reconcileMarker = {
            generation: gen, localSessionId: 'session-42', artemisSessionId: 42, baselineMessageId: 10,
        };
        // Assistant message at/under the baseline does not prove the in-flight run ended.
        h.fetchStub.resolves([assistant(10)] as never);
        h.publishSpy.resetHistory();

        await internals(h.provider)._reconcileOnResubscribe(42);
        await tick();

        assert.strictEqual(mergeCalls(h.postSpy).length, 1, 'history must still be merged');
        assert.strictEqual(runs.waiting, true, 'inconclusive history must leave the run waiting');
        assert.ok(internals(h.provider)._reconcileMarker, 'the marker must survive an inconclusive reconcile');
        assert.ok(!h.publishSpy.called, 'no resolution => no run-UI republish');
    });
});
