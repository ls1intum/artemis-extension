import * as vscode from 'vscode';

import type { ArtemisWebviewProvider, ChatWebviewProvider } from '@extension/provider';
import type { ConsentService } from '@extension/services/auth/consentService';
import type { ExerciseRegistry } from '@extension/services/exerciseRegistry';
import type { SessionRecorder } from '@extension/services/recording';
import {
    RecordingStatusBarService as RecordingStatusBarServiceImpl,
    SessionRecorder as SessionRecorderImpl,
} from '@extension/services/recording';
import {
    collectInitialBreakpointSnapshot,
} from '@extension/services/recording/eventCollectors';
import type { RecordedEvent } from '@extension/services/recording/types';
import type { SensorHub } from '@extension/services/sensing';
import { SPEC } from '@extension/services/struggle/config';
import type { ArtemisWebsocketService } from '@extension/services/websocket';
import type { WorkspaceExerciseTracker } from '@extension/services/workspace/workspaceExerciseTracker';
import type { IStruggleCoordinator } from '@extension/telemetry/contract';
import type { PlatformCapabilities } from '@extension/theia';

interface RecorderWiringDeps {
    context: vscode.ExtensionContext;
    consentService: ConsentService;
    artemisWebsocketService: ArtemisWebsocketService;
    struggleCoordinator: IStruggleCoordinator;
    artemisWebviewProvider: ArtemisWebviewProvider;
    chatWebviewProvider: ChatWebviewProvider;
    capabilities?: PlatformCapabilities;
    exerciseRegistry?: ExerciseRegistry;
    sensorHub: SensorHub;
    workspaceTracker: WorkspaceExerciseTracker;
}

interface RecorderWiringResult {
    sessionRecorder: SessionRecorder;
    disposable: vscode.Disposable;
}

export function wireSessionRecorder(deps: RecorderWiringDeps): RecorderWiringResult {
    const {
        context, consentService, artemisWebsocketService,
        struggleCoordinator, artemisWebviewProvider, chatWebviewProvider,
        capabilities, exerciseRegistry, sensorHub, workspaceTracker,
    } = deps;

    const sessionRecorder = new SessionRecorderImpl(context.globalStorageUri, capabilities, exerciseRegistry, undefined, sensorHub);

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

    // Recorder feed: per-tick struggle score + emitted alerts. The coordinator
    // delegates onDidTick/onDidAlert from the engine; recording is bundle-excluded
    // so the coordinator never imports the recorder (Decision 1).
    disposables.push(struggleCoordinator.onDidTick(tick => {
        sessionRecorder.recordStruggleScore({
            t: tick.t,
            fTyping: tick.features.fTyping, fGap: tick.features.fGap,
            typingRate: tick.features.typingRate, longestGapS: tick.features.longestGapS,
        });
    }));
    disposables.push(struggleCoordinator.onDidAlert(alert => {
        sessionRecorder.recordAlert(alert.kind === 'edit'
            ? {
                kind: 'edit', t: alert.t, urgency: alert.urgency,
                types: [...alert.types], primary: alert.primary,
                path: alert.path, inWarmup: alert.inWarmup, inGrace: alert.inGrace, theta: SPEC.THETA_FULL,
            }
            : {
                kind: 'discrete', t: alert.t, urgency: alert.urgency,
                trigger: alert.trigger, inWarmup: alert.inWarmup, theta: SPEC.THETA_FULL,
            });
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

    // Problem-statement reading events flow from the webview via
    // ProblemStatementTrackingCommandModule -> ArtemisWebviewProvider.fireXxx -> here.
    disposables.push(artemisWebviewProvider.onDidProblemStatementScroll(payload => {
        sessionRecorder.recordProblemStatementScroll(payload);
    }));
    disposables.push(artemisWebviewProvider.onDidProblemStatementSelection(payload => {
        sessionRecorder.recordProblemStatementSelection(payload);
    }));

    // Submission tracking. Provider events flow from handleSubmitExercise ->
    // ArtemisWebviewProvider.fireSubmission -> here.
    disposables.push(artemisWebviewProvider.onDidSubmission(payload => {
        sessionRecorder.recordSubmission(payload);
    }));

    // ── Startup contributors ─────────────────────────────────────────
    // These run synchronously inside SessionRecorder._doStart, between the
    // initial-state events and the `startupPhaseComplete` marker. They
    // replace the old onDidChangeState seeding path (which fired after the
    // first user event, not deterministically at session start).

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

    // Configuration snapshot: legacy compatibility fields (#352). The settings were
    // removed, so both values are pinned true; kept only so old and new recordings
    // share one schema. engineVersion remains meaningful.
    disposables.push(sessionRecorder.registerStartupContributor((ctx): RecordedEvent[] => {
        return [{
            type: 'configurationSnapshot',
            timestamp: ctx.timestamp,
            struggleDetectionEnabled: true,
            showInterventions: true,
            engineVersion: 'v3',
        }];
    }));

    // Initial breakpoint snapshot — onDidChangeBreakpoints is delta-only, so
    // breakpoints already set when recording starts would otherwise be invisible
    // in replay. Breakpoints are workspace-global, independent of debug sessions.
    disposables.push(sessionRecorder.registerStartupContributor((ctx): RecordedEvent[] => {
        const root = ctx.exerciseRoot ? vscode.Uri.parse(ctx.exerciseRoot) : undefined;
        const snapshot = collectInitialBreakpointSnapshot(sensorHub.readBreakpoints(), root, ctx.timestamp);
        return snapshot ? [snapshot] : [];
    }));

    // Recording status bar button
    const recordingStatusBar = new RecordingStatusBarServiceImpl(
        sessionRecorder,
        () => workspaceTracker.exerciseId,
    );
    disposables.push(recordingStatusBar);

    return {
        sessionRecorder,
        disposable: vscode.Disposable.from(...disposables),
    };
}
