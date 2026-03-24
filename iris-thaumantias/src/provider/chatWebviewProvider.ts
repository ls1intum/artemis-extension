import * as vscode from 'vscode';
import {
    ActiveContext,
    ChatContextType,
} from '../types';
import type { IChatWebviewProvider } from '../types/IChatWebviewProvider';
import { BaseWebviewProvider } from './baseWebviewProvider';
import { ChatViewStatePresenter } from './chatViewStatePresenter';
import { ExtensionMsg, WebviewCmd, getPayload } from '../shared/messageContracts';
import type { WebCmd, WebviewToExtensionMessage } from '../shared/messageContracts';
import { openSettings, openFileInWorkspace } from '../views/app/commands/utilityCommands';
import { ArtemisApiService } from '../api';
import {
    ArtemisWebsocketService,
    FileMonitorService,
    IrisWebSocketSessionClient,
    ChatDiagnosticsService,
    IrisChatSessionService,
    ChatMessageService,
    ChatContextManager,
    IrisWebSocketMessageHandler,
    ContextStore,
    TelemetryManager,
    StruggleContext,
    NoAiDetectionService,
    ExerciseRegistry,
    detectAndRegisterWorkspaceExercise,
    getReactWebviewHtml,
    IRIS_CHAT_HELP_MARKDOWN,
    logger, LogCategory,
    type IrisServiceDeps,
    type ChatContextReason,
} from '../services';

export interface ExerciseContextChangeEvent {
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

    private readonly _onDidChangeExerciseContext = new vscode.EventEmitter<ExerciseContextChangeEvent>();
    public readonly onDidChangeExerciseContext = this._onDidChangeExerciseContext.event;

    private readonly _onDidSendIrisChatMessage = new vscode.EventEmitter<string>();
    public readonly onDidSendIrisChatMessage = this._onDidSendIrisChatMessage.event;

    private readonly _onDidChangePanelVisibility = new vscode.EventEmitter<boolean>();
    public readonly onDidChangePanelVisibility = this._onDidChangePanelVisibility.event;


    // ── Constructor ────────────────────────────────────────────────────
    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly _extensionContext: vscode.ExtensionContext,
        private readonly _artemisApiService: ArtemisApiService | undefined,
        private readonly _websocketService: ArtemisWebsocketService | undefined,
        noAiDetectionService: NoAiDetectionService,
        private readonly _exerciseRegistry: ExerciseRegistry,
        private readonly _telemetryManager?: TelemetryManager,
    ) {
        super(LogCategory.IRIS_CHAT);
        this._disposables.push(this._onDidChangeExerciseContext);
        this._disposables.push(this._onDidSendIrisChatMessage);
        this._disposables.push(this._onDidChangePanelVisibility);
        this._contextStore = new ContextStore(this._extensionContext);
        this._disposables.push(this._contextStore);
        this._disposables.push(
            this._contextStore.onDidChangeActiveContext(({ current, previous }) => {
                if (current?.type === 'exercise') {
                    this._onDidChangeExerciseContext.fire({
                        exerciseId: current.id,
                        previousExerciseId: previous?.type === 'exercise' ? previous.id : undefined,
                        exerciseRoot: vscode.workspace.workspaceFolders?.[0]?.uri,
                    });
                }
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
            (message) => this._postMessageSafe(message)
        );

        if (this._artemisApiService && this._websocketService) {
            this._irisSessionManager = new IrisWebSocketSessionClient(this._artemisApiService, this._websocketService);
            this._disposables.push(this._irisSessionManager);

            this._irisSessionManager.onDidReceiveMessage(data => this._websocketMessageHandler.handleIrisWebSocketMessage(data));
            this._irisSessionManager.onDidConnectionStateChange(isConnected => this._websocketMessageHandler.updateWebSocketStatus(isConnected));
        }

        this._fileMonitorService.onDidUpdateFiles(update => {
            this._postMessageSafe({
                type: ExtensionMsg.UpdateReferencedFiles,
                ...update
            });
        });

        this._noAiDetectionService = noAiDetectionService;
        this._disposables.push(
            this._noAiDetectionService.onNoAiStatusChanged(isNoAiDetected => {
                this._postNoAiStatus(isNoAiDetected);
            })
        );
    }

    // ── Lifecycle ──────────────────────────────────────────────────────

    public dispose(): void {
        this._drainDisposables();
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        logger.debug('Iris Chat webview being resolved/loaded', LogCategory.VIEW);
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
        this._disposables.push(messageListener);

        const visibilityListener = webviewView.onDidChangeVisibility(() => {
            this._onDidChangePanelVisibility.fire(webviewView.visible);
            if (webviewView.visible) {
                logger.debug('Iris Chat view became visible, loading data...', LogCategory.VIEW);
                this._sendInitData();
            } else {
                logger.debug('Iris Chat view became hidden', LogCategory.VIEW);
            }
        });
        this._disposables.push(visibilityListener);

        const workspaceListener = vscode.workspace.onDidChangeWorkspaceFolders(() => {
            void this._detectWorkspaceExercise();
        });
        this._disposables.push(workspaceListener);

        const configListener = vscode.workspace.onDidChangeConfiguration(event => {
            if (event.affectsConfiguration('artemis.developerMode')) {
                this.refreshTheme();
            }
            if (event.affectsConfiguration('artemis.iris.sendUncommittedChanges')) {
                // Update file display when setting changes
                void this._fileMonitorService.triggerUpdate();
            }
        });
        this._disposables.push(configListener);

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
        await this._detectWorkspaceExercise();
        void this._loadIrisMessagesIfNeeded();
        void this._fileMonitorService.triggerUpdate();
        this._postNoAiStatus(this._noAiDetectionService.isNoAiEnabled);

        // Send current WebSocket connection status so the banner reflects reality
        if (this._websocketService) {
            this._websocketMessageHandler.updateWebSocketStatus(this._websocketService.isConnected());
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

    public clearAllSessions(): void {
        logger.info('Clearing all local Iris sessions...', LogCategory.IRIS_CHAT);

        if (this._irisSessionManager) {
            this._irisSessionManager.resetSession();
        }

        // Clear all sessions in the context store
        this._contextStore.clearAllSessions();

        // Clear chat UI
        this._postMessageSafe({ type: ExtensionMsg.ClearChatMessages });

        // Post updated snapshot
        this._viewStatePresenter.postSnapshot();

        logger.info('All Iris sessions cleared', LogCategory.IRIS_CHAT);
    }

    public updateDetectedExercise(
        exerciseTitle: string,
        exerciseId: number,
        releaseDate?: string,
        dueDate?: string,
        shortName?: string,
        courseId?: number,
    ): void {
        this._chatContextManager.registerExerciseAndAutoSelect({
            id: exerciseId,
            title: exerciseTitle,
            shortName,
            courseId,
            releaseDate,
            dueDate,
            source: 'system-default',
            isWorkspace: /\\(Workspace\\)/i.test(exerciseTitle),
        });
    }

    public removeDetectedExercise(exerciseId: number): void {
        this._chatContextManager.removeExerciseAndAutoSelect(exerciseId);
    }

    public updateDetectedCourse(courseTitle: string, courseId: number, shortName?: string): void {
        this._chatContextManager.registerCourseAndAutoSelect({
            id: courseId,
            title: courseTitle,
            shortName,
            source: 'system-default',
        });
    }

    public removeDetectedCourse(courseId: number): void {
        this._chatContextManager.removeCourseAndAutoSelect(courseId);
    }

    public createNewSession(): void {
        // If workspace exercise exists and we're not in workspace context, switch back
        const workspaceExercise = this._contextStore.getWorkspaceExercise();
        const currentContext = this._contextStore.getActiveContext();
        if (workspaceExercise && currentContext?.source !== 'workspace-detected') {
            this._handleSwitchToWorkspaceContext();
            return;
        }
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

    public getSelectedExercise(): { title: string; id: number } | undefined {
        return this._chatContextManager.getSelectedExercise();
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

    public clearContext(): void {
        this._chatContextManager.clearContext();
    }

    // ── BaseWebviewProvider hooks ──────────────────────────────────────

    protected _onReady(): void {
        this._sendInitData();
    }

    protected _handleCommand(message: Extract<WebviewToExtensionMessage, { type: 'command' }>): void {
        try {
            switch (message.command) {
                case WebviewCmd.SendMessage: {
                    const { text } = getPayload<WebCmd<'sendMessage'>>(message);
                    void this._handleChatMessage({ text }).catch(err => {
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
                    this._chatDiagnosticsService.handleOpenDiagnostics().catch(err => {
                        logger.error('Error opening diagnostics', LogCategory.IRIS_CHAT, err);
                        vscode.window.showErrorMessage('Failed to open diagnostics report');
                    });
                    break;
                case WebviewCmd.DebugSessions:
                    this._chatDiagnosticsService.handleDebugSessions().catch((err: unknown) => {
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
     * Post .noai status to the webview
     */
    private _postNoAiStatus(isNoAiDetected: boolean): void {
        this._postMessageSafe({
            type: ExtensionMsg.UpdateNoAiStatus,
            isNoAiDetected,
            noAiFilePath: this._noAiDetectionService.noAiFilePath
        });
    }


    private async _detectWorkspaceExercise(): Promise<void> {
        await detectAndRegisterWorkspaceExercise(
            this._artemisApiService,
            {
                registerExercise: (input) => this._chatContextManager.registerExerciseAndAutoSelect(input),
                clearStaleWorkspaceContext: () => {
                    const current = this._contextStore.getActiveContext();
                    if (current && current.source === 'workspace-detected') {
                        logger.info(`Clearing stale workspace context: ${current.title}`, LogCategory.IRIS_CHAT);
                        this._contextStore.clearActiveContext();
                        this._viewStatePresenter.postSnapshot();
                    }
                },
            },
            this._exerciseRegistry,
        );
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

    private async _handleChatMessage(message: { text?: string }): Promise<void> {
        if (typeof message.text !== 'string') { return; }

        try {
            const result = await this._chatMessageService.sendMessage({
                text: message.text,
                isNoAiEnabled: this._noAiDetectionService.isNoAiEnabled,
                struggleContext: this.getStruggleContext(),
            });

            if (result.sent) {
                this._onDidSendIrisChatMessage.fire(message.text!);
            } else {
                switch (result.reason) {
                    case 'no-ai':
                        this._postNoAiStatus(true);
                        break;
                    case 'no-context':
                        vscode.window.showErrorMessage('Please select a course or exercise context first');
                        break;
                    case 'iris-disabled':
                        this._postMessageSafe({
                            type: ExtensionMsg.ShowDisabledState,
                            message: `Iris chat is not enabled for this ${result.contextLabel}. Please contact your instructor.`
                        });
                        break;
                }
            }
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
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

        try {
            const isHelpful = feedback === 'positive';
            await this._artemisApiService.markMessageHelpful(sessionId, messageId, isHelpful);
            logger.info(`Feedback submitted: ${feedback} for message ${messageId} in session ${sessionId}`, LogCategory.IRIS_CHAT);
        } catch (error) {
            logger.error('Failed to send feedback to server', LogCategory.IRIS_CHAT, error);
            vscode.window.showErrorMessage('Failed to submit feedback. Please try again.');
        }
    }

    private async _handleReconnectWebSocket(): Promise<void> {
        await this._websocketMessageHandler.handleReconnectWebSocket();
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
