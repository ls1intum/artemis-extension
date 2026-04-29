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

import * as assert from 'assert';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { TelemetryManager } from '../../../src/extension/services/telemetry/telemetryManager';
import { SessionRecorder } from '../../../src/extension/services/telemetry/recording/sessionRecorder';
import { wireSessionRecorder } from '../../../src/extension/activation/sessionRecorderWiring';
import type { RecordedEvent, InterventionEvent, ConfigurationSnapshotEvent, ConfigurationChangeEvent } from '../../../src/extension/services/telemetry/recording/types';
import type { ConsentService } from '../../../src/extension/services/auth';
import type { ArtemisWebsocketService } from '../../../src/extension/services/websocket';
import type { ArtemisWebviewProvider, ChatWebviewProvider } from '../../../src/extension/provider';
import type { InterventionDecision } from '../../../src/extension/services/telemetry/types';

interface MutableConfigState {
    enabled: boolean;
    showInterventions: unknown;   // unknown so tests can simulate non-boolean
    developerMode: boolean;
}

function installConfigStub(state: MutableConfigState): sinon.SinonStub {
    const original = vscode.workspace.getConfiguration;
    return sinon.stub(vscode.workspace, 'getConfiguration').callsFake((section?: string) => {
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

function stubWebsocket(): ArtemisWebsocketService {
    return {
        registerMessageHandler: sinon.stub(),
        unregisterMessageHandler: sinon.stub(),
    } as unknown as ArtemisWebsocketService;
}

function stubWebviewProvider(): ArtemisWebviewProvider {
    const onDidChangeViewNavigation = new vscode.EventEmitter<{ from: string; to: string }>();
    const onDidChangePanelVisibility = new vscode.EventEmitter<boolean>();
    return {
        getCurrentVisibility: () => false,
        onDidChangeViewNavigation: onDidChangeViewNavigation.event,
        onDidChangePanelVisibility: onDidChangePanelVisibility.event,
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
    tmpDir: string;
    configState: MutableConfigState;
    capturedConfigListener: () => ((e: vscode.ConfigurationChangeEvent) => void) | undefined;
    dispose: () => Promise<void>;
}

async function makeWiringHarness(initial: MutableConfigState): Promise<WiringHarness> {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wiring-test-'));
    const configState: MutableConfigState = { ...initial };

    // STEP 1: Install config stub BEFORE wireSessionRecorder runs.
    const configStub = installConfigStub(configState);

    // STEP 2: Stub onDidChangeConfiguration to capture the listener.
    let captured: ((e: vscode.ConfigurationChangeEvent) => void) | undefined;
    const onConfigStub = sinon.stub(vscode.workspace, 'onDidChangeConfiguration').callsFake((listener: (e: vscode.ConfigurationChangeEvent) => void) => {
        captured = listener;
        return new vscode.Disposable(() => { /* noop */ });
    });

    // STEP 3: Construct manager and wiring.
    const telemetryManager = new TelemetryManager();
    const ctx = { globalStorageUri: vscode.Uri.file(tmpDir), subscriptions: [] } as unknown as vscode.ExtensionContext;
    const wiring = wireSessionRecorder({
        context: ctx,
        consentService: stubConsent(true),
        artemisWebsocketService: stubWebsocket(),
        telemetryManager,
        artemisWebviewProvider: stubWebviewProvider(),
        chatWebviewProvider: stubChatProvider(),
        capabilities: undefined,
        exerciseRegistry: undefined,
    });

    return {
        telemetryManager,
        recorder: wiring.sessionRecorder,
        tmpDir,
        configState,
        capturedConfigListener: () => captured,
        dispose: async () => {
            wiring.disposable.dispose();
            try { await wiring.sessionRecorder.dispose(); } catch { /* ignore */ }
            telemetryManager.dispose();
            onConfigStub.restore();
            configStub.restore();
            try { await fs.rm(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
        },
    };
}

suite('sessionRecorderWiring — suppression and configuration provenance', () => {
    test('suppression event is recorded as action=suppressed', async () => {
        const harness = await makeWiringHarness({ enabled: true, showInterventions: true, developerMode: false });
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
        const harness = await makeWiringHarness({ enabled: true, showInterventions: false, developerMode: false });
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

    test('configurationChange is recorded when the listener fires', async () => {
        // Initial config: showInterventions=true. Listener caches that on construction.
        const harness = await makeWiringHarness({ enabled: true, showInterventions: true, developerMode: false });
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
