import * as vscode from 'vscode';
import type { ArtemisWebsocketService, TelemetryManager, ConsentService, SessionRecorder } from '../services';
import { RecordingStatusBarService as RecordingStatusBarServiceImpl, SessionRecorder as SessionRecorderImpl } from '../services';
import type { ArtemisWebviewProvider, ChatWebviewProvider } from '../provider';

export interface RecorderWiringDeps {
    context: vscode.ExtensionContext;
    consentService: ConsentService;
    artemisWebsocketService: ArtemisWebsocketService;
    telemetryManager: TelemetryManager;
    artemisWebviewProvider: ArtemisWebviewProvider;
    chatWebviewProvider: ChatWebviewProvider;
}

export interface RecorderWiringResult {
    sessionRecorder: SessionRecorder;
    disposable: vscode.Disposable;
}

export function wireSessionRecorder(deps: RecorderWiringDeps): RecorderWiringResult {
    const {
        context, consentService, artemisWebsocketService,
        telemetryManager, artemisWebviewProvider, chatWebviewProvider,
    } = deps;

    const sessionRecorder = new SessionRecorderImpl(context.globalStorageUri);

    if (consentService.isExtendedCollectionEnabled) {
        sessionRecorder.enable();
    }

    const disposables: vscode.Disposable[] = [];

    // Consent changes toggle recording
    disposables.push(consentService.onConsentChanged(level => {
        if (level === 'extended') {
            sessionRecorder.enable();
        } else {
            sessionRecorder.disable();
        }
    }));

    // WebSocket message handler registration (with proper teardown)
    artemisWebsocketService.registerMessageHandler(sessionRecorder);
    disposables.push(new vscode.Disposable(() => {
        artemisWebsocketService.unregisterMessageHandler(sessionRecorder);
    }));

    // Chat message events
    disposables.push(chatWebviewProvider.onDidSendIrisChatMessage(text => {
        sessionRecorder.recordIrisChatSent(text);
    }));
    disposables.push(chatWebviewProvider.websocketMessageHandler.onDidReceiveIrisChatMessage(content => {
        sessionRecorder.recordIrisChatReceived(content);
    }));

    // Telemetry EQ events
    disposables.push(telemetryManager.onDidCalculateEQ(({ eq, confidence, source, triggerType }) => {
        sessionRecorder.recordEqSnapshot(eq, confidence, source, triggerType);
    }));
    disposables.push(telemetryManager.onDidShowIntervention(decision => {
        sessionRecorder.recordIntervention(
            'shown', decision.level as 'subtle' | 'notification' | 'proactive',
            decision.shouldIntervene, decision.eq, decision.confidence, decision.triggerType,
        );
    }));
    disposables.push(telemetryManager.onDidAcceptIntervention(decision => {
        sessionRecorder.recordIntervention(
            'accepted', decision.level as 'subtle' | 'notification' | 'proactive',
            decision.shouldIntervene, decision.eq, decision.confidence, decision.triggerType,
        );
    }));
    disposables.push(telemetryManager.onDidDismissIntervention(decision => {
        sessionRecorder.recordIntervention(
            'dismissed', decision.level as 'subtle' | 'notification' | 'proactive',
            decision.shouldIntervene, decision.eq, decision.confidence, decision.triggerType,
        );
    }));

    // Provider navigation/visibility events
    disposables.push(artemisWebviewProvider.onDidChangeViewNavigation(({ from, to }) => {
        sessionRecorder.recordViewNavigation(from, to);
    }));
    disposables.push(artemisWebviewProvider.onDidChangePanelVisibility(visible => {
        sessionRecorder.recordPanelVisibility('artemis', visible);
    }));
    disposables.push(chatWebviewProvider.onDidChangePanelVisibility(visible => {
        sessionRecorder.recordPanelVisibility('chat', visible);
    }));

    // EQ engine state seeding on recording start
    disposables.push(sessionRecorder.onDidChangeState(state => {
        if (state.isRecording && state.eventCount <= 1) {
            const eqState = telemetryManager.getEqEngineState();
            if (eqState.snapshots.length > 0) {
                sessionRecorder.recordEqEngineState(
                    eqState.snapshots.map(s => ({
                        timestamp: s.timestamp,
                        hasErrors: s.hasErrors,
                        errorFamilies: [...s.errorFamilies],
                        errorCount: s.errorCount,
                    })),
                    eqState.currentEQ,
                    eqState.pairCount,
                    eqState.confidence,
                );
            }
        }
    }));

    // Recording status bar button
    const recordingStatusBar = new RecordingStatusBarServiceImpl(
        sessionRecorder,
        () => chatWebviewProvider.getSelectedExerciseId(),
    );
    disposables.push(recordingStatusBar);

    return {
        sessionRecorder,
        disposable: vscode.Disposable.from(sessionRecorder, ...disposables),
    };
}
