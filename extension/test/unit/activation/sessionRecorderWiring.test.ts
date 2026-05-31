/**
 * Integration tests for sessionRecorderWiring.
 *
 * Constructs a real TelemetryManager + (wireSessionRecorder-built) SessionRecorder
 * pointing at a temp directory; drives suppression and config-change events,
 * and asserts they reach the on-disk JSONL stream.
 *
 * Whitebox brittleness:
 *  - Fires TelemetryManager._onDidSuppressIntervention directly via cast.
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
    TaskFeedbackClosedPayload,
    TaskFeedbackOpenedPayload,
    TestResultsOverviewClosedPayload,
    TestResultsOverviewOpenedPayload,
} from '@shared/messageContracts/webviewCommands';

import { wireSessionRecorder } from '@extension/activation/sessionRecorderWiring';
import type { ArtemisWebviewProvider, ChatWebviewProvider } from '@extension/provider';
import type { ConsentService } from '@extension/services/auth';
import type { ContextStore } from '@extension/services/iris/context/contextStore';
import { SessionRecorder } from '@extension/services/telemetry/recording/sessionRecorder';
import type {
    BreakpointChangeEvent,
    ConfigurationChangeEvent,
    ConfigurationSnapshotEvent,
    InterventionEvent,
    RecordedEvent,
    SubmissionPayload,
} from '@extension/services/telemetry/recording/types';
import { TelemetryManager } from '@extension/services/telemetry/telemetryManager';
import type { InterventionDecision } from '@extension/services/telemetry/types';
import type { ArtemisWebsocketService } from '@extension/services/websocket';

interface MutableConfigState {
    enabled: boolean;
    showInterventions: unknown;   // unknown so tests can simulate non-boolean
    developerMode: boolean;
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
    };
    return chat as unknown as ChatProviderStub;
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
    telemetryManager: TelemetryManager;
    recorder: SessionRecorder;
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

    const telemetryManager = new TelemetryManager();
    const ctx = { globalStorageUri: vscode.Uri.file(tmpDir), subscriptions: [] } as unknown as vscode.ExtensionContext;
    const artemisProvider = stubWebviewProvider();
    const chatProvider = stubChatProvider();
    const wiring = wireSessionRecorder({
        context: ctx,
        consentService: stubConsent(true),
        artemisWebsocketService: stubWebsocket(sandbox),
        telemetryManager,
        artemisWebviewProvider: artemisProvider,
        chatWebviewProvider: chatProvider,
        capabilities: undefined,
        exerciseRegistry: undefined,
        contextStore,
    });

    return {
        telemetryManager,
        recorder: wiring.sessionRecorder,
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
            try { await wiring.sessionRecorder.dispose(); } catch { /* ignore */ }
            telemetryManager.dispose();
            try { await fs.rm(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
            // Stubs are restored centrally via the suite-level sandbox in teardown.
        },
    };
}

suite('sessionRecorderWiring — suppression and configuration provenance', () => {
    let sandbox: sinon.SinonSandbox;

    setup(() => {
        sandbox = sinon.createSandbox();
    });

    teardown(() => {
        sandbox.restore();
    });

    test('suppression event is recorded as action=suppressed', async () => {
        const harness = await makeWiringHarness(sandbox, { enabled: true, showInterventions: true, developerMode: false });
        try {
            await harness.recorder.startSession(42);
            const decision: InterventionDecision = {
                rawWanted: true,
                shouldIntervene: true,
                level: 'notification',
                triggerType: 'execution-error',
                eq: 0.55,
                confidence: 'sufficient',
            };
            (harness.telemetryManager as unknown as { _onDidSuppressIntervention: vscode.EventEmitter<{ decision: InterventionDecision; reason: 'user-disabled' }> })
                ._onDidSuppressIntervention.fire({ decision, reason: 'user-disabled' });
            await harness.recorder.endSession();

            const events = await readAllRecordedEvents(harness.tmpDir);
            const intervention = events.find(e => e.type === 'intervention') as InterventionEvent | undefined;
            assert.ok(intervention, 'intervention event missing');
            assert.strictEqual(intervention!.action, 'suppressed');
            assert.strictEqual(intervention!.suppressionReason, 'user-disabled');
            assert.strictEqual(intervention!.shouldIntervene, true);
        } finally {
            await harness.dispose();
        }
    });

    test('configurationSnapshot is emitted at startup', async () => {
        const harness = await makeWiringHarness(sandbox, { enabled: true, showInterventions: false, developerMode: false });
        try {
            await harness.recorder.startSession(42);
            await harness.recorder.endSession();

            const events = await readAllRecordedEvents(harness.tmpDir);
            const snap = events.find(e => e.type === 'configurationSnapshot') as ConfigurationSnapshotEvent | undefined;
            assert.ok(snap, 'configurationSnapshot missing — startup contributor not registered?');
            assert.strictEqual(snap!.struggleDetectionEnabled, true);
            assert.strictEqual(snap!.showInterventions, false);
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
            // Pre-existing breakpoints BEFORE the session (idle phase ⇒ the live
            // listener does not record the add; only the startup contributor does).
            vscode.debug.removeBreakpoints([...vscode.debug.breakpoints]);
            vscode.debug.addBreakpoints([inRootBp, outOfRootBp]);

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
            vscode.debug.removeBreakpoints([...vscode.debug.breakpoints]);
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
});
