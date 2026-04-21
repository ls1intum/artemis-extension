import * as vscode from 'vscode';
import type { ConsentService } from '../services/auth';
import type { ArtemisWebsocketService } from '../services/websocket';
import type { TelemetryManager, SessionRecorder } from '../services/telemetry';
import { RecordingStatusBarService as RecordingStatusBarServiceImpl, SessionRecorder as SessionRecorderImpl } from '../services/telemetry';
import type { RecordedEvent } from '../services/telemetry/recording/types';
import type { ArtemisWebviewProvider, ChatWebviewProvider } from '../provider';
import type { PlatformCapabilities } from '../theia';

export interface RecorderWiringDeps {
    context: vscode.ExtensionContext;
    consentService: ConsentService;
    artemisWebsocketService: ArtemisWebsocketService;
    telemetryManager: TelemetryManager;
    artemisWebviewProvider: ArtemisWebviewProvider;
    chatWebviewProvider: ChatWebviewProvider;
    capabilities?: PlatformCapabilities;
}

export interface RecorderWiringResult {
    sessionRecorder: SessionRecorder;
    disposable: vscode.Disposable;
}

export function wireSessionRecorder(deps: RecorderWiringDeps): RecorderWiringResult {
    const {
        context, consentService, artemisWebsocketService,
        telemetryManager, artemisWebviewProvider, chatWebviewProvider,
        capabilities,
    } = deps;

    const sessionRecorder = new SessionRecorderImpl(context.globalStorageUri, capabilities);

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

    // ── Startup contributors ─────────────────────────────────────────
    // These run synchronously inside SessionRecorder._doStart, between the
    // initial-state events and the `startupPhaseComplete` marker. They
    // replace the old onDidChangeState seeding path (which fired after the
    // first user event, not deterministically at session start).

    // EQ engine state seeding
    disposables.push(sessionRecorder.registerStartupContributor((ctx): RecordedEvent[] => {
        const eqState = telemetryManager.getEqEngineState();
        if (eqState.snapshots.length === 0) {
            return [];
        }
        return [{
            type: 'eqEngineState',
            timestamp: ctx.timestamp,
            snapshots: eqState.snapshots.map(s => ({
                timestamp: s.timestamp,
                hasErrors: s.hasErrors,
                errorFamilies: [...s.errorFamilies],
                errorCount: s.errorCount,
            })),
            currentEQ: eqState.currentEQ,
            pairCount: eqState.pairCount,
            confidence: eqState.confidence,
        }];
    }));

    // Panel visibility seeds — snapshot what is visible at session start.
    disposables.push(sessionRecorder.registerStartupContributor((ctx): RecordedEvent[] => {
        return [
            {
                type: 'panelVisibility',
                timestamp: ctx.timestamp,
                panel: 'artemis',
                visible: artemisWebviewProvider.getCurrentVisibility(),
            },
            {
                type: 'panelVisibility',
                timestamp: ctx.timestamp,
                panel: 'chat',
                visible: chatWebviewProvider.getCurrentVisibility(),
            },
        ];
    }));

    // Recording status bar button
    const recordingStatusBar = new RecordingStatusBarServiceImpl(
        sessionRecorder,
        () => chatWebviewProvider.getSelectedExerciseId(),
    );
    disposables.push(recordingStatusBar);

    return {
        sessionRecorder,
        disposable: vscode.Disposable.from(...disposables),
    };
}
