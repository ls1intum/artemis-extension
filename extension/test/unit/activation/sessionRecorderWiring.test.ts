/**
 * Integration tests for sessionRecorderWiring.
 *
 * Constructs a stub StruggleCoordinator + (wireSessionRecorder-built)
 * SessionRecorder pointing at a temp directory; drives the coordinator's
 * recorder-feed events (onDidTick / onDidAlert) and the
 * startup contributors, and asserts they reach the on-disk JSONL stream.
 *
 * Whitebox brittleness:
 *  - Drives the coordinator's recorder-feed EventEmitters via a stub.
 *  - Stubs vscode.workspace.onDidChangeConfiguration to capture the listener.
 *  - Stubs vscode.workspace.getConfiguration with mutable backing values.
 */

import * as vscode from 'vscode';
import * as assert from 'assert';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import * as sinon from 'sinon';

import type {
    ProblemStatementScrollPayload,
    ProblemStatementSelectionPayload,
    TaskFeedbackClosedPayload,
    TaskFeedbackOpenedPayload,
    TestResultsOverviewClosedPayload,
    TestResultsOverviewOpenedPayload,
} from '@shared/messageContracts/webviewCommands';

import { wireSessionRecorder } from '@extension/activation/sessionRecorderWiring';
import type { ArtemisWebviewProvider, ChatWebviewProvider } from '@extension/provider';
import type { ConsentService } from '@extension/services/auth/consentService';
import type { ContextStore } from '@extension/services/iris/context/contextStore';
import { SessionRecorder } from '@extension/services/recording/sessionRecorder';
import type {
    AlertEvent,
    BreakpointChangeEvent,
    ConfigurationChangeEvent,
    ConfigurationSnapshotEvent,
    PanelVisibilityEvent,
    RecordedEvent,
    StruggleScoreEvent,
    SubmissionPayload,
} from '@extension/services/recording/types';
import type { StruggleCoordinator } from '@extension/services/struggle/struggleCoordinator';
import type { AlertRecord, TickRecord } from '@extension/services/struggle/types';
import type { ArtemisWebsocketService } from '@extension/services/websocket';
import { TestSensorHub } from '@test/__shared__/testSensorHub';

interface MutableConfigState {
    enabled: boolean;
    showInterventions: unknown;   // unknown so tests can simulate non-boolean
    developerMode: boolean;
}

/**
 * Stub StruggleCoordinator exposing exactly the surface the recorder wiring
 * subscribes: the two recorder-feed events (tick, alert). The fire helpers let
 * tests drive each event directly without constructing the real engine; mirrors
 * the provider stubs in this file.
 */
type CoordinatorStub = StruggleCoordinator & {
    fireTick: (tick: TickRecord) => void;
    fireAlert: (alert: AlertRecord) => void;
};

function stubCoordinator(): CoordinatorStub {
    const onDidTick = new vscode.EventEmitter<TickRecord>();
    const onDidAlert = new vscode.EventEmitter<AlertRecord>();
    const coordinator = {
        onDidTick: onDidTick.event,
        onDidAlert: onDidAlert.event,
        fireTick: (tick: TickRecord) => onDidTick.fire(tick),
        fireAlert: (alert: AlertRecord) => onDidAlert.fire(alert),
    };
    return coordinator as unknown as CoordinatorStub;
}

function installConfigStub(sandbox: sinon.SinonSandbox, state: MutableConfigState): sinon.SinonStub {
    const original = vscode.workspace.getConfiguration;
    return sandbox.stub(vscode.workspace, 'getConfiguration').callsFake((section?: string) => {
        const real = original.call(vscode.workspace, section);
        return {
            ...real,
            get: <T>(key: string, def?: T): T => {
                if (section === 'artemis.struggleDetection' && key === 'enabled') {
                    return state.enabled as unknown as T;
                }
                if (section === 'artemis.struggleDetection' && key === 'showInterventions') {
                    return state.showInterventions as T;
                }
                if (section === 'artemis' && key === 'developerMode') {
                    return state.developerMode as unknown as T;
                }
                return def as T;
            },
            inspect: real.inspect.bind(real),
            update: real.update.bind(real),
            has: real.has.bind(real),
        } as unknown as vscode.WorkspaceConfiguration;
    });
}

function stubConsent(extended: boolean): ConsentService {
    const onConsentChanged = new vscode.EventEmitter<'pending' | 'declined' | 'basic' | 'extended'>();
    return {
        get isExtendedCollectionEnabled() { return extended; },
        onConsentChanged: onConsentChanged.event,
    } as unknown as ConsentService;
}

function stubWebsocket(sandbox: sinon.SinonSandbox): ArtemisWebsocketService {
    return {
        registerMessageHandler: sandbox.stub(),
        unregisterMessageHandler: sandbox.stub(),
    } as unknown as ArtemisWebsocketService;
}

function stubWebviewProvider(): ArtemisWebviewProvider {
    const onDidChangeViewNavigation = new vscode.EventEmitter<{ from: string; to: string }>();
    const onDidChangePanelVisibility = new vscode.EventEmitter<boolean>();
    // NEW: emitters + fire methods for view-tracking events.
    const onDidOpenOverview = new vscode.EventEmitter<TestResultsOverviewOpenedPayload>();
    const onDidCloseOverview = new vscode.EventEmitter<TestResultsOverviewClosedPayload>();
    const onDidOpenTask = new vscode.EventEmitter<TaskFeedbackOpenedPayload>();
    const onDidCloseTask = new vscode.EventEmitter<TaskFeedbackClosedPayload>();
    const onDidSubmission = new vscode.EventEmitter<SubmissionPayload>();
    const onDidPsScroll = new vscode.EventEmitter<ProblemStatementScrollPayload>();
    const onDidPsSelection = new vscode.EventEmitter<ProblemStatementSelectionPayload>();
    return {
        getCurrentVisibility: () => false,
        onDidChangeViewNavigation: onDidChangeViewNavigation.event,
        onDidChangePanelVisibility: onDidChangePanelVisibility.event,
        onDidOpenTestResultsOverview: onDidOpenOverview.event,
        onDidCloseTestResultsOverview: onDidCloseOverview.event,
        onDidOpenTaskFeedback: onDidOpenTask.event,
        onDidCloseTaskFeedback: onDidCloseTask.event,
        fireTestResultsOverviewOpened: (p: TestResultsOverviewOpenedPayload) => onDidOpenOverview.fire(p),
        fireTestResultsOverviewClosed: (p: TestResultsOverviewClosedPayload) => onDidCloseOverview.fire(p),
        fireTaskFeedbackOpened: (p: TaskFeedbackOpenedPayload) => onDidOpenTask.fire(p),
        fireTaskFeedbackClosed: (p: TaskFeedbackClosedPayload) => onDidCloseTask.fire(p),
        onDidSubmission: onDidSubmission.event,
        fireSubmission: (p: SubmissionPayload) => onDidSubmission.fire(p),
        fireViewNavigation: (p: { from: string; to: string }) => onDidChangeViewNavigation.fire(p),
        fireArtemisPanelVisibility: (visible: boolean) => onDidChangePanelVisibility.fire(visible),
        onDidProblemStatementScroll: onDidPsScroll.event,
        onDidProblemStatementSelection: onDidPsSelection.event,
        fireProblemStatementScroll: (p: ProblemStatementScrollPayload) => onDidPsScroll.fire(p),
        fireProblemStatementSelection: (p: ProblemStatementSelectionPayload) => onDidPsSelection.fire(p),
    } as unknown as ArtemisWebviewProvider;
}

type ChatProviderStub = ChatWebviewProvider & { _selectedExerciseIdSpy: sinon.SinonSpy };

function stubChatProvider(): ChatProviderStub {
    const onDidSendIrisChatMessage = new vscode.EventEmitter<string>();
    const onDidAttemptIrisChatSend = new vscode.EventEmitter<{ content: string; status: 'pending' | 'sent' | 'failed'; errorMessage?: string }>();
    const onDidProvideIrisChatFeedback = new vscode.EventEmitter<{ messageId: string; helpful: boolean }>();
    const onDidChangePanelVisibility = new vscode.EventEmitter<boolean>();
    const onDidReceiveIrisChatMessage = new vscode.EventEmitter<{ content: string; messageId?: string; sessionId?: string; sentAt?: number }>();
    const _selectedExerciseIdSpy = sinon.spy(() => 42);
    const chat = {
        getCurrentVisibility: () => false,
        getSelectedExerciseId: _selectedExerciseIdSpy,
        onDidSendIrisChatMessage: onDidSendIrisChatMessage.event,
        onDidAttemptIrisChatSend: onDidAttemptIrisChatSend.event,
        onDidProvideIrisChatFeedback: onDidProvideIrisChatFeedback.event,
        onDidChangePanelVisibility: onDidChangePanelVisibility.event,
        websocketMessageHandler: { onDidReceiveIrisChatMessage: onDidReceiveIrisChatMessage.event },
        _selectedExerciseIdSpy,
        // Test-only fire helpers for the wiring's chat subscriptions.
        fireSendIris: (text: string) => onDidSendIrisChatMessage.fire(text),
        fireReceiveIris: (msg: { content: string; messageId?: string; sessionId?: string; sentAt?: number }) => onDidReceiveIrisChatMessage.fire(msg),
        fireAttemptIris: (p: { content: string; status: 'pending' | 'sent' | 'failed'; errorMessage?: string }) => onDidAttemptIrisChatSend.fire(p),
        fireFeedbackIris: (p: { messageId: string; helpful: boolean }) => onDidProvideIrisChatFeedback.fire(p),
        fireChatPanelVisibility: (visible: boolean) => onDidChangePanelVisibility.fire(visible),
    };
    return chat as unknown as ChatProviderStub;
}

/** Build a minimal TickRecord whose feature fields the recorder copies. */
function makeTick(overrides: Partial<TickRecord> = {}): TickRecord {
    return {
        t: 10,
        ts: 1_700_000_010_000,
        features: {
            t: 10,
            effectiveWindowS: 10,
            nOneCharInserts: 0,
            scrollEvents: 0,
            typingRate: 12,
            n4Ratio: 1.5,
            longestGapS: 8,
            fTyping: 0.4,
            fGap: 0.2,
            fN4: 0.15,
            fFb: 0,
            fA8: 0,
            fN2: 0,
            tsState: false,
            n4State: false,
        },
        sBase: 0.3,
        s: 0.35,
        v: 0.42,
        fastDecay: false,
        boundariesPreGate: [],
        alert: null,
        ...overrides,
    };
}

/** Build a minimal AlertRecord. */
function makeAlert(overrides: Partial<AlertRecord> = {}): AlertRecord {
    return {
        t: 30,
        ts: 1_700_000_030_000,
        v: 0.7,
        typesPreGate: ['FM'],
        types: ['FM'],
        primary: 'FM',
        path: 'armed',
        inWarmup: false,
        inGrace: false,
        ...overrides,
    };
}

/** Read every events.jsonl file produced under tmpDir/recordings/<sessionId>/ and return the parsed events. */
async function readAllRecordedEvents(tmpDir: string): Promise<RecordedEvent[]> {
    const recordingsRoot = path.join(tmpDir, 'recordings');
    const events: RecordedEvent[] = [];
    let sessionDirs: string[];
    try {
        sessionDirs = await fs.readdir(recordingsRoot);
    } catch {
        return events; // recordings dir not created yet
    }
    for (const sessionId of sessionDirs) {
        const eventsPath = path.join(recordingsRoot, sessionId, 'events.jsonl');
        let content: string;
        try {
            content = await fs.readFile(eventsPath, 'utf-8');
        } catch {
            continue;
        }
        for (const line of content.split('\n').filter(Boolean)) {
            try { events.push(JSON.parse(line) as RecordedEvent); } catch { /* skip malformed */ }
        }
    }
    return events;
}

interface WiringHarness {
    coordinator: CoordinatorStub;
    recorder: SessionRecorder;
    sensorHub: TestSensorHub;
    artemisWebviewProvider: ArtemisWebviewProvider;
    chatProvider: ChatProviderStub;
    tmpDir: string;
    configState: MutableConfigState;
    capturedConfigListener: () => ((e: vscode.ConfigurationChangeEvent) => void) | undefined;
    clickRecord: () => Promise<void>;
    dispose: () => Promise<void>;
}

/**
 * Build a wiring harness against a per-suite sandbox. The sandbox owns every
 * stub so a thrown error mid-construction (or a forgotten dispose call) cannot
 * leak `getConfiguration` / `registerCommand` wraps into the next test —
 * `sandbox.restore()` in teardown rolls them all back unconditionally.
 */
async function makeWiringHarness(
    sandbox: sinon.SinonSandbox,
    initial: MutableConfigState,
    contextStore: ContextStore = { getWorkspaceExerciseId: () => 42 } as unknown as ContextStore,
): Promise<WiringHarness> {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wiring-test-'));
    const configState: MutableConfigState = { ...initial };

    installConfigStub(sandbox, configState);

    let captured: ((e: vscode.ConfigurationChangeEvent) => void) | undefined;
    sandbox.stub(vscode.workspace, 'onDidChangeConfiguration').callsFake((listener: (e: vscode.ConfigurationChangeEvent) => void) => {
        captured = listener;
        return new vscode.Disposable(() => { /* noop */ });
    });

    // The extension under test is already activated by the test runner and has
    // registered `artemis.toggleRecording`. Stub registerCommand so the wiring's
    // RecordingStatusBarService does not collide with that pre-existing
    // registration. Capture the handler so tests can invoke the Record click
    // directly without hitting the live extension's already-registered command.
    // Same story for createStatusBarItem (avoid duplicating the real status bar item).
    let capturedRecordHandler: (() => Promise<void>) | undefined;
    sandbox.stub(vscode.commands, 'registerCommand').callsFake((id: string, handler: () => Promise<void>) => {
        if (id === 'artemis.toggleRecording') {
            capturedRecordHandler = handler;
        }
        return new vscode.Disposable(() => { /* noop */ });
    });
    sandbox.stub(vscode.window, 'createStatusBarItem').returns({
        text: '', tooltip: undefined, backgroundColor: undefined, command: undefined,
        show: sandbox.stub(), hide: sandbox.stub(), dispose: sandbox.stub(),
        alignment: vscode.StatusBarAlignment.Right, priority: 99,
    } as unknown as vscode.StatusBarItem);

    const coordinator = stubCoordinator();
    const ctx = { globalStorageUri: vscode.Uri.file(tmpDir), subscriptions: [] } as unknown as vscode.ExtensionContext;
    const artemisProvider = stubWebviewProvider();
    const chatProvider = stubChatProvider();
    const sensorHub = new TestSensorHub();
    const wiring = wireSessionRecorder({
        context: ctx,
        consentService: stubConsent(true),
        artemisWebsocketService: stubWebsocket(sandbox),
        struggleCoordinator: coordinator,
        artemisWebviewProvider: artemisProvider,
        chatWebviewProvider: chatProvider,
        capabilities: undefined,
        exerciseRegistry: undefined,
        contextStore,
        sensorHub,
    });

    return {
        coordinator,
        recorder: wiring.sessionRecorder,
        sensorHub,
        artemisWebviewProvider: artemisProvider,
        chatProvider,
        tmpDir,
        configState,
        capturedConfigListener: () => captured,
        clickRecord: async () => {
            if (!capturedRecordHandler) {
                throw new Error('Record-toggle handler was not registered');
            }
            await capturedRecordHandler();
        },
        dispose: async () => {
            wiring.disposable.dispose();
            try { await wiring.sessionRecorder.shutdown(); } catch { /* ignore */ }
            sensorHub.dispose();
            try { await fs.rm(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
            // Stubs are restored centrally via the suite-level sandbox in teardown.
        },
    };
}

suite('sessionRecorderWiring — recorder feed and configuration provenance', () => {
    let sandbox: sinon.SinonSandbox;

    setup(() => {
        sandbox = sinon.createSandbox();
    });

    teardown(() => {
        sandbox.restore();
    });

    test('configurationSnapshot is emitted at startup with engineVersion v2', async () => {
        const harness = await makeWiringHarness(sandbox, { enabled: true, showInterventions: false, developerMode: false });
        try {
            await harness.recorder.startSession(42);
            await harness.recorder.endSession();

            const events = await readAllRecordedEvents(harness.tmpDir);
            const snap = events.find(e => e.type === 'configurationSnapshot') as ConfigurationSnapshotEvent | undefined;
            assert.ok(snap, 'configurationSnapshot missing — startup contributor not registered?');
            assert.strictEqual(snap!.struggleDetectionEnabled, true);
            assert.strictEqual(snap!.showInterventions, false);
            assert.strictEqual(snap!.engineVersion, 'v2');
        } finally {
            await harness.dispose();
        }
    });

    test('initial breakpoint snapshot is emitted at startup for in-root breakpoints only', async () => {
        const harness = await makeWiringHarness(sandbox, { enabled: true, showInterventions: true, developerMode: false });
        const exerciseRoot = vscode.Uri.file(path.join(harness.tmpDir, 'ex'));
        const inRootUri = vscode.Uri.file(path.join(exerciseRoot.fsPath, 'Main.java'));
        const outOfRootUri = vscode.Uri.file(path.join(os.tmpdir(), `wiring-bp-out-${process.pid}.java`));
        const inRootBp = new vscode.SourceBreakpoint(new vscode.Location(inRootUri, new vscode.Position(4, 0)));
        const outOfRootBp = new vscode.SourceBreakpoint(new vscode.Location(outOfRootUri, new vscode.Position(0, 0)));
        try {
            // Pre-existing breakpoints BEFORE the session: seeding the hub stub
            // does not fire onDidChangeBreakpoints, so the live listener does not
            // record the add; only the startup contributor sees them.
            harness.sensorHub.stub.breakpoints = [inRootBp, outOfRootBp];

            await harness.recorder.startSession(42, undefined, exerciseRoot.toString());
            await harness.recorder.endSession();

            const events = await readAllRecordedEvents(harness.tmpDir);
            const snap = events.find(e => e.type === 'breakpointChange') as BreakpointChangeEvent | undefined;
            assert.ok(snap, 'breakpoint snapshot missing — startup contributor not registered by the wiring?');
            assert.strictEqual(snap!.action, 'added', 'snapshot action is added');
            assert.strictEqual(snap!.breakpoints.length, 1, 'only the in-root breakpoint is captured (out-of-root filtered)');
            assert.strictEqual(snap!.breakpoints[0].uri, inRootUri.toString(), 'snapshot uri = in-root');
            assert.strictEqual(snap!.breakpoints[0].line, 4, 'snapshot line 0-based 4');
            assert.strictEqual(snap!.breakpoints[0].id, inRootBp.id, 'snapshot bp id matches the SourceBreakpoint');
        } finally {
            await harness.dispose();
        }
    });

    test('forwards onDidOpenTestResultsOverview to the recorder', async () => {
        const harness = await makeWiringHarness(sandbox, { enabled: true, showInterventions: true, developerMode: false });
        try {
            const recordStub = sandbox.stub(harness.recorder, 'recordTestResultsOverviewOpened');
            const payload: TestResultsOverviewOpenedPayload = { viewId: 'v', exerciseId: 1, totalTests: 2, passedTests: 1, failedTests: 1 };
            (harness.artemisWebviewProvider as unknown as { fireTestResultsOverviewOpened: (p: TestResultsOverviewOpenedPayload) => void })
                .fireTestResultsOverviewOpened(payload);
            sinon.assert.calledOnceWithExactly(recordStub, payload);
        } finally {
            await harness.dispose();
        }
    });

    test('forwards onDidCloseTestResultsOverview to the recorder', async () => {
        const harness = await makeWiringHarness(sandbox, { enabled: true, showInterventions: true, developerMode: false });
        try {
            const recordStub = sandbox.stub(harness.recorder, 'recordTestResultsOverviewClosed');
            const payload: TestResultsOverviewClosedPayload = { viewId: 'v', exerciseId: 1, durationMs: 100, closeReason: 'button' };
            (harness.artemisWebviewProvider as unknown as { fireTestResultsOverviewClosed: (p: TestResultsOverviewClosedPayload) => void })
                .fireTestResultsOverviewClosed(payload);
            sinon.assert.calledOnceWithExactly(recordStub, payload);
        } finally {
            await harness.dispose();
        }
    });

    test('forwards onDidOpenTaskFeedback to the recorder', async () => {
        const harness = await makeWiringHarness(sandbox, { enabled: true, showInterventions: true, developerMode: false });
        try {
            const recordStub = sandbox.stub(harness.recorder, 'recordTaskFeedbackOpened');
            const payload: TaskFeedbackOpenedPayload = { viewId: 'v', exerciseId: 1, taskName: 't', testIds: [1, 2], totalTests: 2, passedTests: 1, failedTests: 1 };
            (harness.artemisWebviewProvider as unknown as { fireTaskFeedbackOpened: (p: TaskFeedbackOpenedPayload) => void })
                .fireTaskFeedbackOpened(payload);
            sinon.assert.calledOnceWithExactly(recordStub, payload);
        } finally {
            await harness.dispose();
        }
    });

    test('forwards onDidCloseTaskFeedback to the recorder', async () => {
        const harness = await makeWiringHarness(sandbox, { enabled: true, showInterventions: true, developerMode: false });
        try {
            const recordStub = sandbox.stub(harness.recorder, 'recordTaskFeedbackClosed');
            const payload: TaskFeedbackClosedPayload = { viewId: 'v', exerciseId: 1, taskName: 't', durationMs: 100, closeReason: 'button' };
            (harness.artemisWebviewProvider as unknown as { fireTaskFeedbackClosed: (p: TaskFeedbackClosedPayload) => void })
                .fireTaskFeedbackClosed(payload);
            sinon.assert.calledOnceWithExactly(recordStub, payload);
        } finally {
            await harness.dispose();
        }
    });

    test('forwards onDidSubmission to the recorder', async () => {
        const harness = await makeWiringHarness(sandbox, { enabled: true, showInterventions: true, developerMode: false });
        try {
            const recordStub = sandbox.stub(harness.recorder, 'recordSubmission');
            const payload: SubmissionPayload = { status: 'started', participationId: 99, commitMessage: 'wip' };
            (harness.artemisWebviewProvider as unknown as { fireSubmission: (p: SubmissionPayload) => void })
                .fireSubmission(payload);
            sinon.assert.calledOnceWithExactly(recordStub, payload);
        } finally {
            await harness.dispose();
        }
    });

    test('configurationChange is recorded when the listener fires', async () => {
        // Initial config: showInterventions=true. Listener caches that on construction.
        const harness = await makeWiringHarness(sandbox, { enabled: true, showInterventions: true, developerMode: false });
        try {
            await harness.recorder.startSession(42);
            const listener = harness.capturedConfigListener();
            assert.ok(listener, 'wireSessionRecorder did not register an onDidChangeConfiguration listener');

            // Mutate the backing state; the configStub's get() will now return false.
            harness.configState.showInterventions = false;
            listener!({
                affectsConfiguration: (k: string) => k === 'artemis.struggleDetection',
            } as vscode.ConfigurationChangeEvent);

            await harness.recorder.endSession();

            const events = await readAllRecordedEvents(harness.tmpDir);
            const change = events.find(e => e.type === 'configurationChange') as ConfigurationChangeEvent | undefined;
            assert.ok(change, 'configurationChange missing');
            assert.deepStrictEqual(change!.changes, { showInterventions: false });
        } finally {
            await harness.dispose();
        }
    });

    test('recorder gate reads from contextStore.getWorkspaceExerciseId; chat getter is unused', async () => {
        const workspaceGetter = sinon.spy(() => 99);
        const contextStore = { getWorkspaceExerciseId: workspaceGetter } as unknown as ContextStore;
        const initial: MutableConfigState = {
            enabled: true,
            showInterventions: true,
            developerMode: false,
        };
        const harness = await makeWiringHarness(sandbox, initial, contextStore);
        try {
            await harness.clickRecord();
            assert.strictEqual(workspaceGetter.callCount, 1, 'workspace getter should be called once per click');
            assert.ok(!harness.chatProvider._selectedExerciseIdSpy.called, 'chat getter must NOT be called by the wiring');
        } finally {
            await harness.dispose();
        }
    });

    // ── Forwarding: Iris chat ──────────────────────────────────────────────

    test('forwards onDidSendIrisChatMessage to recordIrisChatSent', async () => {
        const harness = await makeWiringHarness(sandbox, { enabled: true, showInterventions: true, developerMode: false });
        try {
            const stub = sandbox.stub(harness.recorder, 'recordIrisChatSent');
            (harness.chatProvider as unknown as { fireSendIris: (t: string) => void }).fireSendIris('hello iris');
            sinon.assert.calledOnceWithExactly(stub, 'hello iris');
        } finally {
            await harness.dispose();
        }
    });

    test('forwards onDidReceiveIrisChatMessage to recordIrisChatReceived', async () => {
        const harness = await makeWiringHarness(sandbox, { enabled: true, showInterventions: true, developerMode: false });
        try {
            const stub = sandbox.stub(harness.recorder, 'recordIrisChatReceived');
            (harness.chatProvider as unknown as { fireReceiveIris: (m: { content: string; messageId?: string; sessionId?: string; sentAt?: number }) => void })
                .fireReceiveIris({ content: 'hi student', messageId: 'm1', sessionId: 's1', sentAt: 1700000000 });
            sinon.assert.calledOnceWithExactly(stub, 'hi student', 'm1', 's1', 1700000000);
        } finally {
            await harness.dispose();
        }
    });

    test('forwards onDidAttemptIrisChatSend to recordIrisChatSendAttempt', async () => {
        const harness = await makeWiringHarness(sandbox, { enabled: true, showInterventions: true, developerMode: false });
        try {
            const stub = sandbox.stub(harness.recorder, 'recordIrisChatSendAttempt');
            (harness.chatProvider as unknown as { fireAttemptIris: (p: { content: string; status: 'pending' | 'sent' | 'failed'; errorMessage?: string }) => void })
                .fireAttemptIris({ content: 'draft', status: 'failed', errorMessage: 'network down' });
            sinon.assert.calledOnceWithExactly(stub, 'draft', 'failed', 'network down');
        } finally {
            await harness.dispose();
        }
    });

    test('forwards onDidProvideIrisChatFeedback to recordIrisChatFeedback', async () => {
        const harness = await makeWiringHarness(sandbox, { enabled: true, showInterventions: true, developerMode: false });
        try {
            const stub = sandbox.stub(harness.recorder, 'recordIrisChatFeedback');
            (harness.chatProvider as unknown as { fireFeedbackIris: (p: { messageId: string; helpful: boolean }) => void })
                .fireFeedbackIris({ messageId: 'm1', helpful: true });
            sinon.assert.calledOnceWithExactly(stub, 'm1', true);
        } finally {
            await harness.dispose();
        }
    });

    // ── Forwarding: recorder feed (tick, alert) ──────

    test('forwards onDidTick to recordStruggleScore with the feature row', async () => {
        const harness = await makeWiringHarness(sandbox, { enabled: true, showInterventions: true, developerMode: false });
        try {
            const stub = sandbox.stub(harness.recorder, 'recordStruggleScore');
            harness.coordinator.fireTick(makeTick());
            sinon.assert.calledOnce(stub);
            sinon.assert.calledWithExactly(stub, {
                t: 10, s: 0.35, v: 0.42,
                fTyping: 0.4, fGap: 0.2, fN4: 0.15, fFb: 0, fA8: 0, fN2: 0,
                typingRate: 12, longestGapS: 8, n4Ratio: 1.5,
            });
        } finally {
            await harness.dispose();
        }
    });

    test('onDidTick is recorded as a struggleScore event on disk', async () => {
        const harness = await makeWiringHarness(sandbox, { enabled: true, showInterventions: true, developerMode: false });
        try {
            await harness.recorder.startSession(42);
            harness.coordinator.fireTick(makeTick({ t: 20, s: 0.5, v: 0.6 }));
            await harness.recorder.endSession();

            const events = await readAllRecordedEvents(harness.tmpDir);
            const score = events.find(e => e.type === 'struggleScore') as StruggleScoreEvent | undefined;
            assert.ok(score, 'struggleScore event missing');
            assert.strictEqual(score!.t, 20);
            assert.strictEqual(score!.s, 0.5);
            assert.strictEqual(score!.v, 0.6);
            assert.strictEqual(score!.typingRate, 12);
        } finally {
            await harness.dispose();
        }
    });

    test('forwards onDidAlert to recordAlert with theta=THETA_FULL', async () => {
        const harness = await makeWiringHarness(sandbox, { enabled: true, showInterventions: true, developerMode: false });
        try {
            const stub = sandbox.stub(harness.recorder, 'recordAlert');
            harness.coordinator.fireAlert(makeAlert());
            sinon.assert.calledOnceWithExactly(stub, {
                t: 30, v: 0.7, types: ['FM'], primary: 'FM',
                path: 'armed', inWarmup: false, inGrace: false, theta: 0.6,
            });
        } finally {
            await harness.dispose();
        }
    });

    test('onDidAlert is recorded as an alert event on disk', async () => {
        const harness = await makeWiringHarness(sandbox, { enabled: true, showInterventions: true, developerMode: false });
        try {
            await harness.recorder.startSession(42);
            harness.coordinator.fireAlert(makeAlert({ t: 45, primary: 'E4', types: ['E4', 'N1'], path: 'e6' }));
            await harness.recorder.endSession();

            const events = await readAllRecordedEvents(harness.tmpDir);
            const alert = events.find(e => e.type === 'alert') as AlertEvent | undefined;
            assert.ok(alert, 'alert event missing');
            assert.strictEqual(alert!.t, 45);
            assert.strictEqual(alert!.primary, 'E4');
            assert.deepStrictEqual(alert!.types, ['E4', 'N1']);
            assert.strictEqual(alert!.path, 'e6');
            assert.strictEqual(alert!.theta, 0.6);
        } finally {
            await harness.dispose();
        }
    });

    // ── Forwarding: navigation + panel visibility ──────────────────────────

    test('forwards onDidChangeViewNavigation to recordViewNavigation', async () => {
        const harness = await makeWiringHarness(sandbox, { enabled: true, showInterventions: true, developerMode: false });
        try {
            const stub = sandbox.stub(harness.recorder, 'recordViewNavigation');
            (harness.artemisWebviewProvider as unknown as { fireViewNavigation: (p: { from: string; to: string }) => void })
                .fireViewNavigation({ from: 'problem-statement', to: 'code-editor' });
            sinon.assert.calledOnceWithExactly(stub, 'problem-statement', 'code-editor');
        } finally {
            await harness.dispose();
        }
    });

    test('forwards artemis onDidChangePanelVisibility to recordPanelVisibility(artemis)', async () => {
        const harness = await makeWiringHarness(sandbox, { enabled: true, showInterventions: true, developerMode: false });
        try {
            const stub = sandbox.stub(harness.recorder, 'recordPanelVisibility');
            (harness.artemisWebviewProvider as unknown as { fireArtemisPanelVisibility: (v: boolean) => void }).fireArtemisPanelVisibility(true);
            sinon.assert.calledOnceWithExactly(stub, 'artemis', true);
        } finally {
            await harness.dispose();
        }
    });

    test('forwards chat onDidChangePanelVisibility to recordPanelVisibility(chat)', async () => {
        const harness = await makeWiringHarness(sandbox, { enabled: true, showInterventions: true, developerMode: false });
        try {
            const stub = sandbox.stub(harness.recorder, 'recordPanelVisibility');
            (harness.chatProvider as unknown as { fireChatPanelVisibility: (v: boolean) => void }).fireChatPanelVisibility(false);
            sinon.assert.calledOnceWithExactly(stub, 'chat', false);
        } finally {
            await harness.dispose();
        }
    });

    test('forwards onDidProblemStatementScroll to recordProblemStatementScroll', async () => {
        const harness = await makeWiringHarness(sandbox, { enabled: true, showInterventions: true, developerMode: false });
        try {
            const stub = sandbox.stub(harness.recorder, 'recordProblemStatementScroll');
            const payload: ProblemStatementScrollPayload = { scrollTop: 10, scrollHeight: 2000, viewportHeight: 700, statementTop: 800, statementHeight: 900 };
            (harness.artemisWebviewProvider as unknown as { fireProblemStatementScroll: (p: ProblemStatementScrollPayload) => void })
                .fireProblemStatementScroll(payload);
            sinon.assert.calledOnceWithExactly(stub, payload);
        } finally {
            await harness.dispose();
        }
    });

    test('forwards onDidProblemStatementSelection to recordProblemStatementSelection', async () => {
        const harness = await makeWiringHarness(sandbox, { enabled: true, showInterventions: true, developerMode: false });
        try {
            const stub = sandbox.stub(harness.recorder, 'recordProblemStatementSelection');
            const payload: ProblemStatementSelectionPayload = {
                selectedText: 'abc', selectionLength: 3, truncated: false,
                selectionTop: 1, selectionLeft: 2, selectionWidth: 3, selectionHeight: 4,
            };
            (harness.artemisWebviewProvider as unknown as { fireProblemStatementSelection: (p: ProblemStatementSelectionPayload) => void })
                .fireProblemStatementSelection(payload);
            sinon.assert.calledOnceWithExactly(stub, payload);
        } finally {
            await harness.dispose();
        }
    });

    // ── Startup contributors: panelVisibility seeds ─────────

    test('startup seeds panelVisibility for both artemis and chat from getCurrentVisibility()', async () => {
        const harness = await makeWiringHarness(sandbox, { enabled: true, showInterventions: true, developerMode: false });
        try {
            // Reassign each provider's getter so the seed value is genuinely READ, not
            // hardcoded. Artemis returns a non-default `true`; chat keeps `false` but via a
            // spy, so a wiring that hardcoded chat=false (instead of calling the getter)
            // would fail the `chatVisSpy.called` assertion.
            (harness.artemisWebviewProvider as unknown as { getCurrentVisibility: () => boolean }).getCurrentVisibility = () => true;
            const chatVisSpy = sinon.spy(() => false);
            (harness.chatProvider as unknown as { getCurrentVisibility: () => boolean }).getCurrentVisibility = chatVisSpy;
            await harness.recorder.startSession(42);
            await harness.recorder.endSession();

            const events = await readAllRecordedEvents(harness.tmpDir);
            const panels = events.filter(e => e.type === 'panelVisibility') as PanelVisibilityEvent[];
            const artemis = panels.find(p => p.panel === 'artemis');
            const chat = panels.find(p => p.panel === 'chat');
            assert.ok(artemis, 'artemis panelVisibility startup seed missing');
            assert.ok(chat, 'chat panelVisibility startup seed missing');
            assert.strictEqual(artemis!.visible, true, 'artemis visibility read from getCurrentVisibility()');
            assert.strictEqual(chat!.visible, false, 'chat visibility read from getCurrentVisibility()');
            assert.ok(chatVisSpy.called, 'chat getCurrentVisibility was invoked (value not hardcoded)');
        } finally {
            await harness.dispose();
        }
    });
});
