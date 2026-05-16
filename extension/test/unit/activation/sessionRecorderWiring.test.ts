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
import { SessionRecorder } from '@extension/services/telemetry/recording/sessionRecorder';
import type { ConfigurationChangeEvent, ConfigurationSnapshotEvent, InterventionEvent, RecordedEvent } from '@extension/services/telemetry/recording/types';
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
    } as unknown as ArtemisWebviewProvider;
}

function stubChatProvider(): ChatWebviewProvider {
    const onDidSendIrisChatMessage = new vscode.EventEmitter<string>();
    const onDidAttemptIrisChatSend = new vscode.EventEmitter<{ content: string; status: 'pending' | 'sent' | 'failed'; errorMessage?: string }>();
    const onDidProvideIrisChatFeedback = new vscode.EventEmitter<{ messageId: string; helpful: boolean }>();
    const onDidChangePanelVisibility = new vscode.EventEmitter<boolean>();
    const onDidReceiveIrisChatMessage = new vscode.EventEmitter<{ content: string; messageId?: string; sessionId?: string; sentAt?: number }>();
    return {
        getCurrentVisibility: () => false,
        getSelectedExerciseId: () => 42,
        onDidSendIrisChatMessage: onDidSendIrisChatMessage.event,
        onDidAttemptIrisChatSend: onDidAttemptIrisChatSend.event,
        onDidProvideIrisChatFeedback: onDidProvideIrisChatFeedback.event,
        onDidChangePanelVisibility: onDidChangePanelVisibility.event,
        websocketMessageHandler: { onDidReceiveIrisChatMessage: onDidReceiveIrisChatMessage.event },
    } as unknown as ChatWebviewProvider;
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
    tmpDir: string;
    configState: MutableConfigState;
    capturedConfigListener: () => ((e: vscode.ConfigurationChangeEvent) => void) | undefined;
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
    // registration. Same story for createStatusBarItem (avoid duplicating the
    // real status bar item).
    sandbox.stub(vscode.commands, 'registerCommand').returns(new vscode.Disposable(() => { /* noop */ }));
    sandbox.stub(vscode.window, 'createStatusBarItem').returns({
        text: '', tooltip: undefined, backgroundColor: undefined, command: undefined,
        show: sandbox.stub(), hide: sandbox.stub(), dispose: sandbox.stub(),
        alignment: vscode.StatusBarAlignment.Right, priority: 99,
    } as unknown as vscode.StatusBarItem);

    const telemetryManager = new TelemetryManager();
    const ctx = { globalStorageUri: vscode.Uri.file(tmpDir), subscriptions: [] } as unknown as vscode.ExtensionContext;
    const artemisProvider = stubWebviewProvider();
    const wiring = wireSessionRecorder({
        context: ctx,
        consentService: stubConsent(true),
        artemisWebsocketService: stubWebsocket(sandbox),
        telemetryManager,
        artemisWebviewProvider: artemisProvider,
        chatWebviewProvider: stubChatProvider(),
        capabilities: undefined,
        exerciseRegistry: undefined,
    });

    return {
        telemetryManager,
        recorder: wiring.sessionRecorder,
        artemisWebviewProvider: artemisProvider,
        tmpDir,
        configState,
        capturedConfigListener: () => captured,
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
});
