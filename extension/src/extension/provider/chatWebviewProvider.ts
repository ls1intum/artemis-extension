import * as vscode from 'vscode';

import type { WebCmd, WebviewToExtensionMessage } from '@shared/messageContracts';
import { ExtensionMsg, getPayload, WebviewCmd } from '@shared/messageContracts';

import { ArtemisApiService } from '@extension/api';
import { openFileInWorkspace, openSettings } from '@extension/controller/commands/utilityCommands';
import type { CourseDataCache } from '@extension/services/courseDataCache';
import { ExerciseRegistry } from '@extension/services/exerciseRegistry';
import type { ChatContextReason, IrisServiceDeps } from '@extension/services/iris';
import { IrisWebSocketMessageHandler } from '@extension/services/iris';
import {
    ChatContextManager,
    ChatDiagnosticsService,
    ChatMessageService,
    ContextStore,
    IRIS_CHAT_HELP_MARKDOWN,
    IrisChatSessionService,
    IrisWebSocketSessionClient,
} from '@extension/services/iris';
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
import { ActiveContext, ChatContextType } from '@extension/types';
import type { IChatWebviewProvider } from '@extension/types/IChatWebviewProvider';

import { BaseWebviewProvider } from './baseWebviewProvider';
import { shouldAutoRetryReload } from './chatReloadDecision';
import { ChatViewStatePresenter } from './chatViewStatePresenter';

interface ExerciseContextChangeEvent {
    exerciseId: number;
    previousExerciseId?: number;
    exerciseRoot?: vscode.Uri;
}

export class ChatWebviewProvider extends BaseWebviewProvider implements vscode.WebviewViewProvider, vscode.Disposable, IChatWebviewProvider {
    // ── Static properties ──────────────────────────────────────────────
    public static readonly viewType = 'iris.chatView';

    // ── Instance properties ────────────────────────────────────────────
    private readonly _contextStore: ContextStore;
    private readonly _viewStatePresenter: ChatViewStatePresenter;
    private _fileMonitorService: FileMonitorService;
    private _irisSessionManager?: IrisWebSocketSessionClient;
    private _chatDiagnosticsService: ChatDiagnosticsService;
    private _chatSessionService: IrisChatSessionService;
    private _chatMessageService: ChatMessageService;
    private _chatContextManager: ChatContextManager;
    private _websocketMessageHandler: IrisWebSocketMessageHandler;
    private _noAiDetectionService: NoAiDetectionService;

    /**
     * Context-keyed single-flight guard for chat-session reloads. Auto-retry
     * on websocket reconnect, manual Retry button, and any other future
     * reload trigger latch onto the in-flight reload for the SAME context.
     * A trigger for a different context (after the user switched) bypasses
     * the join and starts a fresh reload — otherwise a hung reload (no fetch
     * timeout) for context A would silently swallow retries for context B.
     */
    private _reloadInFlight: { promise: Promise<void>; contextKey: string } | null = null;

    /**
     * Debounce timer for the websocket-reconnect → reload trigger. Coalesces
     * the rapid `connected: true` re-emits we sometimes see when a flap
     * settles. The single-flight guard catches everything else.
     */
    private _reloadDebounceTimer: ReturnType<typeof setTimeout> | undefined;

    private readonly _onDidChangeExerciseContext = new vscode.EventEmitter<ExerciseContextChangeEvent>();
    public readonly onDidChangeExerciseContext = this._onDidChangeExerciseContext.event;

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
        private readonly _courseDataCache: CourseDataCache | undefined,
        private readonly _telemetryManager: ITelemetryManager | undefined,
        contextStore: ContextStore,
    ) {
        super(LogCategory.IRIS_CHAT);
        this._disposables.push(this._onDidChangeExerciseContext);
        this._disposables.push(this._onDidSendIrisChatMessage);
        this._disposables.push(this._onDidAttemptIrisChatSend);
        this._disposables.push(this._onDidProvideIrisChatFeedback);
        this._disposables.push(this._onDidChangePanelVisibility);
        this._contextStore = contextStore;
        this._disposables.push(
            this._contextStore.onDidChangeActiveContext(({ current, previous }) => {
                if (current?.type === 'exercise') {
                    this._onDidChangeExerciseContext.fire({
                        exerciseId: current.id,
                        previousExerciseId: previous?.type === 'exercise' ? previous.id : undefined,
                        exerciseRoot: vscode.workspace.workspaceFolders?.[0]?.uri,
                    });
                }
                // Real context change (type/id differs from previous — the
                // event fires only on actual changes). Drop any stale
                // availability classification from the outgoing context so
                // the reconnect hook does not auto-retry the new context
                // against the old context's banner state, and hide any
                // visible banner so the user starts the new context from a
                // clean slate.
                this._chatSessionService.resetAvailability();
                this._postMessageSafe({ type: ExtensionMsg.HideDisabledState });
                this._postMessageSafe({ type: ExtensionMsg.HideUnavailableState });
            })
        );
        this._viewStatePresenter = new ChatViewStatePresenter(this._contextStore, (msg) => this._postMessageSafe(msg));
        this._fileMonitorService = new FileMonitorService();
        this._disposables.push(this._fileMonitorService);

        // Shared dependency bag for Iris services
        const deps: IrisServiceDeps = {
            contextStore: this._contextStore,
            artemisApiService: this._artemisApiService,
            postMessage: (msg) => this._postMessageSafe(msg),
            postSnapshot: () => this._viewStatePresenter.postSnapshot(),
        };

        this._chatDiagnosticsService = new ChatDiagnosticsService(this._contextStore, this._artemisApiService, this._exerciseRegistry);
        this._chatSessionService = new IrisChatSessionService(
            deps,
            () => this._irisSessionManager,
        );
        this._chatMessageService = new ChatMessageService(
            deps,
            this._websocketService,
            () => this._irisSessionManager,
            this._chatSessionService,
        );
        this._chatContextManager = new ChatContextManager(
            deps,
            this._chatSessionService,
            () => this._irisSessionManager,
        );
        this._websocketMessageHandler = new IrisWebSocketMessageHandler(
            this._websocketService,
            () => this._irisSessionManager,
            (message) => this._postMessageSafe(message),
            (artemisSessionId, title) => {
                if (this._contextStore.updateSessionTitle(artemisSessionId, title)) {
                    this._viewStatePresenter.postSnapshot();
                }
            },
        );

        if (this._artemisApiService && this._websocketService) {
            this._irisSessionManager = new IrisWebSocketSessionClient(this._artemisApiService, this._websocketService);
            this._disposables.push(this._irisSessionManager);

            this._disposables.push(
                this._irisSessionManager.onDidReceiveMessage(data => this._websocketMessageHandler.handleIrisWebSocketMessage(data))
            );
            this._disposables.push(
                this._irisSessionManager.onDidConnectionStateChange(() => this._websocketMessageHandler.publishCurrentStatus())
            );

            // Auto-retry chat reload on websocket reconnect when the chat is
            // currently in an `unavailable` state for the active context.
            // The 500 ms debounce coalesces rapid flap re-emits; the
            // single-flight reload guard catches concurrent reconnect +
            // manual-Retry presses.
            this._disposables.push(
                this._websocketService.onDidChangeConnectionState(({ connected }) => {
                    if (!connected) {
                        return;
                    }
                    if (this._reloadDebounceTimer) {
                        clearTimeout(this._reloadDebounceTimer);
                    }
                    this._reloadDebounceTimer = setTimeout(() => {
                        this._reloadDebounceTimer = undefined;
                        if (this._shouldAutoRetryReload()) {
                            void this._reloadChatSession('websocket-reconnect');
                        }
                    }, 500);
                })
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

        this._noAiDetectionService = noAiDetectionService;
        this._disposables.push(
            this._noAiDetectionService.onNoAiStatusChanged(isNoAiDetected => {
                this._postNoAiStatus(isNoAiDetected);
            })
        );
    }

    // ── Lifecycle ──────────────────────────────────────────────────────

    public dispose(): void {
        if (this._reloadDebounceTimer) {
            clearTimeout(this._reloadDebounceTimer);
            this._reloadDebounceTimer = undefined;
        }
        this._drainDisposables();
    }

    // ── Reload helpers (auto-retry + manual Retry share this path) ─────

    /**
     * Decide whether a websocket reconnect should trigger an auto-retry of
     * the chat-session reload. The pure decision logic lives in
     * {@link shouldAutoRetryReload} so it can be unit-tested in isolation;
     * this method just plumbs the current state in.
     */
    private _shouldAutoRetryReload(): boolean {
        return shouldAutoRetryReload(
            this._chatSessionService.lastAvailability,
            this._contextStore.getActiveContext(),
        );
    }

    /**
     * Trigger a chat-session reload, deduplicating concurrent triggers for
     * the same context (auto-retry on reconnect, manual Retry button,
     * future webview commands). A trigger for a different context bypasses
     * the join and starts a fresh reload — otherwise a hung reload for the
     * previous context would block recovery of the current one.
     */
    private _reloadChatSession(reason: string): Promise<void> {
        const current = this._contextStore.getActiveContext();
        if (!current) {
            return Promise.resolve();
        }
        const currentKey = `${current.type}:${current.id}`;
        if (this._reloadInFlight && this._reloadInFlight.contextKey === currentKey) {
            logger.info(`Reload (${reason}) joined existing in-flight reload for ${currentKey}`, LogCategory.IRIS_CHAT);
            return this._reloadInFlight.promise;
        }
        if (this._reloadInFlight) {
            logger.info(`Reload (${reason}) for ${currentKey} starts fresh (in-flight is for ${this._reloadInFlight.contextKey})`, LogCategory.IRIS_CHAT);
        } else {
            logger.info(`Reload chat session (${reason})`, LogCategory.IRIS_CHAT);
        }
        const entry: { promise: Promise<void>; contextKey: string } = {
            contextKey: currentKey,
            promise: this._chatSessionService
                .loadAllSessionsForContext()
                .catch((err: unknown) => {
                    logger.error(`Reload chat session (${reason}) threw`, LogCategory.IRIS_CHAT, err);
                })
                .finally(() => {
                    // Only clear if WE are still the registered in-flight.
                    // A later context-switch + new reload may have replaced
                    // us; in that case the new entry owns the slot.
                    if (this._reloadInFlight === entry) {
                        this._reloadInFlight = null;
                    }
                }),
        };
        this._reloadInFlight = entry;
        return entry.promise;
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

        // Init data is sent when the webview signals ready (see _handleMessage / _sendInitData)
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
        await this._populateAvailableContexts();
        void this._loadIrisMessagesIfNeeded().catch((err: unknown) => {
            logger.error('Failed to load Iris messages during init', LogCategory.IRIS_CHAT, err);
        });
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

    public async clearAllSessions(): Promise<void> {
        // Mirrors the in-webview "Reset & Sync Sessions" menu button so the
        // command-palette and webview entry points behave identically.
        logger.info('Resetting Iris sessions (clear + reload)...', LogCategory.IRIS_CHAT);
        await this._chatSessionService.resetAndReloadSessions();
        logger.info('Reset complete', LogCategory.IRIS_CHAT);
    }

    public updateDetectedExercise(
        exerciseTitle: string,
        exerciseId: number,
        releaseDate?: string,
        dueDate?: string,
        shortName?: string,
        courseId?: number,
    ): void {
        // Do not set isWorkspace here; workspaceDetectionService owns that flag.
        this._chatContextManager.registerExerciseAndAutoSelect({
            id: exerciseId,
            title: exerciseTitle,
            shortName,
            courseId,
            releaseDate,
            dueDate,
            source: 'system-default',
        });
    }

    public updateDetectedCourse(courseTitle: string, courseId: number, shortName?: string): void {
        this._chatContextManager.registerCourseAndAutoSelect({
            id: courseId,
            title: courseTitle,
            shortName,
            source: 'system-default',
        });
    }

    public createNewSession(): void {
        this._chatSessionService.createNewSession();
    }

    public switchToSession(sessionId: string): void {
        this._chatSessionService.switchToSession(sessionId);
    }

    public getSelectedContext(): ActiveContext | null {
        return this._chatContextManager.getSelectedContext();
    }

    public getSelectedExerciseId(): number | undefined {
        return this._chatContextManager.getSelectedExerciseId();
    }

    // ── Workspace detection sink ──────────────────────────────────────
    // Called by wireWorkspaceDetection at activation. The provider implements
    // the sink because it owns the ChatContextManager + presenter that need
    // to be refreshed when the workspace exercise changes.

    public registerWorkspaceExercise(input: {
        id: number;
        title: string;
        shortName?: string;
        courseId?: number;
        repositoryUri?: string;
        source: 'workspace-detected';
        isWorkspace: true;
    }): void {
        this._chatContextManager.registerExerciseAndAutoSelect(input);
    }

    public clearWorkspaceExercise(): void {
        this._chatContextManager.clearStaleWorkspaceContext();
        this._contextStore.clearWorkspaceFlag();
        this._viewStatePresenter.postSnapshot();
    }

    public setCourseContext(
        courseId: number,
        courseTitle: string,
        reason: ChatContextReason = 'user-selected',
        shortName?: string,
    ): void {
        this._chatContextManager.setCourseContext(courseId, courseTitle, reason, shortName);
    }

    public setExerciseContext(
        exerciseId: number,
        exerciseTitle: string,
        reason: ChatContextReason = 'user-selected',
        shortName?: string,
        releaseDate?: string,
        dueDate?: string,
        courseId?: number,
    ): void {
        this._chatContextManager.setExerciseContext(exerciseId, exerciseTitle, reason, shortName, releaseDate, dueDate, courseId);
        // Telemetry event is now fired by the onDidChangeActiveContext subscription
    }

    // ── BaseWebviewProvider hooks ──────────────────────────────────────

    protected _onReady(): void {
        this._sendInitData();
    }

    protected _handleCommand(message: Extract<WebviewToExtensionMessage, { type: 'command' }>): void {
        try {
            switch (message.command) {
                case WebviewCmd.SendMessage: {
                    const { text, localId, localSessionId } = getPayload<WebCmd<'sendMessage'>>(message);
                    void this._handleChatMessage({ text, localId, localSessionId }).catch(err => {
                        logger.error('Error handling chat message', LogCategory.IRIS_CHAT, err);
                        vscode.window.showErrorMessage('Failed to send message. Please try again.');
                    });
                    break;
                }
                case WebviewCmd.SelectChatContext: {
                    const { context, itemId, itemName, itemShortName } = getPayload<WebCmd<'selectChatContext'>>(message);
                    if (context && typeof itemId === 'number' && typeof itemName === 'string') {
                        this._handleContextSelection(context, itemId, itemName, itemShortName);
                    }
                    break;
                }
                case WebviewCmd.CreateNewSession:
                    this.createNewSession();
                    break;
                case WebviewCmd.SwitchSession: {
                    const { sessionId } = getPayload<WebCmd<'switchSession'>>(message);
                    if (typeof sessionId === 'string') {
                        this.switchToSession(sessionId);
                    }
                    break;
                }
                case WebviewCmd.SwitchToWorkspaceContext:
                    this._handleSwitchToWorkspaceContext();
                    break;
                case WebviewCmd.OpenDiagnostics:
                    void this._handleOpenDiagnostics().catch(err => {
                        logger.error('Error opening diagnostics', LogCategory.IRIS_CHAT, err);
                        vscode.window.showErrorMessage('Failed to open diagnostics report');
                    });
                    break;
                case WebviewCmd.DebugSessions:
                    void this._handleDebugSessions().catch((err: unknown) => {
                        logger.error('Error debugging sessions', LogCategory.IRIS_CHAT, err);
                        vscode.window.showErrorMessage('Failed to fetch debug session data');
                    });
                    break;
                case WebviewCmd.ResetChatSessions:
                    void this._handleResetSessions().catch(err => {
                        logger.error('Error resetting sessions', LogCategory.IRIS_CHAT, err);
                        vscode.window.showErrorMessage('Failed to reset chat sessions. Please try again.');
                    });
                    break;
                case WebviewCmd.ReconnectWebSocket:
                    void this._handleReconnectWebSocket().catch(err => {
                        logger.error('Error reconnecting WebSocket', LogCategory.IRIS_CHAT, err);
                        vscode.window.showErrorMessage('Failed to reconnect. Please try again.');
                    });
                    break;
                case WebviewCmd.ReloadChatSession:
                    // Manual Retry from the unavailable banner. Single-flight
                    // is enforced inside _reloadChatSession so a button mash
                    // or a concurrent reconnect can't kick off duplicates.
                    void this._reloadChatSession('manual-retry');
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
     * If the webview did not include `localId`/`localSessionId` in the
     * sendMessage command (older-build edge case), we cannot correlate
     * the rejection to a message and instead post an assistant-style
     * AddMessage as a self-healing fallback — the current webview's
     * AddMessage handler already calls resetTransientChatUi.
     */
    private _handleRejectedSend(
        result: { sent: false; reason: 'no-ai' | 'no-context' | 'iris-disabled' | 'iris-unavailable'; contextLabel?: string; capturedContext?: ActiveContext },
        localId: string | undefined,
        localSessionId: string | undefined,
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
                const live = this._contextStore.getActiveContext();
                const captured = result.capturedContext;
                if (!live || !captured || live.type !== captured.type || live.id !== captured.id) {
                    break;
                }
                if (result.reason === 'iris-disabled') {
                    this._chatSessionService.postAvailability({ kind: 'disabled' }, captured);
                } else {
                    this._chatSessionService.postAvailability(
                        { kind: 'unavailable', reason: 'Send rejected: iris-unavailable' },
                        captured,
                    );
                }
                break;
            }
        }

        if (localId && localSessionId) {
            this._postMessageSafe({
                type: ExtensionMsg.SendRejected,
                localId,
                localSessionId,
                reason: result.reason,
                errorMessage,
            });
            return;
        }

        // Fallback for builds that don't carry the new correlation IDs.
        // Posting an assistant AddMessage causes the existing webview
        // handler to call resetTransientChatUi, which clears the stuck
        // indicator at the cost of a slightly noisier UX.
        this._postMessageSafe({
            type: ExtensionMsg.AddMessage,
            message: {
                role: 'assistant',
                content: errorMessage,
                timestamp: Date.now(),
            }
        });
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
     * Uses the shared CourseDataCache to avoid duplicate API calls — the sidebar
     * and chat share the same cached data.
     */
    private async _populateAvailableContexts(): Promise<void> {
        if (!this._courseDataCache) { return; }
        try {
            const data = await this._courseDataCache.fetch();
            const courses = data?.courses;
            if (!courses || !Array.isArray(courses)) { return; }

            for (const entry of courses) {
                const course = entry.course;
                if (!course?.id || !course.title) { continue; }

                this._chatContextManager.registerCourseAndAutoSelect({
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
                    this._chatContextManager.registerExerciseAndAutoSelect({
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

    private _handleContextSelection(contextType: ChatContextType, itemId: number, itemName: string, itemShortName?: string): void {
        this._chatContextManager.handleContextSelection(contextType, itemId, itemName, itemShortName);
    }

    private async _loadIrisMessagesIfNeeded(): Promise<void> {
        logger.debug('_loadIrisMessagesIfNeeded called', LogCategory.IRIS_CHAT);
        const activeContext = this._contextStore.getActiveContext();

        if (!activeContext) {
            logger.debug('No active context, skipping message load', LogCategory.IRIS_CHAT);
            return;
        }

        // Always reload sessions fresh from Artemis when view loads
        logger.debug('Reloading all sessions fresh from Artemis...', LogCategory.IRIS_CHAT, {
            contextType: activeContext.type,
            contextId: activeContext.id
        });
        await this._chatSessionService.loadAllSessionsForContext();
    }

    private _handleOpenHelpPopup(): void {
        vscode.window.showInformationMessage(
            'Iris Chat Context Guide',
            { modal: true, detail: IRIS_CHAT_HELP_MARKDOWN }
        );
    }

    private _handleSwitchToWorkspaceContext(): void {
        const workspaceExercise = this._chatContextManager.handleSwitchToWorkspaceContext();
        if (!workspaceExercise) {
            vscode.window.showWarningMessage('No workspace exercise detected. Open a workspace folder with a git repository.');
            return;
        }
        this.setExerciseContext(
            workspaceExercise.id,
            workspaceExercise.title,
            'workspace-detected',
            workspaceExercise.shortName,
            workspaceExercise.releaseDate,
            workspaceExercise.dueDate,
            workspaceExercise.courseId
        );
    }

    private async _handleChatMessage(message: { text?: string; localId?: string; localSessionId?: string }): Promise<void> {
        if (typeof message.text !== 'string') { return; }

        const content = message.text;
        const localId = typeof message.localId === 'string' ? message.localId : undefined;
        const localSessionId = typeof message.localSessionId === 'string' ? message.localSessionId : undefined;

        // Emit pending before the API call so the recording captures send attempts
        // even when the call never returns (e.g. network hang).
        this._onDidAttemptIrisChatSend.fire({ content, status: 'pending' });

        try {
            const result = await this._chatMessageService.sendMessage({
                text: content,
                isNoAiEnabled: this._noAiDetectionService.isNoAiEnabled,
                struggleContext: this.getStruggleContext(),
            });

            if (result.sent) {
                this._onDidAttemptIrisChatSend.fire({ content, status: 'sent' });
                this._onDidSendIrisChatMessage.fire(content);
            } else {
                // Fire terminal 'failed' so the pending event is never orphaned.
                this._onDidAttemptIrisChatSend.fire({
                    content,
                    status: 'failed',
                    errorMessage: `send-rejected: ${result.reason ?? 'unknown'}`,
                });
                this._handleRejectedSend(result, localId, localSessionId);
            }
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this._onDidAttemptIrisChatSend.fire({ content, status: 'failed', errorMessage });
            vscode.window.showErrorMessage(`Failed to send message: ${errorMessage}`);
            this._postMessageSafe({
                type: ExtensionMsg.AddMessage,
                message: {
                    role: 'assistant',
                    content: `Error: ${errorMessage}`,
                    timestamp: Date.now()
                }
            });
        }
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

    private async _handleDebugSessions(): Promise<void> {
        const activeContext = this._contextStore.getActiveContext();
        if (!activeContext) {
            vscode.window.showWarningMessage('No context selected. Please select an exercise or course first.');
            return;
        }

        const { report, sessionCount } = await this._chatDiagnosticsService.generateDebugSessionsReport();
        const document = await vscode.workspace.openTextDocument({ content: report, language: 'json' });
        await vscode.window.showTextDocument(document, { preview: false, viewColumn: vscode.ViewColumn.Active });
        vscode.window.showInformationMessage(`Found ${sessionCount} session(s) on Artemis`);
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

    private async _handleResetSessions(): Promise<void> {
        const confirmation = await vscode.window.showWarningMessage(
            'This will clear all local Iris chat session data and reload all sessions from Artemis. Continue?',
            { modal: true },
            'Yes, Reset & Reload'
        );

        if (confirmation !== 'Yes, Reset & Reload') {
            return;
        }

        const count = await this._chatSessionService.resetAndReloadSessions();

        if (count > 0) {
            vscode.window.showInformationMessage(`Successfully reloaded ${count} session(s) from Artemis`);
        } else {
            vscode.window.showInformationMessage('No sessions found on Artemis for this context');
        }
    }
}
