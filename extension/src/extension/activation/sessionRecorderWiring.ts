import * as vscode from 'vscode';

import type { ArtemisWebviewProvider, ChatWebviewProvider } from '@extension/provider';
import type { ConsentService } from '@extension/services/auth';
import type { ExerciseRegistry } from '@extension/services/exerciseRegistry';
import type { ContextStore } from '@extension/services/iris/context/contextStore';
import type { SessionRecorder, TelemetryManager } from '@extension/services/telemetry';
import {
    RecordingStatusBarService as RecordingStatusBarServiceImpl,
    SessionRecorder as SessionRecorderImpl,
} from '@extension/services/telemetry';
import {
    collectInitialBreakpointSnapshot,
} from '@extension/services/telemetry/recording/eventCollectors';
import type { RecordedEvent } from '@extension/services/telemetry/recording/types';
import type { ArtemisWebsocketService } from '@extension/services/websocket';
import type { PlatformCapabilities } from '@extension/theia';
import { VSCODE_CONFIG } from '@extension/utils/constants';

interface RecorderWiringDeps {
    context: vscode.ExtensionContext;
    consentService: ConsentService;
    artemisWebsocketService: ArtemisWebsocketService;
    telemetryManager: TelemetryManager;
    artemisWebviewProvider: ArtemisWebviewProvider;
    chatWebviewProvider: ChatWebviewProvider;
    capabilities?: PlatformCapabilities;
    exerciseRegistry?: ExerciseRegistry;
    contextStore: ContextStore;
}

interface RecorderWiringResult {
    sessionRecorder: SessionRecorder;
    disposable: vscode.Disposable;
}

export function wireSessionRecorder(deps: RecorderWiringDeps): RecorderWiringResult {
    const {
        context, consentService, artemisWebsocketService,
        telemetryManager, artemisWebviewProvider, chatWebviewProvider,
        capabilities, exerciseRegistry, contextStore,
    } = deps;

    const sessionRecorder = new SessionRecorderImpl(context.globalStorageUri, capabilities, exerciseRegistry);

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
    disposables.push(chatWebviewProvider.websocketMessageHandler.onDidReceiveIrisChatMessage(msg => {
        sessionRecorder.recordIrisChatReceived(msg.content, msg.messageId, msg.sessionId, msg.sentAt);
    }));

    // Chat send-attempt lifecycle (pending/sent/failed)
    disposables.push(chatWebviewProvider.onDidAttemptIrisChatSend(({ content, status, errorMessage }) => {
        sessionRecorder.recordIrisChatSendAttempt(content, status, errorMessage);
    }));

    // Chat feedback
    disposables.push(chatWebviewProvider.onDidProvideIrisChatFeedback(({ messageId, helpful }) => {
        sessionRecorder.recordIrisChatFeedback(messageId, helpful);
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
    disposables.push(telemetryManager.onDidDismissIntervention(payload => {
        sessionRecorder.recordIntervention(
            'dismissed', payload.level as 'subtle' | 'notification' | 'proactive',
            payload.shouldIntervene, payload.eq, payload.confidence, payload.triggerType,
            { dismissReason: payload.dismissReason },
        );
    }));
    disposables.push(telemetryManager.onDidBlockIntervention(({ decision }) => {
        sessionRecorder.recordIntervention(
            'blocked', decision.level as 'subtle' | 'notification' | 'proactive',
            false, decision.eq, decision.confidence, decision.triggerType,
            { blockedReason: decision.blockedReason, rawWanted: true },
        );
    }));
    disposables.push(telemetryManager.onDidSuppressIntervention(({ decision, reason }) => {
        sessionRecorder.recordIntervention(
            'suppressed', decision.level as 'subtle' | 'notification' | 'proactive',
            decision.shouldIntervene, decision.eq, decision.confidence, decision.triggerType,
            { suppressionReason: reason, rawWanted: decision.rawWanted },
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

    // Test-results view tracking. Provider events flow from the webview commands
    // via testResultsTrackingCommands -> ArtemisWebviewProvider.fireXxx -> here.
    disposables.push(artemisWebviewProvider.onDidOpenTestResultsOverview(payload => {
        sessionRecorder.recordTestResultsOverviewOpened(payload);
    }));
    disposables.push(artemisWebviewProvider.onDidCloseTestResultsOverview(payload => {
        sessionRecorder.recordTestResultsOverviewClosed(payload);
    }));
    disposables.push(artemisWebviewProvider.onDidOpenTaskFeedback(payload => {
        sessionRecorder.recordTaskFeedbackOpened(payload);
    }));
    disposables.push(artemisWebviewProvider.onDidCloseTaskFeedback(payload => {
        sessionRecorder.recordTaskFeedbackClosed(payload);
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

    // Configuration snapshot — captures struggle-detection setting values at
    // session start so analysis can classify control vs treatment sessions.
    disposables.push(sessionRecorder.registerStartupContributor((ctx): RecordedEvent[] => {
        const struggleConfig = vscode.workspace.getConfiguration(VSCODE_CONFIG.STRUGGLE_DETECTION.SECTION);
        const enabled = struggleConfig.get<boolean>(VSCODE_CONFIG.STRUGGLE_DETECTION.ENABLED_KEY, true);
        const rawShow = struggleConfig.get<unknown>(VSCODE_CONFIG.STRUGGLE_DETECTION.SHOW_INTERVENTIONS_KEY, true);
        const showInterventions = typeof rawShow === 'boolean' ? rawShow : true;
        return [{
            type: 'configurationSnapshot',
            timestamp: ctx.timestamp,
            struggleDetectionEnabled: enabled,
            showInterventions,
        }];
    }));

    // Initial breakpoint snapshot — onDidChangeBreakpoints is delta-only, so
    // breakpoints already set when recording starts would otherwise be invisible
    // in replay. Breakpoints are workspace-global, independent of debug sessions.
    disposables.push(sessionRecorder.registerStartupContributor((ctx): RecordedEvent[] => {
        const root = ctx.exerciseRoot ? vscode.Uri.parse(ctx.exerciseRoot) : undefined;
        const snapshot = collectInitialBreakpointSnapshot(vscode.debug.breakpoints, root, ctx.timestamp);
        return snapshot ? [snapshot] : [];
    }));

    // Runtime configuration changes for struggle-detection settings — recorded
    // so mid-session flips can be reconciled with intervention events by timestamp.
    const readStruggleEnabled = (): boolean => {
        const cfg = vscode.workspace.getConfiguration(VSCODE_CONFIG.STRUGGLE_DETECTION.SECTION);
        return cfg.get<boolean>(VSCODE_CONFIG.STRUGGLE_DETECTION.ENABLED_KEY, true);
    };
    const readShowInterventions = (): boolean => {
        const cfg = vscode.workspace.getConfiguration(VSCODE_CONFIG.STRUGGLE_DETECTION.SECTION);
        const raw = cfg.get<unknown>(VSCODE_CONFIG.STRUGGLE_DETECTION.SHOW_INTERVENTIONS_KEY, true);
        return typeof raw === 'boolean' ? raw : true;
    };
    let lastStruggleEnabled = readStruggleEnabled();
    let lastShowInterventions = readShowInterventions();

    disposables.push(vscode.workspace.onDidChangeConfiguration(event => {
        if (!event.affectsConfiguration(VSCODE_CONFIG.STRUGGLE_DETECTION.SECTION)) {
            return;
        }
        const newEnabled = readStruggleEnabled();
        const newShow = readShowInterventions();
        const changes: { struggleDetectionEnabled?: boolean; showInterventions?: boolean } = {};
        if (newEnabled !== lastStruggleEnabled) {
            changes.struggleDetectionEnabled = newEnabled;
            lastStruggleEnabled = newEnabled;
        }
        if (newShow !== lastShowInterventions) {
            changes.showInterventions = newShow;
            lastShowInterventions = newShow;
        }
        if (Object.keys(changes).length > 0) {
            sessionRecorder.recordConfigurationChange(changes);
        }
    }));

    // Recording status bar button
    const recordingStatusBar = new RecordingStatusBarServiceImpl(
        sessionRecorder,
        () => contextStore.getWorkspaceExerciseId(),
    );
    disposables.push(recordingStatusBar);

    return {
        sessionRecorder,
        disposable: vscode.Disposable.from(...disposables),
    };
}
