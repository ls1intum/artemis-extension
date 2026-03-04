import * as vscode from 'vscode';
import {
    ActiveContext,
    StoredSession,
    ChatContextType,
    ContextSnapshot,
} from '../types';
import type { IChatWebviewProvider } from '../types/IChatWebviewProvider';
import { BaseWebviewProvider } from './baseWebviewProvider';
import { getReactWebviewHtml } from '../utils/webviewHelpers';
import { ExtensionMsg, WebviewMsgType, WebviewCmd, getPayload } from '../shared/messageContracts';
import type { ExtMsg, WebCmd, WebviewToExtensionMessage } from '../shared/messageContracts';
import { isWebviewMessage } from '../shared/messageContracts/typeGuards';
import { logger, LogCategory } from '../services/loggingService';
import { openSettings, openFileInWorkspace } from '../views/app/commands/utilityCommands';
import { ArtemisApiService } from '../api';
import {
    ArtemisWebsocketService,
    FileMonitorService,
    IrisSessionManager,
    ChatDiagnosticsService,
    ChatSessionService,
    ChatMessageService,
    ChatContextManager,
    SessionManagementService,
    WebSocketMessageHandler,
    ContextStore,
    TelemetryManager,
    StruggleContext,
    NoAiDetectionService,
    detectAndRegisterWorkspaceExercise
} from '../services';
import type { ChatContextReason } from '../services/chatContextManager';
import { IRIS_CHAT_HELP_MARKDOWN } from '../utils/helpContent';

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
    private _fileMonitorService: FileMonitorService;
    private _irisSessionManager?: IrisSessionManager;
    private _chatDiagnosticsService: ChatDiagnosticsService;
    private _chatSessionService: ChatSessionService;
    private _chatMessageService: ChatMessageService;
    private _chatContextManager: ChatContextManager;
    private _sessionManagementService: SessionManagementService;
    private _websocketMessageHandler: WebSocketMessageHandler;
    private _telemetryManager?: TelemetryManager;
    private _noAiDetectionService: NoAiDetectionService;
    private _currentExerciseId?: number;

    private readonly _onDidChangeExerciseContext = new vscode.EventEmitter<ExerciseContextChangeEvent>();
    public readonly onDidChangeExerciseContext = this._onDidChangeExerciseContext.event;


    // ── Constructor ────────────────────────────────────────────────────
    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly _extensionContext: vscode.ExtensionContext,
        private readonly _artemisApiService?: ArtemisApiService,
        private readonly _websocketService?: ArtemisWebsocketService,
    ) {
        super();
        this._disposables.push(this._onDidChangeExerciseContext);
        this._contextStore = new ContextStore(this._extensionContext);
        this._fileMonitorService = new FileMonitorService();
        this._disposables.push(this._fileMonitorService);
        this._chatDiagnosticsService = new ChatDiagnosticsService(this._contextStore, this._artemisApiService);
        this._chatSessionService = new ChatSessionService(
            this._contextStore,
            this._artemisApiService,
            (message) => this._postMessageSafe(message),
            () => this._loadIrisMessages(),
            () => this.createNewSession(),
            () => this._postSnapshot()
        );
        this._chatMessageService = new ChatMessageService(
            this._contextStore,
            this._artemisApiService,
            this._websocketService,
            () => this._irisSessionManager,
            (message) => this._postMessageSafe(message),
            (context) => this._irisSessionManager
                ? this._chatSessionService.initializeIrisSessionAndLoadMessages(context, this._irisSessionManager)
                : Promise.resolve(),
            () => this._postSnapshot()
        );
        this._chatContextManager = new ChatContextManager(
            this._contextStore,
            this._chatSessionService,
            () => this._irisSessionManager,
            (message) => this._postMessageSafe(message),
            () => this._postSnapshot()
        );
        this._sessionManagementService = new SessionManagementService(
            this._contextStore,
            this._artemisApiService,
            () => this._irisSessionManager,
            (message) => this._postMessageSafe(message),
            () => this._postSnapshot(),
            () => this._loadIrisMessages()
        );
        this._websocketMessageHandler = new WebSocketMessageHandler(
            this._websocketService,
            () => this._irisSessionManager,
            (message) => this._postMessageSafe(message)
        );

        if (this._artemisApiService && this._websocketService) {
            this._irisSessionManager = new IrisSessionManager(this._artemisApiService, this._websocketService);
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

        // Initialize .noai detection service
        this._noAiDetectionService = NoAiDetectionService.getInstance();
        this._disposables.push(
            this._noAiDetectionService.onNoAiStatusChanged(isNoAiDetected => {
                this._postNoAiStatus(isNoAiDetected);
            })
        );
    }

    // ── Post-construction setters ──────────────────────────────────────

    /**
     * Set the telemetry manager for struggle detection integration
     */
    public setTelemetryManager(telemetryManager: TelemetryManager): void {
        this._telemetryManager = telemetryManager;

        // Start exercise session when context is selected
        logger.telemetry('Telemetry manager connected');
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
            localResourceRoots: [vscode.Uri.joinPath(this._extensionUri, 'dist')],
        };

        webviewView.webview.html = getReactWebviewHtml(webviewView.webview, this._extensionUri, 'irisChat');

        const messageListener = webviewView.webview.onDidReceiveMessage(message => {
            this._handleMessage(message);
        });
        this._disposables.push(messageListener);

        const visibilityListener = webviewView.onDidChangeVisibility(() => {
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

    private _sendInitData(): void {
        this._postSnapshot();
        void this._detectWorkspaceExercise();
        void this._loadIrisMessagesIfNeeded();
        void this._fileMonitorService.triggerUpdate();
        this._postNoAiStatus(this._noAiDetectionService.isNoAiEnabled);
    }

    // ── Public API ─────────────────────────────────────────────────────

    /**
     * Get current struggle context for Iris chat integration
     */
    public getStruggleContext(): StruggleContext | undefined {
        return this._telemetryManager?.getStruggleContext();
    }

    /**
     * Check if AI assistance is disabled due to .noai file
     */
    public isNoAiEnabled(): boolean {
        return this._noAiDetectionService.isNoAiEnabled;
    }

    public clearAllSessions(): void {
        logger.irisChat('Clearing all local Iris sessions...');

        if (this._irisSessionManager) {
            this._irisSessionManager.unsubscribe();
        }

        // Clear all sessions in the context store
        this._contextStore.clearAllSessions();

        // Clear chat UI
        this._postMessageSafe({ type: ExtensionMsg.ClearChatMessages });

        // Post updated snapshot
        this._postSnapshot();

        logger.irisChat('All Iris sessions cleared');
    }

    public updateDetectedExercise(
        exerciseTitle: string,
        exerciseId: number,
        releaseDate?: string,
        dueDate?: string,
        shortName?: string,
        courseId?: number,
    ): void {
        this._contextStore.registerExercise({
            id: exerciseId,
            title: exerciseTitle,
            shortName,
            courseId,
            releaseDate,
            dueDate,
            source: 'system-default',
            isWorkspace: /\\(Workspace\\)/i.test(exerciseTitle),
        });
        this._postSnapshot();
    }

    public removeDetectedExercise(exerciseId: number): void {
        this._contextStore.removeExercise(exerciseId);
        this._postSnapshot();
    }

    public updateDetectedCourse(courseTitle: string, courseId: number, shortName?: string): void {
        this._contextStore.registerCourse({
            id: courseId,
            title: courseTitle,
            shortName,
            source: 'system-default',
        });
        this._postSnapshot();
    }

    public removeDetectedCourse(courseId: number): void {
        this._contextStore.removeCourse(courseId);
        this._postSnapshot();
    }

    public createNewSession(): void {
        this._sessionManagementService.createNewSession();
    }

    public switchToSession(sessionId: string): void {
        this._sessionManagementService.switchToSession(sessionId);
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

        // Fire exercise context change event for TelemetryManager
        const previousExerciseId = this._currentExerciseId;
        this._currentExerciseId = exerciseId;
        this._onDidChangeExerciseContext.fire({
            exerciseId,
            previousExerciseId,
            exerciseRoot: vscode.workspace.workspaceFolders?.[0]?.uri,
        });
    }

    public clearContext(): void {
        this._chatContextManager.clearContext();
    }

    // ── Private: Message handling ──────────────────────────────────────

    private _handleMessage(message: unknown): void {
        if (!isWebviewMessage(message)) {
            return;
        }

        const typedMessage = message as WebviewToExtensionMessage;

        // Log error reports from webview ErrorBoundary
        if (typedMessage.type === WebviewMsgType.Error) {
            const errorPayload = typedMessage.payload;
            logger.error('Chat webview ErrorBoundary crash report', LogCategory.IRIS_CHAT, {
                message: errorPayload?.message,
                stack: errorPayload?.stack,
                componentStack: errorPayload?.componentStack,
            });
            return;
        }

        // Handle React ready signal
        if (typedMessage.type === WebviewMsgType.Ready) {
            this._markReady();
            this._sendInitData();
            return;
        }

        // Handle re-init requests (e.g. retry after error)
        if (typedMessage.type === WebviewMsgType.RequestInit) {
            this._sendInitData();
            return;
        }

        // Only command messages have command/payload properties
        if (typedMessage.type !== 'command') return;

        try {
            switch (typedMessage.command) {
                case WebviewCmd.SendMessage: {
                    const { text } = getPayload<WebCmd<'sendMessage'>>(typedMessage);
                    void this._handleChatMessage({ text }).catch(err => {
                        logger.error('Error handling chat message', LogCategory.IRIS_CHAT, err);
                        vscode.window.showErrorMessage('Failed to send message. Please try again.');
                    });
                    break;
                }
                case WebviewCmd.SelectChatContext: {
                    const { context, itemId, itemName, itemShortName } = getPayload<WebCmd<'selectChatContext'>>(typedMessage);
                    if (context && typeof itemId === 'number' && typeof itemName === 'string') {
                        this._handleContextSelection(context, itemId, itemName, itemShortName);
                    }
                    break;
                }
                case WebviewCmd.CreateNewSession:
                    this.createNewSession();
                    break;
                case WebviewCmd.SwitchSession: {
                    const { sessionId } = getPayload<WebCmd<'switchSession'>>(typedMessage);
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
                    this._handleResetSessions();
                    break;
                case WebviewCmd.ReconnectWebSocket:
                    this._handleReconnectWebSocket();
                    break;
                case WebviewCmd.MessageFeedback: {
                    const { sessionId, messageId, feedback } = getPayload<WebCmd<'messageFeedback'>>(typedMessage);
                    const parsedMsgId = typeof messageId === 'number'
                        ? messageId
                        : typeof messageId === 'string'
                            ? (Number.isNaN(Number(messageId)) ? undefined : parseInt(messageId as string, 10))
                            : undefined;
                    void this._handleMessageFeedback({
                        sessionId: typeof sessionId === 'number' ? sessionId : undefined,
                        messageId: parsedMsgId,
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
                    void this._handleUtilityCommand(typedMessage).then(handled => {
                        if (!handled) {
                            logger.debug('Unhandled message in chat view', LogCategory.IRIS_CHAT, typedMessage);
                        }
                    }).catch(err => {
                        logger.error('Error handling utility command', LogCategory.IRIS_CHAT, err);
                    });
                    break;
            }
        } catch (error) {
            logger.error('Error handling chat command', LogCategory.IRIS_CHAT, error);
            vscode.window.showErrorMessage(`Error processing command: ${typedMessage.command}`);
        }
    }

    private async _handleUtilityCommand(message: WebviewToExtensionMessage): Promise<boolean> {
        if (message.type !== 'command') return false;
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

    private _serializeSession(session: StoredSession) {
        return {
            id: session.id,
            artemisSessionId: session.artemisSessionId,
            preview: session.preview,
            messageCount: session.messageCount,
            createdAt: session.createdAt,
            lastActivity: session.lastActivity,
        };
    }

    private _serializeSnapshot(snapshot: ContextSnapshot): ExtMsg<'updateIrisState'>['state'] {
        return {
            context: snapshot.activeContext,
            activeSessionId: snapshot.activeSession?.id ?? null,
            sessions: snapshot.sessions.map(session => this._serializeSession(session)),
            recentExercises: snapshot.recentExercises,
            recentCourses: snapshot.recentCourses,
            allExercises: snapshot.allExercises,
            allCourses: snapshot.allCourses,
        };
    }

    private _postSnapshot(options: { showContextPicker?: boolean } = {}): void {
        const snapshot = this._contextStore.snapshot();
        const payload = this._serializeSnapshot(snapshot);

        // Include developer mode flag
        const config = vscode.workspace.getConfiguration('artemis');
        const showDiagnostics = config.get<boolean>('developerMode', false);

        this._postMessageSafe({
            type: ExtensionMsg.UpdateIrisState,
            state: payload,
            showDiagnostics,
        });

        if (options.showContextPicker) {
            this._postMessageSafe({
                type: ExtensionMsg.ShowContextPicker,
                state: payload,
            });
        }
    }

    private async _detectWorkspaceExercise(): Promise<void> {
        await detectAndRegisterWorkspaceExercise(
            this._artemisApiService,
            this._contextStore,
            () => this._postSnapshot(),
        );
    }

    private _handleContextSelection(contextType: ChatContextType, itemId: number, itemName: string, itemShortName?: string): void {
        this._chatContextManager.handleContextSelection(contextType, itemId, itemName, itemShortName);
    }

    private async _loadIrisMessages(): Promise<void> {
        const activeContext = this._contextStore.getActiveContext();
        if (!activeContext || !this._artemisApiService || !this._view || !this._irisSessionManager) {
            return;
        }

        try {
            await this._chatSessionService.initializeIrisSessionAndLoadMessages(activeContext, this._irisSessionManager);
        } catch (error: unknown) {
            logger.error('Failed to load Iris messages', LogCategory.IRIS_CHAT, error);
            const errorMessage = error instanceof Error ? error.message : String(error);
            vscode.window.showWarningMessage(`Could not load previous messages: ${errorMessage}`);
        }
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
        if (workspaceExercise) {
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
    }

    private async _handleChatMessage(message: { text?: string }): Promise<void> {
        // Check if .noai file is detected first
        if (this._noAiDetectionService.isNoAiEnabled) {
            logger.warn('Chat blocked: .noai file detected', LogCategory.IRIS_CHAT);
            this._postNoAiStatus(true);
            return;
        }

        const activeContext = this._contextStore.getActiveContext();
        if (!activeContext) {
            logger.warn('No active context', LogCategory.IRIS_CHAT);
            vscode.window.showErrorMessage('Please select a course or exercise context first');
            return;
        }

        // Check if Iris is enabled
        const isEnabled = await this._chatSessionService.checkAndLoadIrisSettings(activeContext);
        if (!isEnabled) {
            // Show disabled overlay when trying to send a message with Iris disabled
            const contextLabel = activeContext.type === 'course' ? 'course' : 'exercise';
            this._postMessageSafe({
                type: ExtensionMsg.ShowDisabledState,
                message: `Iris chat is not enabled for this ${contextLabel}. Please contact your instructor.`
            });
            return;
        }

        // Get struggle context if available
        const struggleContext = this.getStruggleContext();

        // Delegate to ChatMessageService with struggle context
        if (typeof message.text === 'string') {
            await this._chatMessageService.handleChatMessage(message.text, activeContext, struggleContext);
        }
    }

    private async _handleMessageFeedback(message: { sessionId?: number; messageId?: number; feedback?: string }): Promise<void> {
        const sessionId: number | undefined = message.sessionId;
        const messageId: number | undefined = message.messageId;
        const feedback: string | undefined = message.feedback;

        logger.irisChat('Message feedback received', { sessionId, messageId, feedback });

        if (!sessionId || !messageId || !feedback) {
            logger.irisChatWarn('Missing required feedback data', { sessionId, messageId, feedback });
            return;
        }

        if (!this._artemisApiService) {
            logger.irisChatWarn('Artemis API service not available');
            return;
        }

        try {
            const isHelpful = feedback === 'positive';
            await this._artemisApiService.markMessageHelpful(sessionId, messageId, isHelpful);
            logger.irisChat(`Feedback submitted: ${feedback} for message ${messageId} in session ${sessionId}`);

            // Optional: Show user confirmation
            // vscode.window.showInformationMessage('Thanks for your feedback!');
        } catch (error) {
            logger.error('Failed to send feedback to server', LogCategory.IRIS_CHAT, error);
            vscode.window.showErrorMessage('Failed to submit feedback. Please try again.');
        }
    }

    private async _handleReconnectWebSocket(): Promise<void> {
        await this._websocketMessageHandler.handleReconnectWebSocket();
    }

    private async _handleResetSessions(): Promise<void> {
        await this._sessionManagementService.handleResetSessions();
    }
}
