import * as vscode from 'vscode';

import type { WebCmd, WebviewToExtensionMessage } from '@shared/messageContracts';
import { ExtensionMsg, getPayload, WebviewCmd } from '@shared/messageContracts';
import type { ServerContext, SessionDetail } from '@shared/types/serverContext';

import { ArtemisApiService } from '@extension/api';
import { openFileInWorkspace, openSettings } from '@extension/controller/commands/utilityCommands';
import { isIrisCourseDisabled } from '@extension/domain/errors';
import type { CourseCatalog } from '@extension/services/courseCatalog';
import { ExerciseRegistry } from '@extension/services/exerciseRegistry';
import {
    ChatDiagnosticsService,
    ContextStore,
    IRIS_CHAT_HELP_MARKDOWN,
    IrisAvailabilityService,
    IrisWebSocketMessageHandler,
    IrisWebSocketSessionClient,
} from '@extension/services/iris';
import { historyResolvesRun } from '@extension/services/iris/chat/historyResolution';
import type { AvailabilityContext } from '@extension/services/iris/chat/irisAvailabilityService';
import { resolveCourseIdForExercise } from '@extension/services/iris/context/courseIdResolver';
import { collectUncommittedFiles } from '@extension/services/iris/conversation/collectUncommittedFiles';
import type { CourseSwitchOutcome, StartOutcome, TopicChangeOutcome } from '@extension/services/iris/conversation/conversationService';
import { IrisConversationService } from '@extension/services/iris/conversation/conversationService';
import { toWireMessages } from '@extension/services/iris/conversation/messageFormatting';
import { SEND_REJECTION_MESSAGES, SendCoordinator } from '@extension/services/iris/conversation/sendCoordinator';
import { createRunLifecycle, IrisRunStateMachine } from '@extension/services/iris/irisRunStateMachine';
import type { DetectionUiState } from '@extension/services/iris/startup/chatStartupCoordinator';
import { ChatStartupCoordinator } from '@extension/services/iris/startup/chatStartupCoordinator';
import { LogCategory, logger } from '@extension/services/loggingService';
import type { ITelemetryManager, StruggleContext } from '@extension/services/telemetry';
import { getReactWebviewHtml } from '@extension/services/ui';
import { ArtemisWebsocketService } from '@extension/services/websocket';
import {
    FileMonitorService,
    getEntryExercises,
    NoAiDetectionService,
    toExerciseSource,
} from '@extension/services/workspace';
import type { DetectionOutcome } from '@extension/services/workspace/detectionOutcome';
import type { WorkspaceExercise, WorkspaceExerciseTracker } from '@extension/services/workspace/workspaceExerciseTracker';
import type { IChatWebviewProvider } from '@extension/types/IChatWebviewProvider';

import { BaseWebviewProvider } from './baseWebviewProvider';
import { ChatViewStatePresenter } from './chatViewStatePresenter';

interface ExerciseContextChangeEvent {
    exerciseId: number;
    previousExerciseId?: number;
    exerciseRoot?: vscode.Uri;
}

/** The four navigations the webview can ask for. Each has its own refusal surface. */
type NavigationCommand = 'selectTopic' | 'openConversation' | 'switchCourse' | 'newConversation';

/**
 * Generation-scoped baseline for missed-terminal-frame recovery. A bare id is
 * not enough: `generation` is the anti-stale key that lets a POST for an older
 * send be told apart from the still-current one.
 *
 * Keyed on the CONVERSATION, like everything else on this path.
 */
interface RecoveryBaseline {
    generation: number;      // _runs.generation at dispatch; the anti-stale key
    sessionId: number;       // the conversation the send went to
    baselineMessageId: number;
}

/**
 * Wording for a navigation that could not be made. The course switch no longer
 * reaches this with a disabled course (the service enters it instead), but
 * opening a history row in one still can, and a "please try again" would
 * promise something no retry can deliver.
 */
function navigationFailureMessage(error: unknown, fallback: string): string {
    return isIrisCourseDisabled(error) ? 'Iris chat is not enabled for that course.' : fallback;
}

export class ChatWebviewProvider extends BaseWebviewProvider implements vscode.WebviewViewProvider, vscode.Disposable, IChatWebviewProvider {
    // ── Static properties ──────────────────────────────────────────────
    public static readonly viewType = 'iris.chatView';

    // ── Instance properties ────────────────────────────────────────────
    private readonly _contextStore: ContextStore;
    private readonly _workspaceTracker: WorkspaceExerciseTracker;
    private readonly _viewStatePresenter: ChatViewStatePresenter;
    private _fileMonitorService: FileMonitorService;
    private _irisSessionManager?: IrisWebSocketSessionClient;
    /**
     * The Iris conversation service: the single owner of the open
     * conversation. Optional because both `_artemisApiService` and
     * `_irisSessionManager` are optional at baseline; every consumer must
     * guard on it rather than assume it.
     */
    private _conversation: IrisConversationService | undefined;
    /** The send path. Built next to `_conversation`. */
    private _sendCoordinator: SendCoordinator | undefined;
    /**
     * The single owner of the automatic cold start. `resolveWebviewView` only
     * reports that the view exists (`onViewResolved`); `attachStartupDetection`
     * feeds it workspace-detection outcomes. The coordinator itself decides
     * when both have arrived and calls `_acquireConversation` exactly once.
     */
    private readonly _startupCoordinator: ChatStartupCoordinator;
    /**
     * The coordinator's latest published detection state, read by the
     * presenter's `_getDetectionState` getter and put on the wire in every
     * `updateIrisState` snapshot.
     */
    private _detectionState: DetectionUiState = 'unsettled';
    /**
     * The workspace-detection handle (from `wireWorkspaceDetection`), wired by
     * `attachStartupDetection` at activation. Until then there is nothing for
     * the startup Retry to re-run.
     */
    private _detectionHandle: { retry(): void } | undefined;
    /** Generation opened by the most recent send, for the reconnect marker. */
    private _lastSendGeneration: number | undefined;
    /** Last conversation announced to the webview, so a navigation can be told
     *  apart from a plain state emit (an overview refresh, a send settling). */
    private _lastAnnouncedSessionId: number | undefined;
    private _chatDiagnosticsService: ChatDiagnosticsService;
    private _availability: IrisAvailabilityService;
    private _websocketMessageHandler: IrisWebSocketMessageHandler;
    private _noAiDetectionService: NoAiDetectionService;

    /**
     * Single owner of the Iris run state machine. Injected into the WS handler
     * (which drives it from inbound frames) and, via narrow callbacks, into the
     * message + session services (which drive the send lifecycle and resets).
     */
    private readonly _runs = new IrisRunStateMachine();

    /** Baseline for missed-terminal-frame recovery. `undefined` when no send is
     *  outstanding. Opened on each successful POST, cleared on navigation. */
    private _recovery: RecoveryBaseline | undefined;

    private readonly _onDidChangeExerciseContext = new vscode.EventEmitter<ExerciseContextChangeEvent>();
    public readonly onDidChangeExerciseContext = this._onDidChangeExerciseContext.event;

    /** Last workspace exercise announced through `onDidChangeExerciseContext`,
     *  so the event can still carry `previousExerciseId`. The store's own
     *  workspace event reports only the current one. */
    private _lastWorkspaceExerciseId: number | undefined;

    private readonly _onDidSendIrisChatMessage = new vscode.EventEmitter<string>();
    public readonly onDidSendIrisChatMessage = this._onDidSendIrisChatMessage.event;

    /**
     * Fired at each stage of a send attempt:
     *   - { status: 'pending' }   immediately before the API call
     *   - { status: 'sent' }      after the API call succeeds
     *   - { status: 'failed', errorMessage }  after the API call throws
     *
     * Consumers (e.g. sessionRecorderWiring) use this to record the full
     * send lifecycle, including failed sends that never become irisChatMessage events.
     */
    private readonly _onDidAttemptIrisChatSend = new vscode.EventEmitter<{
        content: string;
        status: 'pending' | 'sent' | 'failed';
        errorMessage?: string;
    }>();
    public readonly onDidAttemptIrisChatSend = this._onDidAttemptIrisChatSend.event;

    /**
     * Fired when the user submits helpful/unhelpful feedback for a message.
     * The event is emitted AFTER the API call has been dispatched (fire-and-forget
     * from the recording perspective — we don't wait for the server's ack).
     */
    private readonly _onDidProvideIrisChatFeedback = new vscode.EventEmitter<{
        messageId: string;
        helpful: boolean;
    }>();
    public readonly onDidProvideIrisChatFeedback = this._onDidProvideIrisChatFeedback.event;

    private readonly _onDidChangePanelVisibility = new vscode.EventEmitter<boolean>();
    public readonly onDidChangePanelVisibility = this._onDidChangePanelVisibility.event;

    // ── Constructor ────────────────────────────────────────────────────
    constructor(
        private readonly _extensionUri: vscode.Uri,
        _extensionContext: vscode.ExtensionContext,
        private readonly _artemisApiService: ArtemisApiService | undefined,
        private readonly _websocketService: ArtemisWebsocketService | undefined,
        noAiDetectionService: NoAiDetectionService,
        private readonly _exerciseRegistry: ExerciseRegistry,
        private readonly _courseCatalog: CourseCatalog | undefined,
        private readonly _telemetryManager: ITelemetryManager | undefined,
        contextStore: ContextStore,
        workspaceTracker: WorkspaceExerciseTracker,
    ) {
        super(LogCategory.IRIS_CHAT);
        this._disposables.push(this._onDidChangeExerciseContext);
        this._disposables.push(this._onDidSendIrisChatMessage);
        this._disposables.push(this._onDidAttemptIrisChatSend);
        this._disposables.push(this._onDidProvideIrisChatFeedback);
        this._disposables.push(this._onDidChangePanelVisibility);
        this._contextStore = contextStore;
        this._workspaceTracker = workspaceTracker;
        // Struggle detection follows the WORKSPACE, never the chat topic: the
        // detector observes the code that is open, and `workspaceDetectionService`
        // derives that from the folder's git remote. A topic change points the
        // chat at an exercise whose code is usually not open at all, so it must
        // not retarget the detector.
        this._disposables.push(
            this._workspaceTracker.onDidChange((current) => {
                // A clear announces nothing: there is no exercise to start a
                // session for, and the id stays remembered so the NEXT
                // workspace exercise can still report what it replaced.
                if (!current) { return; }
                const previousExerciseId = this._lastWorkspaceExerciseId;
                this._lastWorkspaceExerciseId = current.id;
                this._onDidChangeExerciseContext.fire({
                    exerciseId: current.id,
                    previousExerciseId,
                    exerciseRoot: vscode.workspace.workspaceFolders?.[0]?.uri,
                });
            })
        );
        this._viewStatePresenter = new ChatViewStatePresenter(
            this._contextStore,
            (msg) => this._postMessageSafe(msg),
            // A getter, not a value: `_conversation` is assigned further down
            // in this same constructor (and is `undefined` until then), so
            // capturing it by value here would capture `undefined` forever.
            // Same reasoning as the `_websocketMessageHandler` getter below.
            () => this._conversation,
            // A getter, not a value: `_detectionState` is mutated in place by
            // `publishDetectionState` below (`ChatStartupCoordinator`'s only
            // way to report progress), so capturing it by value here would
            // freeze the snapshot at whatever it was when the presenter was
            // constructed (always `'unsettled'`).
            () => this._detectionState,
        );
        this._fileMonitorService = new FileMonitorService();
        this._disposables.push(this._fileMonitorService);

        this._chatDiagnosticsService = new ChatDiagnosticsService(
            this._contextStore,
            this._exerciseRegistry,
            // A getter for the same reason as the presenter's: `_conversation`
            // is assigned further down in this constructor.
            () => this._conversation,
        );
        this._availability = new IrisAvailabilityService(
            this._contextStore,
            this._artemisApiService,
            (msg) => this._postMessageSafe(msg),
        );
        this._websocketMessageHandler = new IrisWebSocketMessageHandler(
            this._websocketService,
            () => this._irisSessionManager,
            (message) => this._postMessageSafe(message),
            this._runs,
            // A getter, not a value: `_conversation` is assigned further down in
            // this same constructor (and is `undefined` until then), so capturing
            // it by value here would capture `undefined` forever.
            () => this._conversation,
        );

        if (this._artemisApiService && this._websocketService) {
            this._irisSessionManager = new IrisWebSocketSessionClient(this._websocketService);
            this._disposables.push(this._irisSessionManager);
            // Constructed right where the session client is, so both exist
            // together. `_drainDisposables` pops LIFO, so pushing the service
            // AFTER the client disposes it BEFORE the client: no in-flight
            // install can subscribe to an already-disposed client.
            this._conversation = this._createConversationService(this._irisSessionManager);
            if (this._conversation) {
                this._disposables.push(this._conversation);
                this._sendCoordinator = this._createSendCoordinator(this._conversation);
                // The single repaint trigger for the conversation-first state:
                // every service mutation ends in an emit, so the webview never
                // has to be told about a navigation twice.
                this._disposables.push(
                    this._conversation.onDidChange(() => {
                        this._onConversationChanged();
                        this._viewStatePresenter.postSnapshot();
                    }),
                );
            }

            this._disposables.push(
                this._irisSessionManager.onDidReceiveMessage(({ frame, sourceSessionId }) =>
                    this._websocketMessageHandler.handleIrisWebSocketMessage(frame, sourceSessionId))
            );
            this._disposables.push(
                this._irisSessionManager.onDidConnectionStateChange(() => this._websocketMessageHandler.publishCurrentStatus())
            );
            // ONE subscription, one owner. subscribeToSession only records
            // intent, so an install can complete while the STOMP subscription
            // is still pending or being retried after a throw, and a CTXSWAP in
            // that gap is simply never heard. onDidResubscribe fires at the one
            // moment that is true for both a first subscribe and a reconnect,
            // which is also the only moment a missed terminal frame can be
            // recovered.
            this._disposables.push(
                this._irisSessionManager.onDidResubscribe((sessionId) => {
                    void this._recoverOnResubscribe(sessionId);
                }),
            );
        }

        // Constructed unconditionally (not gated on `_conversation` existing)
        // so the field stays non-optional: `_conversationForNavigation` never
        // reaches `admitExplicitIntent` when `_conversation` is undefined, and
        // `_acquireConversation` below already no-ops in that case too.
        this._startupCoordinator = new ChatStartupCoordinator({
            start: (workspace) => this._acquireConversation(workspace),
            publishDetectionState: (state) => {
                this._detectionState = state;
                this._viewStatePresenter.postSnapshot();
            },
            retryDetection: () => this._detectionHandle?.retry(),
        });

        this._disposables.push(
            this._fileMonitorService.onDidUpdateFiles(update => {
                this._postMessageSafe({
                    type: ExtensionMsg.UpdateReferencedFiles,
                    ...update
                });
            })
        );

        this._noAiDetectionService = noAiDetectionService;
        this._disposables.push(
            this._noAiDetectionService.onNoAiStatusChanged(isNoAiDetected => {
                this._postNoAiStatus(isNoAiDetected);
            })
        );
    }

    /**
     * Built next to `_conversation`, so both exist together. `sessionId` is
     * read at CALL time, never captured: this factory runs once and the open
     * conversation changes underneath it. Both bubble callbacks take the ORIGIN
     * session as their first argument, so a bubble is always addressed in the
     * conversation it was drawn in.
     */
    private _createSendCoordinator(conversation: IrisConversationService): SendCoordinator | undefined {
        if (!this._artemisApiService) { return undefined; }
        const runLifecycle = createRunLifecycle(
            this._runs,
            () => this._websocketMessageHandler.resetRunUiAndPublish(),
            () => this._websocketMessageHandler.publishCurrentRunUi(),
        );
        return new SendCoordinator(this._artemisApiService, conversation, {
            runLifecycle: {
                // Remembers the generation the coordinator opened. The reconnect
                // marker needs it, and `SendOutcome` deliberately does not carry
                // it: this callback is the provider's own, so recording it here
                // costs nothing and keeps the recovery of a missed terminal
                // frame (mergeSessionMessages) working after the cut-over.
                beginGeneration: () => {
                    const generation = runLifecycle.beginGeneration();
                    this._lastSendGeneration = generation;
                    return generation;
                },
                abortGeneration: (generation) => runLifecycle.abortGeneration(generation),
            },
            resetRunUiAndPublish: () => this._websocketMessageHandler.resetRunUiAndPublish(),
            collectUncommittedFiles: () => collectUncommittedFiles((msg) => this._postMessageSafe(msg)),
            // Both keys are derived from the ORIGIN session ARGUMENT, never
            // read from provider state: a navigation that completes while the
            // POST is open must not re-address a bubble that was drawn in the
            // conversation the student has just left.
            confirmBubble: (sessionId, localId, id) => {
                if (id === undefined) { return; }
                this._postMessageSafe({
                    type: ExtensionMsg.ConfirmSentMessage,
                    sessionId, localId, id,
                });
            },
            failBubble: (sessionId, localId, reason) => this._postMessageSafe({
                type: ExtensionMsg.SendRejected,
                localId,
                sessionId,
                reason,
                errorMessage: SEND_REJECTION_MESSAGES[reason],
            }),
            reportError: (message) => this._postMessageSafe({ type: ExtensionMsg.OpenSessionError, message }),
            getWorkspaceExerciseId: () => this._workspaceTracker.exerciseId,
        });
    }

    /** Called where `_irisSessionManager` is created, so both exist together. */
    private _createConversationService(client: IrisWebSocketSessionClient): IrisConversationService | undefined {
        if (!this._artemisApiService) { return undefined; }
        return new IrisConversationService(this._artemisApiService, {
            subscribeToSession: (sessionId) => client.subscribeToSession(sessionId),
            leaveSession: () => client.leaveSession(),
            getWorkspaceExercise: () => {
                const exercise = this._workspaceTracker.current;
                return exercise === undefined ? undefined : { exerciseId: exercise.id, courseId: exercise.courseId };
            },
            deliverTranscript: (detail, mode) => this._deliverTranscript(detail, mode),
        });
    }

    /**
     * Renders an installed conversation's transcript. The ONLY producer of the
     * visible message list.
     */
    private _deliverTranscript(detail: SessionDetail, mode: 'load' | 'merge'): void {
        const messages = toWireMessages(detail.messages);
        this._postMessageSafe({
            type: mode === 'merge' ? ExtensionMsg.MergeSessionMessages : ExtensionMsg.LoadMessages,
            sessionId: detail.sessionId,
            messages,
        });
    }

    // ── Lifecycle ──────────────────────────────────────────────────────

    public dispose(): void {
        this._drainDisposables();
    }

    // ── Reconnect recovery ─────────────────────────────────────────────

    /**
     * Reset the run machine AND the recovery baseline together so they can
     * never drift.
     */
    private _resetRunsAndMarker(): void {
        this._recovery = undefined;
        this._websocketMessageHandler.resetRuns();
    }

    /**
     * THE path for a resubscribe: exactly one owner, for both halves of the
     * repair.
     *
     * `IrisConversationService.onSubscriptionActive` re-reads the conversation
     * and merges it (host state and, through `deliverTranscript`, the visible
     * transcript), which recovers the ANSWER. It cannot recover the RUN,
     * because the run machine is the provider's. So this method awaits the
     * reconciliation and then, on conclusive proof only (a persisted assistant
     * message past the send baseline), resolves the run and republishes clean
     * run UI. Without the second half the thinking indicator spins forever
     * after a mid-answer disconnect even though the answer is on screen.
     *
     * Everything is gated so an idle, pre-dispatch or never-bound run resolves
     * nothing, and so a newer send, a same-generation run rebind or a
     * navigation during the reconciliation aborts the resolve.
     */
    private async _recoverOnResubscribe(sessionId: number): Promise<void> {
        const conversation = this._conversation;
        if (!conversation) { return; }

        // Captured BEFORE the await, so the decision is made against the state
        // the resubscribe found, not against whatever it settles into.
        const baseline = this._recovery;
        // pendingGeneration true => the first frame never arrived => the run
        // was never bound, and resolving it would finalize the wrong one.
        const eligible = baseline !== undefined
            && this._runs.waiting
            && !this._runs.pendingGeneration
            && baseline.generation === this._runs.generation
            && baseline.sessionId === sessionId
            && sessionId === conversation.state.snapshot().currentSessionId;
        // Pin the bound run: within ONE generation, admit() can rebind
        // _currentRunId to a later unknown run (A -> C) without bumping the
        // generation. History proving A finished must not then finalize C.
        const boundRunId = this._runs.currentRunId;

        try {
            await conversation.onSubscriptionActive(sessionId);
        } catch (error: unknown) {
            logger.error('Reconnect reconciliation failed', LogCategory.IRIS_CHAT, error);
            return;
        }

        if (!eligible || !baseline || !boundRunId) { return; }
        // Re-validate EVERYTHING after the await.
        if (this._recovery !== baseline
            || this._runs.generation !== baseline.generation
            || this._runs.currentRunId !== boundRunId
            || !this._runs.waiting
            || this._runs.pendingGeneration
            || conversation.state.snapshot().currentSessionId !== baseline.sessionId) {
            return;
        }
        // Persisted history alone cannot prove a run ENDED (a missed FAILED
        // frame leaves no message), so only a newer final assistant message
        // counts. Anything else leaves the run waiting for the manual reload.
        const messages = toWireMessages(conversation.state.snapshot().detail?.messages);
        if (!historyResolvesRun(messages, baseline.baselineMessageId)) { return; }
        this._runs.resolveCurrentRun();
        // A pure WS drop mid-answer never clears the handler's own
        // draft/activities/error (only the webview store is reset on
        // disconnect), so a plain republish would resurrect the stale partial
        // as a phantom duplicate bubble. Clear it here.
        this._websocketMessageHandler.resetRunUiAndPublish();
        this._recovery = undefined;
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        logger.debug('Iris Chat webview being resolved/loaded', LogCategory.VIEW);
        this._drainViewDisposables();
        this._view = webviewView;
        this._resetReadyState();

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.joinPath(this._extensionUri, 'dist'),
                vscode.Uri.joinPath(this._extensionUri, 'media'),
            ],
        };

        webviewView.webview.html = getReactWebviewHtml(webviewView.webview, this._extensionUri, 'irisChat');

        const messageListener = webviewView.webview.onDidReceiveMessage(message => {
            this._handleMessage(message);
        });
        this._viewDisposables.push(messageListener);

        const visibilityListener = webviewView.onDidChangeVisibility(() => {
            this._onDidChangePanelVisibility.fire(webviewView.visible);
            if (webviewView.visible) {
                logger.debug('Iris Chat view became visible, loading data...', LogCategory.VIEW);
                this._sendInitData();
            } else {
                logger.debug('Iris Chat view became hidden', LogCategory.VIEW);
            }
        });
        this._viewDisposables.push(visibilityListener);

        const configListener = vscode.workspace.onDidChangeConfiguration(event => {
            if (event.affectsConfiguration('artemis.developerMode')) {
                this.refreshTheme();
            }
            if (event.affectsConfiguration('artemis.iris.sendUncommittedChanges')) {
                void this._fileMonitorService.triggerUpdate();
            }
        });
        this._viewDisposables.push(configListener);

        // The coordinator owns the one-shot cold start now: it fires
        // `_acquireConversation` only once the view AND workspace detection
        // have both settled, in whichever order they arrive.
        this._startupCoordinator.onViewResolved();
        // Independent of the one-shot acquisition: a recreated webview needs
        // the disabled banner re-evaluated even when the conversation is
        // unchanged and the startup latch has long been consumed.
        void this._refreshAvailability();

        // Init data is sent when the webview signals ready (see _handleMessage / _sendInitData)
    }

    /**
     * The conversation-first acquisition. One call gives the id, the topic, the
     * title and the transcript. Called by the startup coordinator, once the
     * view has resolved and workspace detection has matched an exercise; a
     * rejection re-arms the coordinator's latch (see `ChatStartupDeps.start`),
     * so this can run again after a transient failure.
     *
     * The availability check afterwards is not a duplicate of the one
     * `_onConversationChanged` runs: re-opening the view re-installs the SAME
     * conversation, so that hook's id guard early-returns and nothing would
     * ever ask whether Iris is enabled here.
     */
    private async _acquireConversation(workspace: { exerciseId: number; courseId: number }): Promise<void> {
        const conversation = this._conversation;
        if (!conversation) { return; }
        // Captured BEFORE the navigation. See `_rememberCourseName`: reading
        // either after the await would risk crossing a session identity that
        // changed while this was in flight.
        const epoch = this._courseCatalog?.currentEpoch ?? 0;
        const knownTitle = this._courseCatalog?.courseTitle(workspace.courseId);
        let outcome: StartOutcome;
        try {
            outcome = await conversation.start(workspace);
        } catch (error: unknown) {
            // A failed acquisition leaves no session and therefore no
            // transcript, so the loader would spin forever. The banner's Retry
            // routes back through reloadIrisChat. Re-thrown (rather than
            // swallowed) so the coordinator learns the attempt failed and can
            // re-arm its latch: without that, a single transient 500 leaves
            // the student stuck on the cold-start chooser forever, since the
            // latch was already consumed before this call and nothing else
            // ever gets another shot at it.
            logger.error('Iris conversation start failed', LogCategory.IRIS_CHAT, error);
            this._postMessageSafe({
                type: ExtensionMsg.ShowUnavailableState,
                message: 'Iris could not be reached. Retry to reload the conversation.',
            });
            throw error;
        }
        // The captured epoch stops a write crossing an identity. This stops
        // one crossing a NAVIGATION inside the same identity: a superseding
        // switch can leave the chat in another course entirely, and naming
        // this one then records a course the student never entered.
        const landedHere = outcome.kind !== 'stale'
            && conversation.state.snapshot().courseId === workspace.courseId;
        if (landedHere) {
            this._rememberCourseName(workspace.courseId, knownTitle, epoch);
        }
        // A course whose instructor switched Iris off is a destination, not a
        // failure (see `IrisConversationService.start`): NOT re-thrown, or the
        // coordinator would re-arm its latch for an answer that will never
        // change, and Retry would repeat the same 403 forever. Same banner
        // `_handleSwitchCourse` shows for the identical case reached by a
        // course switch instead of a cold start.
        if (outcome.kind === 'disabled') {
            this._announceCourseDisabled(workspace.courseId);
            return;
        }
        await this._refreshAvailability();
    }

    /**
     * The course the chat is IN keeps its display name across a dashboard
     * refresh that no longer lists it. This is what the catalog's
     * `partial-course` record is for: it gives a course id a name and is
     * never offered as a pickable course. Without it the header falls back to
     * `Course 42` the moment the student's enrolment ends mid-conversation.
     */
    private _rememberCourseName(courseId: number, title: string | undefined, epoch: number): void {
        if (title === undefined) { return; }
        this._courseCatalog?.upsertSupplemental({ kind: 'partial-course', id: courseId, title }, epoch);
    }

    /**
     * Everything a NAVIGATION invalidates. A stale "Iris is disabled for this
     * exercise" banner surviving a course switch, and a run left `waiting`
     * from the conversation the student just left, are both visible bugs
     * rather than bookkeeping.
     */
    private _onConversationChanged(): void {
        const sessionId = this._conversation?.state.snapshot().currentSessionId;
        if (sessionId === this._lastAnnouncedSessionId) { return; }
        this._lastAnnouncedSessionId = sessionId;
        this._availability.resetAvailability();
        this._postMessageSafe({ type: ExtensionMsg.HideDisabledState });
        this._postMessageSafe({ type: ExtensionMsg.HideUnavailableState });
        this._resetRunsAndMarker();
        // The two banners above were hidden for the conversation the student
        // has just LEFT, and nothing has asked the question for the one they
        // are now in. Without this re-check, a course whose instructor never
        // enabled Iris presents a fully working chat with an enabled composer,
        // and the student learns otherwise only when their first message fails.
        void this._refreshAvailability().catch((error: unknown) => {
            logger.error('Iris availability re-check failed', LogCategory.IRIS_CHAT, error);
        });
    }

    // ── Rendering ──────────────────────────────────────────────────────

    public render(): void {
        if (this._view) {
            this._resetReadyState();
            this._view.webview.html = getReactWebviewHtml(this._view.webview, this._extensionUri, 'irisChat');
        }
    }

    // ── Init data ──────────────────────────────────────────────────────

    private async _sendInitData(): Promise<void> {
        this._viewStatePresenter.postSnapshot();
        // A conversation already installed (the webview was disposed and
        // recreated while one was open — no `retainContextWhenHidden`, so
        // collapsing and reopening the sidebar does exactly this) gets no
        // other chance at its transcript: `_acquireConversation` is one-shot
        // behind the startup latch, and the install that originally called
        // `_deliverTranscript` addressed a webview instance that is gone.
        // Kept immediately after the snapshot above, with no `await` between
        // them: the webview's own guard keys an incoming transcript on the
        // session the snapshot just named, so it has to follow it, never
        // overtake it. `'load'` (not `'merge'`) on purpose — it is also the
        // only mode that sets `loadedSessionId`, which is what clears the
        // loader in the first place; `'merge'` never touches it.
        const detail = this._conversation?.state.snapshot().detail;
        if (detail) { this._deliverTranscript(detail, 'load'); }
        await this._populateAvailableContexts();
        void this._fileMonitorService.triggerUpdate();
        this._postNoAiStatus(this._noAiDetectionService.isNoAiEnabled);

        // Send current WebSocket connection status so the banner reflects reality
        if (this._websocketService) {
            this._websocketMessageHandler.publishCurrentStatus();
        }
    }

    // ── Public API ─────────────────────────────────────────────────────

    /**
     * Get current struggle context for Iris chat integration
     */
    public getStruggleContext(): StruggleContext | undefined {
        return this._telemetryManager?.getStruggleContext();
    }

    /**
     * The course the open conversation is in, for anything outside the chat
     * that has to name one (the Iris health check).
     *
     * Read from the conversation rather than mirrored into `ContextStore`:
     * the conversation IS the course now, and a second copy could only ever
     * be the one that is wrong. The mirror this replaces was written on the
     * course-picker path alone, so on the normal path (a workspace exercise,
     * acquired by `start`) the health check answered "select a course first"
     * about a chat that was plainly showing one.
     */
    public get currentCourseId(): number | undefined {
        return this._conversation?.state.snapshot().courseId;
    }

    /**
     * The coordinator's latest published detection state, also what the
     * presenter puts on the wire in every `updateIrisState` snapshot.
     */
    public get detectionState(): DetectionUiState {
        return this._detectionState;
    }

    /**
     * Access the WebSocket message handler for wiring up received-message events.
     */
    public get websocketMessageHandler(): IrisWebSocketMessageHandler {
        return this._websocketMessageHandler;
    }

    /**
     * Check if AI assistance is disabled due to .noai file
     */
    public isNoAiEnabled(): boolean {
        return this._noAiDetectionService.isNoAiEnabled;
    }

    // ── Workspace detection sink ──────────────────────────────────────
    // Called by wireWorkspaceDetection at activation. The provider implements
    // the sink because it owns the presenter that has to repost the snapshot
    // when the workspace exercise changes.

    public registerWorkspaceExercise(input: WorkspaceExercise): void {
        this._workspaceTracker.set(input);
    }

    public clearWorkspaceExercise(): void {
        this._workspaceTracker.clear();
        this._viewStatePresenter.postSnapshot();
    }

    /**
     * The session coordinator's reset hooks. Three narrow methods rather than
     * an auth subscription in here: the coordinator owns the ORDER, and a
     * component that interprets auth events on its own is how the order stops
     * being knowable.
     */
    public resetForSessionChange(): void {
        this._conversation?.resetForSessionChange();
        this._availability.resetAvailability();
        this._postMessageSafe({ type: ExtensionMsg.HideDisabledState });
        this._postMessageSafe({ type: ExtensionMsg.HideUnavailableState });
        this._resetRunsAndMarker();
        this._lastAnnouncedSessionId = undefined;
        this._lastWorkspaceExerciseId = undefined;
    }

    public publishSnapshot(): void {
        this._viewStatePresenter.postSnapshot();
    }

    public resetStartupForNewSession(): void {
        this._startupCoordinator.resetForNewSession();
    }

    /** See `StartupLatch`. Called before anything that can resolve the view. */
    public admitExplicitIntent(reason: string): void {
        this._startupCoordinator.admitExplicitIntent(reason);
    }

    /**
     * Feeds the coordinator workspace-detection outcomes, and gives it the
     * Retry the startup-unavailable banner offers. Called once, at
     * activation, with the handle `wireWorkspaceDetection` returns.
     */
    public attachStartupDetection(handle: {
        onDetectionSettled: vscode.Event<DetectionOutcome>;
        retry(): void;
    }): void {
        this._detectionHandle = handle;
        this._disposables.push(handle.onDetectionSettled(
            outcome => this._startupCoordinator.onDetectionSettled(outcome),
        ));
    }

    // ── Conversation-first entry points for the commands ───────────────

    /**
     * The Ask-Iris commands' single entry point: point the open conversation at
     * `target`, acquiring one when none is open. The course id must travel WITH
     * the target, because on a fresh window `ConversationState.courseId` is
     * `undefined` and a resolution without it can only answer `no-course`.
     * A missing hint is resolved from the exercise before asking.
     */
    public async askIrisAbout(target: ServerContext, courseHint?: number): Promise<TopicChangeOutcome> {
        if (!this._conversation) {
            return { kind: 'rejected', reason: 'failed' };
        }
        const courseId = target.mode === 'COURSE_CHAT'
            ? target.entityId
            : courseHint ?? await resolveCourseIdForExercise(target.entityId, this._contextStore, this._artemisApiService);
        // An exercise whose course we could not determine is refused rather than
        // staged. The cross-course check compares the target's course with the
        // open conversation's, so an unknown one is not "probably fine": it is
        // the exact input that makes the check say nothing. With no conversation
        // open the acquisition would have answered `no-course` anyway.
        if (courseId === undefined) { return { kind: 'rejected', reason: 'no-course' }; }

        // The target may live in ANOTHER course. Refusing would leave the
        // student staring at the course they were already in, having clicked
        // something else entirely. Artemis' client never has to refuse: opening
        // an exercise navigates to its page and the chat's course follows the
        // URL. Nothing navigates here, so make the same move explicitly, in the
        // order a student would: the course first, the topic in it afterwards.
        const open = this._conversation.state.snapshot().courseId;
        if (open !== undefined && open !== courseId) {
            const switched = await this._switchCourseForAskIris(courseId);
            // Only an opened conversation can carry a topic. The other three
            // outcomes each already say everything the student needs, and none
            // of them may be dressed up as a failed topic change:
            // `disabled` shows the banner, `stale` means a newer navigation won,
            // and `rejected` is reported by the caller, once.
            if (switched.kind === 'disabled') { return this._answerCourseDisabled(courseId); }
            if (switched.kind === 'stale') { return { kind: 'stale' }; }
            if (switched.kind === 'rejected') { return { kind: 'rejected', reason: switched.reason }; }
        }
        const outcome = await this._conversation.resolveTopicChange(target, courseId);
        // The cold start reaches the same destination through the acquisition
        // rather than through a switch, and owes the student the same banner.
        return outcome.kind === 'course-disabled' ? this._answerCourseDisabled(courseId) : outcome;
    }

    /**
     * The "Reload Iris chat" escape hatch behind `artemis.resetIrisChat`. Drops
     * every local cache and re-reads from the server: the open conversation
     * when there is one, the start path when there is none. Nothing is
     * destroyed on Artemis, which is why the command no longer confirms.
     */
    public async reloadIrisChat(): Promise<void> {
        if (!this._conversation) { return; }
        logger.info('Reloading Iris chat from the server...', LogCategory.IRIS_CHAT);
        await this._conversation.reload();
        await this._conversation.refreshOverview();
        // Re-check availability HERE, not on the navigation hook: a reload
        // re-installs the SAME conversation, so nothing else on this path can
        // clear the banner that sent the student to the Retry button in the
        // first place. Without it, `iris-unavailable` shows the banner,
        // disables the composer, and Retry leaves both exactly as they were.
        await this._refreshAvailability();
    }

    /**
     * Re-runs the Iris settings check for the open conversation and publishes
     * the result: both banners hidden when it comes back enabled, the matching
     * banner otherwise.
     */
    private async _refreshAvailability(): Promise<void> {
        const context = this._availabilityContext();
        if (!context) { return; }
        const availability = await this._availability.checkAndLoadIrisSettings(context);
        // The check now runs on every navigation, so two can be open at once
        // (course 42, then 43 before 42's settings answer). Publishing 42's
        // answer against 43 is precisely the stale banner `resetAvailability`
        // exists to prevent, so a check that outlived its conversation says
        // nothing. The same comparison guards the send path's banner.
        const live = this._availabilityContext();
        if (!live || live.type !== context.type || live.id !== context.id) { return; }
        if (availability.kind === 'enabled') {
            this._availability.resetAvailability();
            this._postMessageSafe({ type: ExtensionMsg.HideDisabledState });
            this._postMessageSafe({ type: ExtensionMsg.HideUnavailableState });
            return;
        }
        this._availability.postAvailability(availability, context);
    }

    /**
     * Registers a course for the pickers. Deliberately does NOT select it:
     * selecting would mean opening a conversation behind the student's back,
     * and the cold-start screen would then be telling them there is nothing to
     * talk about while one exists.
     */
    private _registerCourse(input: { id: number; title: string; shortName?: string; source?: 'workspace-detected' | 'user-selected' | 'system-default' }): void {
        this._contextStore.registerCourse(input);
        this._viewStatePresenter.postSnapshot();
    }

    /** See {@link _registerCourse}. */
    private _registerExercise(input: {
        id: number;
        title: string;
        shortName?: string;
        courseId?: number;
        releaseDate?: string;
        dueDate?: string;
        repositoryUri?: string;
        source?: 'workspace-detected' | 'user-selected' | 'system-default';
        isWorkspace?: boolean;
    }): void {
        this._contextStore.registerExercise(input);
        this._viewStatePresenter.postSnapshot();
    }

    /**
     * What the Iris availability check runs against: where the chat IS, which is
     * usually the open conversation and otherwise the course alone (a course
     * with Iris switched off is entered without one). Never a stored selection:
     * asking Artemis about the previous course's settings after a switch is
     * exactly the bug that used to cause.
     */
    private _availabilityContext(): AvailabilityContext | null {
        const conversation = this._conversation;
        if (!conversation) { return null; }
        const snapshot = conversation.state.snapshot();
        const courseId = snapshot.courseId;
        if (courseId === undefined) { return null; }
        const topic = conversation.state.effectiveContext();
        if (topic?.mode === 'PROGRAMMING_EXERCISE_CHAT') {
            const tracked = this._contextStore.getExerciseById(topic.entityId);
            return {
                type: 'exercise',
                id: topic.entityId,
                title: topic.name ?? tracked?.title ?? `Exercise ${topic.entityId}`,
                courseId,
            };
        }
        // Course chat, and every mode that can never be a topic (lecture, text
        // exercise): Iris availability is a course-level question there.
        return {
            type: 'course',
            id: courseId,
            title: this._contextStore.getCourseTitle(courseId) ?? `Course ${courseId}`,
            courseId,
        };
    }

    // ── BaseWebviewProvider hooks ──────────────────────────────────────

    protected _onReady(): void {
        this._sendInitData();
    }

    protected _handleCommand(message: Extract<WebviewToExtensionMessage, { type: 'command' }>): void {
        try {
            switch (message.command) {
                case WebviewCmd.SendMessage: {
                    const { text, localId, sessionId } = getPayload<WebCmd<'sendMessage'>>(message);
                    void this._handleChatMessage({ text, localId, sessionId }).catch(err => {
                        logger.error('Error handling chat message', LogCategory.IRIS_CHAT, err);
                        vscode.window.showErrorMessage('Failed to send message. Please try again.');
                    });
                    break;
                }
                case WebviewCmd.SelectTopic: {
                    const { mode, entityId, name } = getPayload<WebCmd<'selectTopic'>>(message);
                    if (typeof mode === 'string' && typeof entityId === 'number') {
                        void this._handleSelectTopic({ mode, entityId, name });
                    }
                    break;
                }
                case WebviewCmd.OpenConversation: {
                    const { courseId, sessionId } = getPayload<WebCmd<'openConversation'>>(message);
                    if (typeof courseId === 'number' && typeof sessionId === 'number') {
                        void this._handleOpenConversation({ courseId, sessionId });
                    }
                    break;
                }
                case WebviewCmd.SwitchCourse: {
                    const { courseId } = getPayload<WebCmd<'switchCourse'>>(message);
                    if (typeof courseId === 'number') {
                        void this._handleSwitchCourse(courseId);
                    }
                    break;
                }
                case WebviewCmd.NewConversation:
                    void this._handleNewConversation();
                    break;
                case WebviewCmd.RefreshCourses:
                    // A fresh installation tracks no courses at all, so the
                    // course picker has nothing to list until the dashboard
                    // has been read once.
                    void this._populateAvailableContexts()
                        .then(() => this._viewStatePresenter.postSnapshot())
                        .catch((err: unknown) => {
                            logger.error('Error refreshing courses', LogCategory.IRIS_CHAT, err);
                            this._viewStatePresenter.postSnapshot();
                        });
                    break;
                case WebviewCmd.OpenDiagnostics:
                    void this._handleOpenDiagnostics().catch(err => {
                        logger.error('Error opening diagnostics', LogCategory.IRIS_CHAT, err);
                        vscode.window.showErrorMessage('Failed to open diagnostics report');
                    });
                    break;
                case WebviewCmd.ResetChatSessions:
                    // Nothing local owns conversations any more, so there is
                    // nothing to reset: this is the reload escape hatch.
                    void this.reloadIrisChat().catch((err: unknown) => {
                        logger.error('Reset (reload) failed', LogCategory.IRIS_CHAT, err);
                    });
                    break;
                case WebviewCmd.ReconnectWebSocket:
                    void this._handleReconnectWebSocket().catch(err => {
                        logger.error('Error reconnecting WebSocket', LogCategory.IRIS_CHAT, err);
                        vscode.window.showErrorMessage('Failed to reconnect. Please try again.');
                    });
                    break;
                case WebviewCmd.ReloadChatSession:
                    // The unavailable banner's Retry: re-read the open
                    // conversation from the server.
                    void this.reloadIrisChat().catch((err: unknown) => {
                        logger.error('Retry reload failed', LogCategory.IRIS_CHAT, err);
                    });
                    break;
                case WebviewCmd.RetryStartupDetection:
                    // The startup-unavailable banner's Retry. Routes to the
                    // coordinator's own `retry()`, which re-runs DETECTION,
                    // NOT `reloadIrisChat()`: on this path there may be no
                    // workspace exercise at all yet, so a conversation reload
                    // would start whatever happens to be left over, or nothing.
                    this._startupCoordinator.retry();
                    break;
                case WebviewCmd.MessageFeedback: {
                    const { sessionId, messageId, feedback } = getPayload<WebCmd<'messageFeedback'>>(message);
                    void this._handleMessageFeedback({
                        sessionId: typeof sessionId === 'number' ? sessionId : undefined,
                        messageId: typeof messageId === 'number' ? messageId : undefined,
                        feedback: feedback as string | undefined
                    }).catch(err => {
                        logger.error('Error handling message feedback', LogCategory.IRIS_CHAT, err);
                    });
                    break;
                }
                case WebviewCmd.OpenHelpPopup:
                    this._handleOpenHelpPopup();
                    break;
                default:
                    void this._handleUtilityCommand(message).then(handled => {
                        if (!handled) {
                            logger.debug('Unhandled message in chat view', LogCategory.IRIS_CHAT, message);
                        }
                    }).catch(err => {
                        logger.error('Error handling utility command', LogCategory.IRIS_CHAT, err);
                    });
                    break;
            }
        } catch (error) {
            logger.error('Error handling chat command', LogCategory.IRIS_CHAT, error);
            vscode.window.showErrorMessage(`Error processing command: ${message.command}`);
        }
    }

    private async _handleUtilityCommand(message: WebviewToExtensionMessage): Promise<boolean> {
        if (message.type !== 'command') {return false;}
        switch (message.command) {
            case WebviewCmd.OpenSettings: {
                const setting = getPayload<WebCmd<'openSettings'>>(message).setting ?? 'Artemis';
                await openSettings(setting);
                return true;
            }
            case WebviewCmd.OpenFile: {
                const { filePath } = getPayload<WebCmd<'openFile'>>(message);
                if (typeof filePath === 'string') {
                    await openFileInWorkspace(filePath);
                }
                return true;
            }
            default:
                return false;
        }
    }

    // ── Private: Helpers ───────────────────────────────────────────────

    /**
     * Dispatch a synchronous send rejection back to the webview.
     *
     * Keeps the existing collateral side-effects (NoAi banner, disabled
     * banner) so visible chat state stays consistent, AND posts a
     * targeted SendRejected so the webview can mark the optimistic user
     * message as failed and clear its thinking indicator. Without that
     * second post the thinking dots would loop forever (see #178).
     *
     * Without a `localId`/`sessionId` pair there is no bubble to fail, so the
     * reason is surfaced as a notification and the composer released through
     * the run-UI projection, which owns clearing the indicator.
     */
    private _handleRejectedSend(
        result: { sent: false; reason: 'no-ai' | 'no-context' | 'iris-disabled' | 'iris-unavailable'; contextLabel?: string; capturedContext?: AvailabilityContext },
        localId: string | undefined,
        sessionId: number | undefined,
    ): void {
        const errorMessage = this._friendlyRejectionMessage(result);

        // Existing collateral side-effects per reason.
        switch (result.reason) {
            case 'no-ai':
                this._postNoAiStatus(true);
                break;
            case 'no-context':
                // No persistent UI state to update; the inline failed
                // message communicates this fully.
                break;
            case 'iris-disabled':
            case 'iris-unavailable': {
                // Persistent availability emit is gated on "captured context
                // still matches the live active context". Without this gate,
                // a slow checkAndLoadIrisSettings that returns after the
                // user switched would mislabel the NEW context's banner
                // state with the OLD context's classification (race surfaced
                // by codex review). If they diverge, skip the banner — the
                // SendRejected message-level signal is still delivered so
                // the optimistic user message gets marked failed.
                const live = this._availabilityContext();
                const captured = result.capturedContext;
                if (!live || !captured || live.type !== captured.type || live.id !== captured.id) {
                    break;
                }
                if (result.reason === 'iris-disabled') {
                    this._availability.postAvailability({ kind: 'disabled' }, captured);
                } else {
                    this._availability.postAvailability(
                        { kind: 'unavailable', reason: 'Send rejected: iris-unavailable' },
                        captured,
                    );
                }
                break;
            }
        }

        if (localId && sessionId !== undefined) {
            this._postMessageSafe({
                type: ExtensionMsg.SendRejected,
                localId,
                sessionId,
                reason: result.reason,
                errorMessage,
            });
            return;
        }

        // Nothing to address a bubble to. Deliberately no AddMessage: a bubble
        // with no conversation to belong to would land in whatever the student
        // opens next.
        vscode.window.showWarningMessage(errorMessage);
        this._websocketMessageHandler.publishCurrentRunUi();
    }

    private _friendlyRejectionMessage(result: { reason: 'no-ai' | 'no-context' | 'iris-disabled' | 'iris-unavailable'; contextLabel?: string }): string {
        switch (result.reason) {
            case 'no-ai':
                return 'Not sent because AI assistance is disabled for this workspace.';
            case 'no-context':
                return 'Please select a course or exercise context first.';
            case 'iris-disabled':
                return `Iris chat is disabled for this ${result.contextLabel ?? 'context'}.`;
            case 'iris-unavailable':
                return 'Iris is temporarily unavailable. Try again in a moment.';
        }
    }

    /**
     * Post .noai status to the webview
     */
    private _postNoAiStatus(isNoAiDetected: boolean): void {
        this._postMessageSafe({
            type: ExtensionMsg.UpdateNoAiStatus,
            isNoAiDetected,
            noAiFilePath: this._noAiDetectionService.noAiFilePath
        });
    }


    /**
     * Populates the chat context selector with all available courses and exercises.
     * Uses the shared CourseCatalog to avoid duplicate API calls. The sidebar
     * and chat share the same cached data.
     */
    private async _populateAvailableContexts(): Promise<void> {
        if (!this._courseCatalog) { return; }
        try {
            const data = await this._courseCatalog.fetch();
            const courses = data?.courses;
            if (!courses || !Array.isArray(courses)) { return; }

            for (const entry of courses) {
                const course = entry.course;
                if (!course?.id || !course.title) { continue; }

                this._registerCourse({
                    id: course.id,
                    title: course.title,
                    shortName: course.shortName,
                    source: 'system-default',
                });

                for (const exercise of getEntryExercises(entry)) {
                    const source = toExerciseSource(exercise, course.id);
                    if (!source || !source.studentParticipations?.length) {
                        continue;
                    }
                    // Do not set isWorkspace here; workspaceDetectionService owns that flag.
                    // Note: dates are read from the raw exercise because ExerciseSource
                    // intentionally omits them (kept narrow for workspace-detection use).
                    this._registerExercise({
                        id: source.id,
                        title: source.title,
                        shortName: source.shortName,
                        courseId: course.id,
                        releaseDate: exercise.releaseDate ?? exercise.startDate,
                        dueDate: exercise.dueDate,
                        source: 'system-default',
                    });
                }
            }
        } catch (error) {
            logger.debug('Failed to populate available contexts', LogCategory.IRIS_CHAT, error);
        }
    }

    private _handleOpenHelpPopup(): void {
        vscode.window.showInformationMessage(
            'Iris Chat Guide',
            { modal: true, detail: IRIS_CHAT_HELP_MARKDOWN }
        );
    }

    // ── Conversation-first navigation handlers (spec 7.3) ──────────────

    /**
     * Host-enforced navigation gate, returning the conversation a navigation
     * may proceed against. Not a disabled button: the webview's streaming
     * state resets on disconnect, so UI gating is not an invariant, and a
     * navigation admitted mid-send would move the conversation out from under
     * a POST that is still open.
     *
     * A refusal ANSWERS. The popovers stay open until their navigation lands,
     * so a refusal that posted nothing would leave the student's click with no
     * response at all: the row would simply not react.
     */
    private _conversationForNavigation(command: NavigationCommand): IrisConversationService | undefined {
        const conversation = this._conversation;
        if (!conversation) {
            this._answerFailedNavigation(command, 'Iris is not available right now.');
            return undefined;
        }
        if (conversation.state.sendInFlight) {
            logger.info(`Refused ${command}: a send is in flight`, LogCategory.IRIS_CHAT);
            this._answerFailedNavigation(command, 'Wait for Iris to finish answering before switching.');
            return undefined;
        }
        // Admitted: the student named a destination. Whether the navigation then
        // succeeds is irrelevant to the cold start, which must not overrule them.
        // Placed after the refusals on purpose: a command that never reached the
        // conversation named nothing.
        this._startupCoordinator.admitExplicitIntent(command);
        return conversation;
    }

    /**
     * Puts a refusal where the student was looking when they clicked.
     *
     * The history and the course picker stay open until their navigation
     * lands, so an inline `openSessionError` has a mounted host there. The
     * topic picker closes on the click itself, and the header's
     * new-conversation button never had a popover at all, so for those two
     * `openSessionError` is a write into a surface nothing renders: they
     * answer on the composer's notice line, which sits exactly where the
     * picker was.
     */
    private _answerFailedNavigation(command: NavigationCommand, message: string): void {
        if (command === 'openConversation' || command === 'switchCourse') {
            this._postMessageSafe({ type: ExtensionMsg.OpenSessionError, message });
            return;
        }
        this._postMessageSafe({ type: ExtensionMsg.ShowChatNotice, text: message, tone: 'error' });
    }

    /** What a `{ kind: 'rejected' }` outcome says to the student. */
    private _rejectionMessage(reason: Extract<TopicChangeOutcome, { kind: 'rejected' }>['reason'], failedMessage: string): string {
        switch (reason) {
            case 'send-in-flight': return 'Wait for Iris to finish answering before switching.';
            case 'loading': return 'Still loading this conversation. Try again in a moment.';
            case 'cross-course': return 'That topic belongs to a different course. Switch course first.';
            case 'no-course': return 'Choose a course first.';
            case 'failed': return failedMessage;
        }
    }

    private async _handleSelectTopic(target: ServerContext): Promise<void> {
        const conversation = this._conversationForNavigation('selectTopic');
        if (!conversation) { return; }
        const outcome = await conversation.resolveTopicChange(target);
        // No notice on success, in any shape. A topic change stays in the open
        // conversation, so there is no transcript replacement to explain, and
        // the one remaining `opened` is the cold start, where the pick acquired
        // the FIRST conversation: nothing was on screen to be replaced either.
        //
        // A `rejected` outcome is the service saying it did NOT do what was
        // asked (the cold-start acquisition threw, the target is in another
        // course, the conversation is still loading). Dropping it leaves the
        // chip on the old topic with no explanation at all.
        if (outcome.kind === 'rejected') {
            logger.info(`selectTopic rejected: ${outcome.reason}`, LogCategory.IRIS_CHAT);
            this._answerFailedNavigation(
                'selectTopic',
                this._rejectionMessage(outcome.reason, 'Could not change the topic. Please try again.'),
            );
        }
    }

    private async _handleOpenConversation(params: { courseId: number; sessionId: number }): Promise<void> {
        const conversation = this._conversationForNavigation('openConversation');
        if (!conversation) { return; }
        // `navigateTo` may cross courses, and `setCourse` clears the summaries
        // the row came from, so the name has to leave conversation state
        // before the navigation starts. The `openConversation` command carries
        // only ids. Programming exercises only, deliberately: a `LECTURE_CHAT`
        // `entityId` would collide with an exercise id and hand back a wrong
        // title with full confidence.
        const snapshot = conversation.state.snapshot();
        const row = snapshot.courseSessions
            .concat(snapshot.knownInvisible)
            .find(s => s.sessionId === params.sessionId);
        if (row?.context.mode === 'PROGRAMMING_EXERCISE_CHAT' && row.context.name) {
            this._courseCatalog?.upsertSupplemental({
                kind: 'partial-exercise',
                id: row.context.entityId,
                courseId: row.courseId,
                title: row.context.name,
            }, this._courseCatalog?.currentEpoch ?? 0);
        }
        try {
            // No notice: this navigation is exactly what the student asked for,
            // so there is nothing to explain.
            await conversation.navigateTo(params);
        } catch (error: unknown) {
            logger.error('openConversation failed', LogCategory.IRIS_CHAT, error);
            this._postMessageSafe({
                type: ExtensionMsg.OpenSessionError,
                message: navigationFailureMessage(error, 'Could not open that conversation. Please try again.'),
            });
        }
    }

    private async _handleSwitchCourse(courseId: number): Promise<void> {
        const conversation = this._conversationForNavigation('switchCourse');
        if (!conversation) { return; }
        // Captured BEFORE the navigation; see `_rememberCourseName`.
        const epoch = this._courseCatalog?.currentEpoch ?? 0;
        const knownTitle = this._courseCatalog?.courseTitle(courseId);
        try {
            // A course whose Iris is switched off is a destination, not a
            // failure: the service lands there with no conversation, INSIDE the
            // navigation that asked for it, and reports `disabled`. All this
            // handler owes it is the banner. Anything else IS a failure and is
            // answered inline, in the picker that is still open to hold it.
            const outcome = await conversation.switchCourse(courseId);
            if (outcome.kind === 'disabled') { this._announceCourseDisabled(courseId); }
            // Only where we actually landed in the course. `stale` means a
            // newer navigation won and `rejected` means we never went.
            if (outcome.kind === 'opened' || outcome.kind === 'disabled') {
                this._rememberCourseName(courseId, knownTitle, epoch);
            }
        } catch (error: unknown) {
            logger.error('switchCourse failed', LogCategory.IRIS_CHAT, error);
            this._postMessageSafe({
                type: ExtensionMsg.OpenSessionError,
                message: navigationFailureMessage(error, 'Could not open that course. Please try again.'),
            });
        }
    }

    /**
     * The course move an Ask-Iris click implies. Returns whether a conversation
     * is now open in `courseId`, which is the only case where staging a topic
     * makes sense. Unlike the header's own switch this one announces itself:
     * the student clicked an exercise, not a course, so the transcript changing
     * under them is a side effect and has to be named.
     */
    private async _switchCourseForAskIris(courseId: number): Promise<CourseSwitchOutcome> {
        if (!this._conversation) { return { kind: 'rejected', reason: 'failed' }; }
        try {
            const outcome = await this._conversation.switchCourse(courseId);
            if (outcome.kind === 'opened') {
                this._postMessageSafe({
                    type: ExtensionMsg.ShowChatNotice,
                    text: `Switched to ${this._contextStore.getCourseTitle(courseId) ?? 'another course'}.`,
                });
            }
            return outcome;
        } catch (error: unknown) {
            // Reported by the caller, not here: `askIrisAbout` turns this into a
            // rejection and the command layer already answers every rejection
            // with a message. Two notifications for one click is worse than one
            // that names the topic rather than the course.
            logger.error('Ask-Iris course switch failed', LogCategory.IRIS_CHAT, error);
            return { kind: 'rejected', reason: 'failed' };
        }
    }

    /** Announces the course we just entered, and reports it as such. */
    private _answerCourseDisabled(courseId: number): TopicChangeOutcome {
        this._announceCourseDisabled(courseId);
        return { kind: 'course-disabled' };
    }

    /**
     * The persistent "Iris is off here" state for the course we just entered.
     * Goes through the availability service so `lastAvailability` records it and
     * the next enabled course clears it, exactly as a settings probe would.
     */
    private _announceCourseDisabled(courseId: number): void {
        this._availability.postAvailability({ kind: 'disabled' }, {
            type: 'course',
            id: courseId,
            title: this._contextStore.getCourseTitle(courseId) ?? `Course ${courseId}`,
        });
    }

    private async _handleNewConversation(): Promise<void> {
        const conversation = this._conversationForNavigation('newConversation');
        if (!conversation) { return; }
        const outcome = await conversation.newConversation();
        if (outcome.kind === 'opened') {
            this._postMessageSafe({
                type: ExtensionMsg.ShowChatNotice,
                text: 'Started a new conversation.',
            });
            return;
        }
        // The create can simply fail (a 500 from `sessions?courseId`), and the
        // header's `+` has no popover to hold an error, so this line is the
        // only thing between the student and a button that does nothing.
        if (outcome.kind === 'rejected') {
            logger.info(`newConversation rejected: ${outcome.reason}`, LogCategory.IRIS_CHAT);
            this._answerFailedNavigation(
                'newConversation',
                this._rejectionMessage(outcome.reason, 'Could not start a new conversation. Please try again.'),
            );
        }
    }

    /**
     * The conversation-first send path. The availability check (\.noai, no
     * context, Iris disabled/unavailable) stays IN FRONT of the coordinator:
     * it is the only thing that knows about instructor settings, and its
     * rejections still carry the banner side effects.
     */
    private async _handleChatMessage(message: { text?: string; localId?: string; sessionId?: number }): Promise<void> {
        if (typeof message.text !== 'string') { return; }

        const content = message.text;
        const localId = typeof message.localId === 'string' ? message.localId : undefined;
        // The conversation the bubble was drawn in travels WITH the send, so a
        // navigation between composing and handling is caught here rather than
        // posting the student's text into whatever is open by then.
        const sessionId = typeof message.sessionId === 'number' ? message.sessionId : undefined;

        // Emit pending before the API call so the recording captures send attempts
        // even when the call never returns (e.g. network hang).
        this._onDidAttemptIrisChatSend.fire({ content, status: 'pending' });

        const unavailable = await this._checkSendAvailability();
        if (unavailable) {
            this._onDidAttemptIrisChatSend.fire({
                content,
                status: 'failed',
                errorMessage: `send-rejected: ${unavailable.reason}`,
            });
            this._handleRejectedSend(unavailable, localId, sessionId);
            return;
        }

        if (!this._sendCoordinator || !localId || sessionId === undefined) {
            // Nothing can carry this send. The bubble must still be failed, or
            // the student is left with a message stuck in `sending` and a
            // thinking indicator that never clears.
            this._onDidAttemptIrisChatSend.fire({
                content,
                status: 'failed',
                errorMessage: 'send-rejected: no-conversation',
            });
            if (localId && sessionId !== undefined) {
                this._postMessageSafe({
                    type: ExtensionMsg.SendRejected,
                    localId,
                    sessionId,
                    reason: 'no-conversation',
                    errorMessage: SEND_REJECTION_MESSAGES['no-conversation'],
                });
            }
            return;
        }

        try {
            const outcome = await this._sendCoordinator.send({ text: content, localId, sessionId });
            // Neither non-sent outcome needs anything here. `rejected` already
            // failed the bubble with its reason; `unknown` already surfaced its
            // message through `reportError` inside the coordinator, and posting
            // a second OpenSessionError would show the same failure twice.
            if (outcome.kind === 'sent') {
                // Open the recovery baseline ONLY for the still-current,
                // still-waiting generation: an inbound run may have opened a
                // newer one while the POST was in flight, and recovering
                // against it would resolve the wrong run. This is also what
                // stops an older POST completing late from replacing a newer
                // baseline.
                if (outcome.messageId !== undefined
                    && this._lastSendGeneration === this._runs.generation
                    && this._runs.waiting) {
                    this._recovery = {
                        generation: this._lastSendGeneration,
                        sessionId,
                        baselineMessageId: outcome.messageId,
                    };
                }
                this._onDidAttemptIrisChatSend.fire({ content, status: 'sent' });
                this._onDidSendIrisChatMessage.fire(content);
            } else {
                this._onDidAttemptIrisChatSend.fire({
                    content,
                    status: 'failed',
                    errorMessage: `send-${outcome.kind === 'rejected' ? `rejected: ${outcome.reason}` : 'unknown'}`,
                });
            }
        } catch (error: unknown) {
            // The coordinator resolves every failure it knows about, so a throw
            // here is a programmer error rather than a send failure. Surface it
            // and release the composer.
            const errorMessage = error instanceof Error ? error.message : String(error);
            this._onDidAttemptIrisChatSend.fire({ content, status: 'failed', errorMessage });
            vscode.window.showErrorMessage(`Failed to send message: ${errorMessage}`);
            this._websocketMessageHandler.publishCurrentRunUi();
        }
    }

    /**
     * The pre-send availability gate, kept out of the coordinator so it does
     * not have to know about instructor settings. Returns the rejection to
     * report, or `undefined` when the send may proceed.
     */
    private async _checkSendAvailability(): Promise<Parameters<ChatWebviewProvider['_handleRejectedSend']>[0] | undefined> {
        if (this._noAiDetectionService.isNoAiEnabled) {
            logger.warn('Chat blocked: .noai file detected', LogCategory.IRIS_CHAT);
            return { sent: false, reason: 'no-ai' };
        }
        const activeContext = this._availabilityContext();
        if (!activeContext) {
            logger.warn('No conversation to check availability for', LogCategory.IRIS_CHAT);
            return { sent: false, reason: 'no-context' };
        }
        const availability = await this._availability.checkAndLoadIrisSettings(activeContext);
        if (availability.kind === 'enabled') { return undefined; }
        // Disabled and unavailable are kept apart so the webview's Retry stays
        // active for the transient case and inert for the intentional one.
        return {
            sent: false,
            reason: availability.kind === 'disabled' ? 'iris-disabled' : 'iris-unavailable',
            contextLabel: activeContext.type === 'course' ? 'course' : 'exercise',
            capturedContext: activeContext,
        };
    }

    private async _handleMessageFeedback(message: { sessionId?: number; messageId?: number; feedback?: string }): Promise<void> {
        const sessionId: number | undefined = message.sessionId;
        const messageId: number | undefined = message.messageId;
        const feedback: string | undefined = message.feedback;

        logger.info('Message feedback received', LogCategory.IRIS_CHAT, { sessionId, messageId, feedback });

        if (!sessionId || !messageId || !feedback) {
            logger.warn('Missing required feedback data', LogCategory.IRIS_CHAT, { sessionId, messageId, feedback });
            return;
        }

        if (!this._artemisApiService) {
            logger.warn('Artemis API service not available', LogCategory.IRIS_CHAT);
            return;
        }

        const isHelpful = feedback === 'positive';

        // Fire the recording event before the API call (fire-and-forget for recording).
        this._onDidProvideIrisChatFeedback.fire({
            messageId: String(messageId),
            helpful: isHelpful,
        });

        try {
            await this._artemisApiService.markMessageHelpful(sessionId, messageId, isHelpful);
            logger.info(`Feedback submitted: ${feedback} for message ${messageId} in session ${sessionId}`, LogCategory.IRIS_CHAT);
        } catch (error) {
            logger.error('Failed to send feedback to server', LogCategory.IRIS_CHAT, error);
            vscode.window.showErrorMessage('Failed to submit feedback. Please try again.');
        }
    }

    private async _handleOpenDiagnostics(): Promise<void> {
        const report = this._chatDiagnosticsService.generateDiagnosticsReport();
        const document = await vscode.workspace.openTextDocument({ content: report, language: 'plaintext' });
        await vscode.window.showTextDocument(document, { preview: false, viewColumn: vscode.ViewColumn.Active });
    }

    private async _handleReconnectWebSocket(): Promise<void> {
        if (!this._websocketService) {
            vscode.window.showErrorMessage('WebSocket service not available');
            return;
        }
        if (this._websocketService.isConnected()) {
            vscode.window.showInformationMessage('WebSocket is already connected');
            this._websocketMessageHandler.publishCurrentStatus();
            return;
        }

        vscode.window.showInformationMessage('Reconnecting to WebSocket...');
        const result = await this._websocketMessageHandler.handleReconnectWebSocket();
        switch (result.status) {
            case 'reconnected':
                vscode.window.showInformationMessage('Successfully reconnected to WebSocket');
                break;
            case 'failed':
                vscode.window.showErrorMessage(`Failed to reconnect: ${result.error}`);
                break;
        }
    }
}
