import * as vscode from 'vscode';

import type { ExtensionToWebviewMessage, WebCmd, WebviewToExtensionMessage } from '@shared/messageContracts';
import { ExtensionMsg, getPayload, WebviewCmd } from '@shared/messageContracts';
import type { ServerContext } from '@shared/types/serverContext';

import { ArtemisApiService } from '@extension/api';
import { openFileInWorkspace, openSettings } from '@extension/controller/commands/utilityCommands';
import type { CourseAccessStorageService } from '@extension/services/courseAccessStorageService';
import type { CourseCatalog } from '@extension/services/courseCatalog';
import { ExerciseRegistry } from '@extension/services/exerciseRegistry';
import {
    ChatAvailabilityCoordinator,
    ChatDiagnosticsService,
    ChatNavigationController,
    ChatSendController,
    IRIS_CHAT_HELP_MARKDOWN,
    IrisWebSocketMessageHandler,
    IrisWebSocketSessionClient,
} from '@extension/services/iris';
import type { IrisChatSendAttempt } from '@extension/services/iris/chat/chatSendController';
import { ProactiveChatPresenter } from '@extension/services/iris/chat/proactiveChatPresenter';
import type { TopicChangeOutcome } from '@extension/services/iris/conversation/conversationService';
import { IrisConversationService } from '@extension/services/iris/conversation/conversationService';
import { transcriptMessage } from '@extension/services/iris/conversation/messageFormatting';
import { IrisRunStateMachine } from '@extension/services/iris/irisRunStateMachine';
import type { DetectionUiState } from '@extension/services/iris/startup/chatStartupCoordinator';
import { ChatStartupCoordinator } from '@extension/services/iris/startup/chatStartupCoordinator';
import { LogCategory, logger } from '@extension/services/loggingService';
import type { SessionIdentityReader } from '@extension/services/session/sessionIdentityCoordinator';
import { getReactWebviewHtml } from '@extension/services/ui';
import { ArtemisWebsocketService } from '@extension/services/websocket';
import {
    FileMonitorService,
    NoAiDetectionService,
} from '@extension/services/workspace';
import type { DetectionOutcome } from '@extension/services/workspace/detectionOutcome';
import type { WorkspaceExercise, WorkspaceExerciseTracker } from '@extension/services/workspace/workspaceExerciseTracker';
import type { IStruggleCoordinator } from '@extension/telemetry/contract';
import type { IChatWebviewProvider } from '@extension/types/IChatWebviewProvider';

import { BaseWebviewProvider } from './baseWebviewProvider';
import { ChatViewStatePresenter } from './chatViewStatePresenter';

interface ExerciseContextChangeEvent {
    exerciseId: number;
    previousExerciseId?: number;
    exerciseRoot?: vscode.Uri;
}

/**
 * The Iris chat's webview surface.
 *
 * This class owns the VS Code side of the chat and nothing else: the view, the
 * command dispatch, the init handshake, and the wiring that connects the
 * collaborators below to one another. The chat's actual behaviour lives in
 * those collaborators, each of which owns one question end to end:
 *
 * - `ChatNavigationController` - where the conversation points
 * - `ChatSendController` - a message's journey, and the repair of a lost run
 * - `ChatAvailabilityCoordinator` - whether Iris is usable here, and the banners
 * - `IrisWebSocketMessageHandler` - inbound frames and the run projection
 * - `ChatViewStatePresenter` - the state snapshot the webview renders
 * - `ChatStartupCoordinator` - the one-shot cold start
 */
export class ChatWebviewProvider extends BaseWebviewProvider implements vscode.WebviewViewProvider, vscode.Disposable, IChatWebviewProvider {
    public static readonly viewType = 'iris.chatView';

    private readonly _workspaceTracker: WorkspaceExerciseTracker;
    private readonly _noAiDetectionService: NoAiDetectionService;
    private readonly _fileMonitorService: FileMonitorService;
    private readonly _irisSessionManager: IrisWebSocketSessionClient | undefined;
    /**
     * The single owner of the open conversation. Assigned exactly once, here,
     * and `undefined` when either `_artemisApiService` or `_websocketService`
     * is missing, so every consumer must guard on it.
     */
    private readonly _conversation: IrisConversationService | undefined;

    private readonly _availability: ChatAvailabilityCoordinator;
    private readonly _navigation: ChatNavigationController;
    private readonly _sendController: ChatSendController;
    private readonly _viewStatePresenter: ChatViewStatePresenter;
    private readonly _chatDiagnosticsService: ChatDiagnosticsService;
    private readonly _websocketMessageHandler: IrisWebSocketMessageHandler;

    /**
     * The single owner of the automatic cold start. `resolveWebviewView` only
     * reports that the view exists (`onViewResolved`); `attachStartupDetection`
     * feeds it workspace-detection outcomes. The coordinator itself decides
     * when both have arrived and starts the acquisition exactly once.
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
    /** Last conversation announced to the webview, so a navigation can be told
     *  apart from a plain state emit (an overview refresh, a send settling). */
    private _lastAnnouncedSessionId: number | undefined;

    /**
     * Single owner of the Iris run state machine. Shared by the WS handler
     * (which drives it from inbound frames) and the send controller (which
     * drives the send lifecycle and the reconnect repair).
     */
    private readonly _runs = new IrisRunStateMachine();

    private readonly _onDidChangeExerciseContext = new vscode.EventEmitter<ExerciseContextChangeEvent>();
    public readonly onDidChangeExerciseContext = this._onDidChangeExerciseContext.event;

    /** Last workspace exercise announced through `onDidChangeExerciseContext`,
     *  so the event can still carry `previousExerciseId`. The store's own
     *  workspace event reports only the current one. */
    private _lastWorkspaceExerciseId: number | undefined;

    /** Re-exposed from `ChatSendController`, which owns the send lifecycle. */
    public readonly onDidSendIrisChatMessage: vscode.Event<string>;
    public readonly onDidAttemptIrisChatSend: vscode.Event<IrisChatSendAttempt>;

    /**
     * Fired when the user submits helpful/unhelpful feedback for a message,
     * after the API call is dispatched and without waiting for the server ack.
     */
    private readonly _onDidProvideIrisChatFeedback = new vscode.EventEmitter<{
        messageId: string;
        helpful: boolean;
    }>();
    public readonly onDidProvideIrisChatFeedback = this._onDidProvideIrisChatFeedback.event;

    /**
     * Everything the proactive struggle feature draws in the chat. Public because
     * `extension.ts` wires the engine's chat hooks straight to it.
     */
    public readonly proactive: ProactiveChatPresenter;

    private readonly _onDidChangePanelVisibility = new vscode.EventEmitter<boolean>();
    public readonly onDidChangePanelVisibility = this._onDidChangePanelVisibility.event;

    constructor(
        private readonly _extensionUri: vscode.Uri,
        _extensionContext: vscode.ExtensionContext,
        private readonly _artemisApiService: ArtemisApiService | undefined,
        private readonly _websocketService: ArtemisWebsocketService | undefined,
        noAiDetectionService: NoAiDetectionService,
        exerciseRegistry: ExerciseRegistry,
        private readonly _courseCatalog: CourseCatalog | undefined,
        _struggleCoordinator: IStruggleCoordinator | undefined,
        workspaceTracker: WorkspaceExerciseTracker,
        /** The picker's course order. Scopes recency per server and per principal. */
        courseAccess: CourseAccessStorageService,
        /** Diagnostics' first question: which account, which server, which generation. */
        sessionIdentity: SessionIdentityReader,
    ) {
        super(LogCategory.IRIS_CHAT);
        const post = (msg: ExtensionToWebviewMessage) => this._postMessageSafe(msg);

        this._workspaceTracker = workspaceTracker;
        this._noAiDetectionService = noAiDetectionService;
        this._disposables.push(this._onDidChangeExerciseContext);
        this._disposables.push(this._onDidProvideIrisChatFeedback);
        this._disposables.push(this._onDidChangePanelVisibility);
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

        this._fileMonitorService = new FileMonitorService();
        this._disposables.push(this._fileMonitorService);

        // Built before the collaborators so `ChatSendController` can construct
        // its `SendCoordinator` against a conversation that already exists.
        if (this._artemisApiService && this._websocketService) {
            this._irisSessionManager = new IrisWebSocketSessionClient(this._websocketService);
            this._disposables.push(this._irisSessionManager);
            this._conversation = this._createConversationService(this._artemisApiService, this._irisSessionManager);
            // Pushed AFTER the client, and `_drainDisposables` pops LIFO, so
            // the conversation is disposed BEFORE the client: no in-flight
            // install can subscribe to an already-disposed client.
            this._disposables.push(this._conversation);
        }

        // A getter, not a value, in each of these: `_conversation` is assigned
        // in the branch above and is `undefined` when there is no API or no
        // websocket service, so every collaborator must read it at call time.
        const getConversation = () => this._conversation;

        this.proactive = new ProactiveChatPresenter({
            postMessage: post,
            getConversation,
            getView: () => this._view,
            focusChat: () => vscode.commands.executeCommand('iris.chatView.focus'),
            artemisApi: this._artemisApiService,
        });
        this._availability = new ChatAvailabilityCoordinator(
            getConversation, this._courseCatalog, this._artemisApiService, post,
        );
        this._viewStatePresenter = new ChatViewStatePresenter(
            this._courseCatalog,
            this._workspaceTracker,
            courseAccess,
            post,
            getConversation,
            // Likewise for `_detectionState`, which `publishDetectionState`
            // below reassigns: capturing it by value would freeze the snapshot
            // at `'unsettled'`.
            () => this._detectionState,
        );
        this._chatDiagnosticsService = new ChatDiagnosticsService(
            this._courseCatalog, this._workspaceTracker, sessionIdentity, exerciseRegistry, getConversation,
        );
        this._websocketMessageHandler = new IrisWebSocketMessageHandler(
            this._websocketService, () => this._irisSessionManager, post, this._runs, getConversation,
        );
        this._sendController = new ChatSendController({
            getConversation,
            artemisApi: this._artemisApiService,
            availability: this._availability,
            noAi: this._noAiDetectionService,
            runs: this._runs,
            websocketMessageHandler: this._websocketMessageHandler,
            workspaceTracker: this._workspaceTracker,
            postMessage: post,
            postNoAiStatus: (isNoAiDetected) => this._postNoAiStatus(isNoAiDetected),
        });
        this._disposables.push(this._sendController);
        this.onDidSendIrisChatMessage = this._sendController.onDidSendIrisChatMessage;
        this.onDidAttemptIrisChatSend = this._sendController.onDidAttemptIrisChatSend;

        // These two reference each other, so at least one reference has to be
        // deferred. Both only fire after construction: the coordinator starts
        // on a resolved view, the controller on a webview command.
        this._startupCoordinator = new ChatStartupCoordinator({
            start: (workspace) => this._navigation.acquire(workspace),
            publishDetectionState: (state) => {
                this._detectionState = state;
                this._viewStatePresenter.postSnapshot();
            },
            retryDetection: () => this._detectionHandle?.retry(),
        });
        this._navigation = new ChatNavigationController({
            getConversation,
            catalog: this._courseCatalog,
            artemisApi: this._artemisApiService,
            availability: this._availability,
            postMessage: post,
            admitExplicitIntent: (reason) => this._startupCoordinator.admitExplicitIntent(reason),
        });

        if (this._courseCatalog) {
            // The picker's lists come from the catalog, so a catalog write has
            // to repaint the chat directly: riding on workspace detection would
            // not repaint at all while the session is still resolving.
            this._disposables.push(
                this._courseCatalog.onCoursesLoaded(() => this._viewStatePresenter.postSnapshot()),
            );
        }
        if (this._conversation) {
            // The single repaint trigger for the conversation-first state:
            // every service mutation ends in an emit, so the webview never has
            // to be told about a navigation twice.
            this._disposables.push(
                this._conversation.onDidChange(() => {
                    this._onConversationChanged();
                    this._viewStatePresenter.postSnapshot();
                }),
            );
        }
        if (this._irisSessionManager) {
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
                    void this._sendController.recoverOnResubscribe(sessionId);
                }),
            );
        }

        this._disposables.push(
            this._fileMonitorService.onDidUpdateFiles(update => {
                this._postMessageSafe({
                    type: ExtensionMsg.UpdateReferencedFiles,
                    ...update
                });
            })
        );
        this._disposables.push(
            this._noAiDetectionService.onNoAiStatusChanged(isNoAiDetected => {
                this._postNoAiStatus(isNoAiDetected);
            })
        );
    }

    /** Called where `_irisSessionManager` is created, so both exist together. */
    private _createConversationService(
        api: ArtemisApiService,
        client: IrisWebSocketSessionClient,
    ): IrisConversationService {
        return new IrisConversationService(api, {
            subscribeToSession: (sessionId) => client.subscribeToSession(sessionId),
            leaveSession: () => client.leaveSession(),
            getWorkspaceExercise: () => {
                const exercise = this._workspaceTracker.current;
                return exercise === undefined ? undefined : { exerciseId: exercise.id, courseId: exercise.courseId };
            },
            deliverTranscript: (detail, mode) => this._postMessageSafe(transcriptMessage(detail, mode)),
        });
    }

    public dispose(): void {
        this._drainDisposables();
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

        this._viewDisposables.push(webviewView.webview.onDidReceiveMessage(message => {
            this._handleMessage(message);
        }));

        this._viewDisposables.push(webviewView.onDidChangeVisibility(() => {
            this._onDidChangePanelVisibility.fire(webviewView.visible);
            if (webviewView.visible) {
                this.proactive.setProactiveBadge(false);
                logger.debug('Iris Chat view became visible, loading data...', LogCategory.VIEW);
                this._sendInitData();
            } else {
                logger.debug('Iris Chat view became hidden', LogCategory.VIEW);
            }
        }));
        // Seed the current visibility once: a view that resolves already-visible fires no
        // onDidChangeVisibility change event, so consumers (the in-session banner gate) would
        // otherwise stay stale-false until the first visibility toggle.
        this._onDidChangePanelVisibility.fire(webviewView.visible);

        this._viewDisposables.push(vscode.workspace.onDidChangeConfiguration(event => {
            if (event.affectsConfiguration('artemis.developerMode')) {
                this.refreshTheme();
            }
            if (event.affectsConfiguration('artemis.iris.sendUncommittedChanges')) {
                void this._fileMonitorService.triggerUpdate();
            }
        }));

        // The coordinator owns the one-shot cold start: it starts the
        // acquisition only once the view AND workspace detection have both
        // settled, in whichever order they arrive.
        this._startupCoordinator.onViewResolved();
        // Independent of the one-shot acquisition: a recreated webview needs
        // the disabled banner re-evaluated even when the conversation is
        // unchanged and the startup latch has long been consumed.
        void this._availability.refresh();

        // Init data is sent when the webview signals ready (see _handleMessage / _sendInitData)
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
        this._availability.clearBanners();
        this._sendController.resetRunsAndRecovery();
        // The banners above were taken down for the conversation the student
        // has just LEFT, and nothing has asked the question for the one they
        // are now in. Without this re-check, a course whose instructor never
        // enabled Iris presents a fully working chat with an enabled composer,
        // and the student learns otherwise only when their first message fails.
        void this._availability.refresh().catch((error: unknown) => {
            logger.error('Iris availability re-check failed', LogCategory.IRIS_CHAT, error);
        });
    }

    public render(): void {
        if (this._view) {
            this._resetReadyState();
            this._view.webview.html = getReactWebviewHtml(this._view.webview, this._extensionUri, 'irisChat');
        }
    }

    private async _sendInitData(): Promise<void> {
        this._viewStatePresenter.postSnapshot();
        // A re-created webview starts with an empty live-episode set; replay the last
        // snapshot BEFORE messages hydrate so the live episode never renders folded.
        // Synchronous on purpose: it must not introduce an await between the state
        // snapshot above and the transcript below.
        this.proactive.resendLiveEpisode();
        // A conversation already installed (the webview was disposed and
        // recreated while one was open, which is what collapsing and reopening
        // the sidebar does without `retainContextWhenHidden`) gets no other
        // chance at its transcript: the acquisition is one-shot behind the
        // startup latch. Kept immediately after the snapshot above with no
        // `await` between them, because the webview's guard keys an incoming
        // transcript on the session the snapshot just named. `'load'`, not
        // `'merge'`: only `'load'` sets `loadedSessionId`, which clears the
        // loader.
        const detail = this._conversation?.state.snapshot().detail;
        if (detail) { this._postMessageSafe(transcriptMessage(detail, 'load')); }
        await this._populateAvailableContexts();
        // The snapshot above was posted against whatever the catalog held
        // before the fetch, which on a cold webview is nothing. Without this
        // second post the picker stays empty until some unrelated event
        // happens to post again.
        this._viewStatePresenter.postSnapshot();
        void this._fileMonitorService.triggerUpdate();
        this._postNoAiStatus(this._noAiDetectionService.isNoAiEnabled);

        // A freshly mounted webview has no status yet, so the banner would sit
        // blank until the next connection change.
        if (this._websocketService) {
            this._websocketMessageHandler.publishCurrentStatus();
        }
    }

    // ── Public API ─────────────────────────────────────────────────────

    /**
     * The course the open conversation is in, for anything outside the chat
     * that has to name one (the Iris health check). Read from the conversation
     * rather than a mirrored store: the conversation IS the course, and a
     * second copy could only ever be the one that is wrong.
     */
    public get currentCourseId(): number | undefined {
        return this._conversation?.state.snapshot().courseId;
    }

    public get detectionState(): DetectionUiState {
        return this._detectionState;
    }

    public get websocketMessageHandler(): IrisWebSocketMessageHandler {
        return this._websocketMessageHandler;
    }

    public isNoAiEnabled(): boolean {
        return this._noAiDetectionService.isNoAiEnabled;
    }

    /**
     * Resolves once the initial `.noai` workspace scan has run, so the first `isNoAiEnabled()` read is
     * authoritative (spec §14 case 3). Used by the AskIris proactive card so the first render can't fail-open.
     */
    /** Collapse every proactive episode to a fold line (spec §12.2). On IChatWebviewProvider. */
    public collapseProactiveEpisodes(): void {
        this.proactive.collapseProactiveEpisodes();
    }

    public whenNoAiReady(): Promise<void> {
        return this._noAiDetectionService.waitForInitialization().then(() => undefined);
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
        this._availability.clearBanners();
        this._sendController.resetRunsAndRecovery();
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

    /** The Ask-Iris commands' entry point. See `ChatNavigationController.askIrisAbout`. */
    public askIrisAbout(target: ServerContext, courseHint?: number): Promise<TopicChangeOutcome> {
        return this._navigation.askIrisAbout(target, courseHint);
    }

    /**
     * The "Reload Iris chat" escape hatch behind `artemis.resetIrisChat`. Drops
     * every local cache and re-reads from the server: the open conversation
     * when there is one, the start path when there is none. Nothing is
     * destroyed on Artemis, so the command does not confirm.
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
        await this._availability.refresh();
    }

    protected _onReady(): void {
        this._sendInitData();
    }

    protected _handleCommand(message: Extract<WebviewToExtensionMessage, { type: 'command' }>): void {
        try {
            switch (message.command) {
                case WebviewCmd.SendMessage: {
                    const { text, localId, sessionId } = getPayload<WebCmd<'sendMessage'>>(message);
                    void this._sendController.send({ text, localId, sessionId }).catch(err => {
                        logger.error('Error handling chat message', LogCategory.IRIS_CHAT, err);
                        vscode.window.showErrorMessage('Failed to send message. Please try again.');
                    });
                    break;
                }
                case WebviewCmd.SelectTopic: {
                    const { mode, entityId, name } = getPayload<WebCmd<'selectTopic'>>(message);
                    if (typeof mode === 'string' && typeof entityId === 'number') {
                        void this._navigation.selectTopic({ mode, entityId, name });
                    }
                    break;
                }
                case WebviewCmd.OpenConversation: {
                    const { courseId, sessionId } = getPayload<WebCmd<'openConversation'>>(message);
                    if (typeof courseId === 'number' && typeof sessionId === 'number') {
                        void this._navigation.openConversation({ courseId, sessionId });
                    }
                    break;
                }
                case WebviewCmd.SwitchCourse: {
                    const { courseId } = getPayload<WebCmd<'switchCourse'>>(message);
                    if (typeof courseId === 'number') {
                        void this._navigation.switchCourse(courseId);
                    }
                    break;
                }
                case WebviewCmd.NewConversation:
                    void this._navigation.newConversation();
                    break;
                case WebviewCmd.RefreshCourses:
                    // Forced: opening the picker is the gesture that means
                    // "show me what is there now", and a cached dashboard
                    // would answer it with whatever was true at startup.
                    // Both arms mark the snapshot as this refresh's answer, so
                    // the picker's wait ends on the request it made and on no
                    // other snapshot. A failure is an answer too.
                    void this._populateAvailableContexts({ force: true })
                        .then(() => this._viewStatePresenter.postSnapshot({ answersCourseRefresh: true }))
                        .catch((err: unknown) => {
                            logger.error('Error refreshing courses', LogCategory.IRIS_CHAT, err);
                            this._viewStatePresenter.postSnapshot({ answersCourseRefresh: true });
                        });
                    break;
                case WebviewCmd.OpenDiagnostics:
                    void this._handleOpenDiagnostics().catch(err => {
                        logger.error('Error opening diagnostics', LogCategory.IRIS_CHAT, err);
                        vscode.window.showErrorMessage('Failed to open diagnostics report');
                    });
                    break;
                case WebviewCmd.ResetChatSessions:
                    // No local state owns conversations, so there is nothing to
                    // reset: this is the reload escape hatch.
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
                case WebviewCmd.MessageProactiveOutcome: {
                    const { sessionId, messageId, proactiveEpisodeId, outcome } = getPayload<WebCmd<'messageProactiveOutcome'>>(message);
                    this.proactive.handleProactiveOutcome(sessionId, messageId, proactiveEpisodeId, outcome);
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

    private _postNoAiStatus(isNoAiDetected: boolean): void {
        this._postMessageSafe({
            type: ExtensionMsg.UpdateNoAiStatus,
            isNoAiDetected,
            noAiFilePath: this._noAiDetectionService.noAiFilePath
        });
    }

    /**
     * Reads the live dashboard. `force` is the caller's decision: reopening the
     * chat must not re-hit the network, but opening the picker is the gesture
     * that means "show me what is there now".
     */
    private async _populateAvailableContexts(options?: { force?: boolean }): Promise<void> {
        if (!this._courseCatalog) { return; }
        await this._courseCatalog.fetch(options);
    }

    private _handleOpenHelpPopup(): void {
        vscode.window.showInformationMessage(
            'Iris Chat Guide',
            { modal: true, detail: IRIS_CHAT_HELP_MARKDOWN }
        );
    }

    private async _handleMessageFeedback(message: { sessionId?: number; messageId?: number; feedback?: string }): Promise<void> {
        const { sessionId, messageId, feedback } = message;

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

        // Recorded before the API call, so a submit that throws is still recorded.
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
