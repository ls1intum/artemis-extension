import * as vscode from 'vscode';
import { IrisChatView } from '../views/irisChat/irisChatView';
import {
    ActiveContext,
    StoredSession,
    ChatContextType,
    ContextSnapshot,
} from './contextTypes';
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
    ExerciseRegistry,
    detectWorkspaceExercise
} from '../services';

type ChatContextReason =
    | 'user-selected'
    | 'auto-workspace'
    | 'auto-first'
    | 'auto-recent'
    | 'default'
    | 'workspace-detected';

export class ChatWebviewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
    public static readonly viewType = 'iris.chatView';

    private _view?: vscode.WebviewView;
    private _irisChatView?: IrisChatView;
    private readonly _contextStore: ContextStore;
    private readonly _disposables: vscode.Disposable[] = [];
    private _fileMonitorService: FileMonitorService;
    private _irisSessionManager?: IrisSessionManager;
    private _chatDiagnosticsService: ChatDiagnosticsService;
    private _chatSessionService: ChatSessionService;
    private _chatMessageService: ChatMessageService;
    private _chatContextManager: ChatContextManager;
    private _sessionManagementService: SessionManagementService;
    private _websocketMessageHandler: WebSocketMessageHandler;

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly _extensionContext: vscode.ExtensionContext,
        private readonly _artemisApiService?: ArtemisApiService,
        private readonly _websocketService?: ArtemisWebsocketService,
    ) {
        this._contextStore = new ContextStore(this._extensionContext);
        this._fileMonitorService = new FileMonitorService();
        this._disposables.push(this._fileMonitorService);
        this._chatDiagnosticsService = new ChatDiagnosticsService(this._contextStore, this._artemisApiService);
        this._chatSessionService = new ChatSessionService(
            this._contextStore,
            this._artemisApiService,
            (message) => this._view?.webview.postMessage(message),
            () => this._loadIrisMessages(),
            () => this.createNewSession(),
            () => this._postSnapshot()
        );
        this._chatMessageService = new ChatMessageService(
            this._contextStore,
            this._artemisApiService,
            this._websocketService,
            () => this._irisSessionManager,
            (message) => this._view?.webview.postMessage(message),
            (context) => this._initializeIrisSession(context),
            () => this._postSnapshot()
        );
        this._chatContextManager = new ChatContextManager(
            this._contextStore,
            this._chatSessionService,
            () => this._irisSessionManager,
            (message) => this._view?.webview.postMessage(message)
        );
        this._sessionManagementService = new SessionManagementService(
            this._contextStore,
            this._artemisApiService,
            () => this._irisSessionManager,
            (message) => this._view?.webview.postMessage(message),
            () => this._postSnapshot(),
            () => this._loadIrisMessages()
        );
        this._websocketMessageHandler = new WebSocketMessageHandler(
            this._websocketService,
            () => this._irisSessionManager,
            (message) => this._view?.webview.postMessage(message)
        );

        if (this._artemisApiService && this._websocketService) {
            this._irisSessionManager = new IrisSessionManager(this._artemisApiService, this._websocketService);
            this._disposables.push(this._irisSessionManager);

            this._irisSessionManager.onDidReceiveMessage(data => this._websocketMessageHandler.handleIrisWebSocketMessage(data));
            this._irisSessionManager.onDidConnectionStateChange(isConnected => this._websocketMessageHandler.updateWebSocketStatus(isConnected));
        }

        this._fileMonitorService.onDidUpdateFiles(update => {
            if (this._view) {
                this._view.webview.postMessage({
                    command: 'updateReferencedFiles',
                    ...update
                });
            }
        });
    }

    public dispose(): void {
        while (this._disposables.length > 0) {
            const disposable = this._disposables.pop();
            disposable?.dispose();
        }
    }

    private _handleIrisWebSocketMessage(data: any): void {
        this._websocketMessageHandler.handleIrisWebSocketMessage(data);
    }

    private _getOrCreateIrisChatView(): IrisChatView {
        if (!this._irisChatView) {
            this._irisChatView = new IrisChatView(this._extensionContext);
        }
        return this._irisChatView;
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        console.log('[WebsocketLog] 🌐 Iris Chat webview being resolved/loaded');
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri],
        };

        const config = vscode.workspace.getConfiguration('artemis');
        const showDeveloperTools = !config.get<boolean>('hideDeveloperTools', true);
        webviewView.webview.html = this._getOrCreateIrisChatView().generateHtml(webviewView.webview, showDeveloperTools);

        const messageListener = webviewView.webview.onDidReceiveMessage(message => {
            this._handleMessage(message);
        });
        this._disposables.push(messageListener);

        const visibilityListener = webviewView.onDidChangeVisibility(() => {
            if (webviewView.visible) {
                console.log('[WebsocketLog] 👁️ Iris Chat view became visible, loading data...');
                this._postSnapshot();
                void this._detectWorkspaceExercise();
                // Load Iris messages if context is already selected
                void this._loadIrisMessagesIfNeeded();
                // Update referenced files display
                void this._fileMonitorService.triggerUpdate();
            } else {
                console.log('[WebsocketLog] 👁️‍🗨️ Iris Chat view became hidden');
            }
        });
        this._disposables.push(visibilityListener);

        const workspaceListener = vscode.workspace.onDidChangeWorkspaceFolders(() => {
            void this._detectWorkspaceExercise();
        });
        this._disposables.push(workspaceListener);

        const configListener = vscode.workspace.onDidChangeConfiguration(event => {
            if (event.affectsConfiguration('artemis.hideDeveloperTools')) {
                this.refreshTheme();
            }
            if (event.affectsConfiguration('artemis.iris.sendUncommittedChanges')) {
                // Update file display when setting changes
                void this._fileMonitorService.triggerUpdate();
            }
        });
        this._disposables.push(configListener);

        this._postSnapshot();
        void this._detectWorkspaceExercise();
        // Load Iris messages if context is already selected
        void this._loadIrisMessagesIfNeeded();

        // Start monitoring WebSocket status
        // this._startWebSocketMonitoring(); // Handled by IrisSessionManager

        // Trigger initial file update
        void this._fileMonitorService.triggerUpdate();
    }

    // private _startWebSocketMonitoring(): void { ... } // Removed

    private _mapReasonToSource(reason: ChatContextReason): 'workspace-detected' | 'user-selected' | 'system-default' {
        switch (reason) {
            case 'user-selected':
                return 'user-selected';
            case 'auto-workspace':
            case 'workspace-detected':
                return 'workspace-detected';
            default:
                return 'system-default';
        }
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

    private _serializeSnapshot(snapshot: ContextSnapshot) {
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
        if (!this._view) {
            return;
        }
        const snapshot = this._contextStore.snapshot();
        const payload = this._serializeSnapshot(snapshot);
        this._view.webview.postMessage({
            command: 'updateIrisState',
            state: payload,
        });

        if (options.showContextPicker) {
            this._view.webview.postMessage({
                command: 'showContextPicker',
                state: payload,
            });
        }
    }



    private _resetSessionStateForContextChange(): void {
        // this._currentArtemisSessionId = undefined; // Handled by IrisSessionManager

        if (this._irisSessionManager) {
            this._irisSessionManager.unsubscribe();
        }
    }

    private async _detectWorkspaceExercise(): Promise<void> {
        try {
            const registry = ExerciseRegistry.getInstance();
            let exercises = registry.getAllExercises();

            // If registry is empty, try to fetch courses first to populate it
            if (exercises.length === 0 && this._artemisApiService) {
                console.log('[Iris Chat] Registry empty, fetching courses to populate exercises...');
                try {
                    const dashboardData = await this._artemisApiService.getCoursesForDashboard();
                    const courses = dashboardData?.courses;

                    if (courses && Array.isArray(courses) && courses.length > 0) {
                        // Flatten all exercises from all courses (same as main extension does)
                        for (const courseData of courses) {
                            const courseExercises = courseData?.course?.exercises || courseData?.exercises || [];
                            if (courseExercises.length > 0) {
                                // Register exercises from this course
                                registry.registerFromCourseData({
                                    course: courseData.course || courseData,
                                    exercises: courseExercises
                                });
                            }
                        }
                    }
                    exercises = registry.getAllExercises();
                    console.log(`[Iris Chat] Registry populated with ${exercises.length} exercises`);
                } catch (error) {
                    console.warn('[Iris Chat] Failed to fetch courses for registry population:', error);
                }
            }

            const detected = await detectWorkspaceExercise(exercises);

            if (detected) {
                console.log(`[Iris Chat] Detected workspace exercise: ${detected.title} (ID: ${detected.id})`);
            } else {
                console.log('[Iris Chat] No workspace exercise detected matching current git remote');
            }

            if (!detected) {
                // If we have a stale workspace-detected context but can't verify it anymore, clear it
                // We do this even if exercises.length is 0, because if we just tried to fetch and got nothing,
                // it means we really don't know about this exercise.
                const current = this._contextStore.getActiveContext();
                if (current && current.source === 'workspace-detected') {
                    console.log('[Iris Chat] Clearing stale workspace context:', current.title);
                    this._contextStore.clearActiveContext();
                    this._postSnapshot();
                }
                return;
            }

            const baseTitle = detected.title.replace(/ \(Workspace\)$/i, '');
            const displayTitle = `${baseTitle} (Workspace)`;

            console.log(`[IRISDEBUG] chatWebviewProvider: Registering workspace exercise id=${detected.id}, title=${displayTitle}, isWorkspace=true`);

            this._contextStore.registerExercise({
                id: detected.id,
                title: displayTitle,
                shortName: detected.shortName,
                repositoryUri: detected.repositoryUri,
                source: 'workspace-detected',
                isWorkspace: true,
            });

            this._postSnapshot();
        } catch (error) {
            // Not a git repository or command failed - ignore silently
        }
    }

    private _handleMessage(message: any): void {
        switch (message.command) {
            case 'sendMessage':
                this._handleChatMessage(message);
                break;
            case 'selectChatContext':
                this._handleContextSelection(message.context, message.itemId, message.itemName, message.itemShortName);
                break;
            case 'selectExerciseContext': // Legacy
                this._handleExerciseSelection(message.exerciseId);
                break;
            case 'selectCourseContext': // Legacy
                this._handleCourseSelection(message.courseId);
                break;
            case 'createNewSession':
                this.createNewSession();
                break;
            case 'switchSession':
                if (typeof message.sessionId === 'string') {
                    this.switchToSession(message.sessionId);
                }
                break;
            case 'switchContext':
                this._handleSwitchContext();
                break;
            case 'switchToWorkspaceContext':
                this._handleSwitchToWorkspaceContext();
                break;
            case 'openDiagnostics':
                this._chatDiagnosticsService.handleOpenDiagnostics().catch(err => {
                    console.error('Error opening diagnostics:', err);
                    vscode.window.showErrorMessage('Failed to open diagnostics report');
                });
                break;
            case 'debugSessions':
                this._chatDiagnosticsService.handleDebugSessions().catch((err: any) => {
                    console.error('Error debugging sessions:', err);
                    vscode.window.showErrorMessage('Failed to fetch debug session data');
                });
                break;
            case 'resetChatSessions':
                this._handleResetSessions();
                break;
            case 'reconnectWebSocket':
                this._handleReconnectWebSocket();
                break;
            case 'chatViewReady':
                this._postSnapshot();
                break;
            case 'messageFeedback':
                this._handleMessageFeedback(message);
                break;
            case 'openSettings':
                if (message.setting) {
                    vscode.commands.executeCommand('workbench.action.openSettings', message.setting);
                }
                break;
            case 'openFile':
                if (message.filePath) {
                    this._handleOpenFile(message.filePath);
                }
                break;
            default:
                console.log('[Iris Chat] Unhandled message in chat view:', message);
                break;
        }
    }

    private _handleContextSelection(contextType: ChatContextType, itemId: number, itemName: string, itemShortName?: string): void {
        this._chatContextManager.handleContextSelection(contextType, itemId, itemName, itemShortName);
    }

    private async _loadIrisMessages(): Promise<void> {
        const activeContext = this._contextStore.getActiveContext();
        if (!activeContext || !this._artemisApiService || !this._view) {
            return;
        }

        try {
            await this._initializeIrisSession(activeContext);
        } catch (error: any) {
            console.error('Failed to load Iris messages:', error);
            vscode.window.showWarningMessage(`Could not load previous messages: ${error.message}`);
        }
    }

    private async _loadIrisMessagesIfNeeded(): Promise<void> {
        console.log('[WebsocketLog] 📨 _loadIrisMessagesIfNeeded called');
        const activeContext = this._contextStore.getActiveContext();

        if (!activeContext) {
            console.log('[WebsocketLog] ⚠️ No active context, skipping message load');
            return;
        }

        // Always reload sessions fresh from Artemis when view loads
        console.log('[WebsocketLog] 🔄 Reloading all sessions fresh from Artemis...', {
            contextType: activeContext.type,
            contextId: activeContext.id
        });
        await this._chatSessionService.loadAllSessionsForContext();
    }



    private _handleSwitchContext(): void {
        this._chatContextManager.handleSwitchContext();
        this._postSnapshot({ showContextPicker: true });
    }

    private _handleOpenFile(filePath: string): void {
        // Try to find and open the file in the workspace
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            vscode.window.showWarningMessage('No workspace folder open');
            return;
        }

        // Try to find the file in the workspace
        const fileUri = vscode.Uri.joinPath(workspaceFolders[0].uri, filePath);
        vscode.workspace.openTextDocument(fileUri).then(
            doc => vscode.window.showTextDocument(doc),
            () => {
                // If not found with the exact path, try to find it
                vscode.workspace.findFiles(`**/${filePath.split('/').pop()}`).then(files => {
                    if (files.length > 0) {
                        vscode.workspace.openTextDocument(files[0]).then(
                            doc => vscode.window.showTextDocument(doc)
                        );
                    } else {
                        vscode.window.showWarningMessage(`Could not find file: ${filePath}`);
                    }
                });
            }
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
                workspaceExercise.dueDate
            );
        }
    }

    private _handleCourseSelection(courseId: number): void {
        this._chatContextManager.handleCourseSelection(courseId);
    }

    private _handleExerciseSelection(exerciseId: number): void {
        this._chatContextManager.handleExerciseSelection(exerciseId);
    }



    private async _handleChatMessage(message: any): Promise<void> {
        const activeContext = this._contextStore.getActiveContext();
        if (!activeContext) {
            console.log('[WebsocketLog] ⚠️ No active context');
            vscode.window.showErrorMessage('Please select a course or exercise context first');
            return;
        }

        // Check if Iris is enabled
        const isEnabled = await this._chatSessionService.checkAndLoadIrisSettings(activeContext);
        if (!isEnabled) {
            // Show disabled overlay when trying to send a message with Iris disabled
            if (this._view) {
                const contextLabel = activeContext.type === 'course' ? 'course' : 'exercise';
                this._view.webview.postMessage({
                    command: 'showDisabledState',
                    message: `Iris chat is not enabled for this ${contextLabel}. Please contact your instructor.`
                });
            }
            return;
        }

        // Delegate to ChatMessageService
        await this._chatMessageService.handleChatMessage(message.text, activeContext);
    }

    private async _handleMessageFeedback(message: any): Promise<void> {
        const sessionId: number | undefined = message.sessionId;
        const messageId: number | undefined = message.messageId;
        const feedback: string | undefined = message.feedback;

        console.log('[Iris Chat] Message feedback received:', { sessionId, messageId, feedback });

        if (!sessionId || !messageId || !feedback) {
            console.warn('Missing required feedback data:', { sessionId, messageId, feedback });
            return;
        }

        if (!this._artemisApiService) {
            console.warn('Artemis API service not available');
            return;
        }

        try {
            const isHelpful = feedback === 'positive';
            await this._artemisApiService.markMessageHelpful(sessionId, messageId, isHelpful);
            console.log(`[Iris Chat] Feedback submitted: ${feedback} for message ${messageId} in session ${sessionId}`);

            // Optional: Show user confirmation
            // vscode.window.showInformationMessage('Thanks for your feedback!');
        } catch (error) {
            console.error('Failed to send feedback to server:', error);
            vscode.window.showErrorMessage('Failed to submit feedback. Please try again.');
        }
    }

    private async _initializeIrisSession(context: ActiveContext): Promise<void> {
        console.log('[WebsocketLog] 🎬 _initializeIrisSession called', {
            contextType: context.type,
            contextId: context.id,
            contextTitle: context.title
        });

        if (!this._artemisApiService || !this._irisSessionManager) {
            console.error('[WebsocketLog] ❌ No Artemis API service or Session Manager available');
            return;
        }

        try {
            console.log(`[Iris Chat] Initializing Iris session for ${context.type}: ${context.title} (ID: ${context.id})`);

            // Check if we have a stored Artemis session ID for this local session
            const snapshot = this._contextStore.snapshot();
            const activeLocalSession = snapshot.activeSession;

            console.log('[Iris Chat] Active local session:', {
                id: activeLocalSession?.id,
                messageCount: activeLocalSession?.messageCount,
                artemisSessionId: activeLocalSession?.artemisSessionId,
                createdAt: activeLocalSession?.createdAt ? new Date(activeLocalSession.createdAt).toISOString() : 'unknown'
            });

            const sessionId = await this._irisSessionManager.initializeSession(context, activeLocalSession?.artemisSessionId);

            // If we didn't have a stored session ID, store it now
            if (!activeLocalSession?.artemisSessionId) {
                console.log('[Iris Chat] Storing NEW Artemis session ID mapping:', sessionId);
                this._contextStore.setArtemisSessionId(sessionId);
                this._postSnapshot();
            }

            console.log('[WebsocketLog] 🎯 Iris session initialized with ID:', sessionId);

            // Load existing messages if any
            console.log('[Iris Chat] Fetching messages for session:', sessionId);
            const messages = await this._artemisApiService.getChatMessages(sessionId);
            console.log(`[Iris Chat] Received ${messages?.length || 0} messages from Iris`);

            // If we expected messages but got none, the stored session might be stale
            if (activeLocalSession?.messageCount && activeLocalSession.messageCount > 0 &&
                (!messages || messages.length === 0)) {
                console.log('[Iris Chat] Warning: Expected', activeLocalSession.messageCount, 'messages but got none. Stored session might be stale.');
                console.log('[Iris Chat] Clearing stale Artemis session ID mapping...');

                // Clear the stale mapping
                this._contextStore.setArtemisSessionId(undefined as any);
                this._postSnapshot();

                vscode.window.showWarningMessage(
                    'This conversation\'s messages could not be found on the server. They may have been deleted. The session mapping has been reset.',
                    'Create New Conversation'
                ).then(selection => {
                    if (selection === 'Create New Conversation') {
                        this.createNewSession();
                    }
                });
            }

            if (this._view && messages && messages.length > 0) {
                console.log('[Iris Chat] Sending messages to webview:', messages);

                const formattedMessages = messages.map((msg: any) => {
                    // Extract content from the message structure
                    let content = '';
                    if (msg.content && Array.isArray(msg.content) && msg.content.length > 0) {
                        // Content is an array of content items
                        content = msg.content.map((item: any) => {
                            if (item.textContent) {
                                return item.textContent;
                            }
                            return item.toString();
                        }).join('\n');
                    } else if (typeof msg.content === 'string') {
                        content = msg.content;
                    } else if (msg.message) {
                        content = msg.message;
                    } else {
                        content = JSON.stringify(msg.content);
                    }

                    return {
                        id: msg.id,
                        role: msg.sender === 'USER' ? 'user' : 'assistant',
                        content: content,
                        timestamp: msg.sentAt ? new Date(msg.sentAt).getTime() : Date.now(),
                        helpful: msg.helpful // true, false, or null
                    };
                });

                // Small delay to ensure webview is ready
                setTimeout(() => {
                    if (this._view) {
                        this._view.webview.postMessage({
                            command: 'loadMessages',
                            messages: formattedMessages
                        });
                        console.log('[Iris Chat] Messages sent to webview');
                    }
                }, 100);
            } else {
                console.log('[Iris Chat] No messages to load or view not ready');
            }

            vscode.window.showInformationMessage(`Connected to Iris for ${context.title}`);
        } catch (error: any) {
            console.error('Error initializing Iris session:', error);
            throw new Error(`Failed to connect to Iris: ${error.message}`);
        }
    }

    public clearAllSessions(): void {
        console.log('[Iris Chat] Clearing all local Iris sessions...');

        if (this._irisSessionManager) {
            this._irisSessionManager.unsubscribe();
        }

        // Clear all sessions in the context store
        this._contextStore.clearAllSessions();

        // Clear chat UI
        if (this._view) {
            this._view.webview.postMessage({ command: 'clearChatMessages' });
        }

        // Post updated snapshot
        this._postSnapshot();

        console.log('[Iris Chat] All Iris sessions cleared');
    }

    private async _handleReconnectWebSocket(): Promise<void> {
        await this._websocketMessageHandler.handleReconnectWebSocket();
    }

    private _updateWebSocketStatus(isConnected: boolean): void {
        this._websocketMessageHandler.updateWebSocketStatus(isConnected);
    }

    private async _handleResetSessions(): Promise<void> {
        await this._sessionManagementService.handleResetSessions();
    }

    public refreshTheme(): void {
        if (this._view) {
            const config = vscode.workspace.getConfiguration('artemis');
            const showDeveloperTools = !config.get<boolean>('hideDeveloperTools', true);
            this._view.webview.html = this._getOrCreateIrisChatView().generateHtml(this._view.webview, showDeveloperTools);
            this._postSnapshot();
        }
    }

    public updateDetectedExercise(
        exerciseTitle: string,
        exerciseId: number,
        releaseDate?: string,
        dueDate?: string,
        shortName?: string,
    ): void {
        this._contextStore.registerExercise({
            id: exerciseId,
            title: exerciseTitle,
            shortName,
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
        return this._contextStore.getActiveContext();
    }

    public getSelectedExerciseId(): number | undefined {
        const active = this._contextStore.getActiveContext();
        return active?.type === 'exercise' ? active.id : undefined;
    }

    public getSelectedExercise(): { title: string; id: number } | undefined {
        const active = this._contextStore.getActiveContext();
        if (active?.type === 'exercise') {
            return {
                id: active.id,
                title: active.title,
            };
        }
        return undefined;
    }

    public setCourseContext(
        courseId: number,
        courseTitle: string,
        reason: ChatContextReason = 'user-selected',
        shortName?: string,
    ): void {
        this._contextStore.registerCourse({
            id: courseId,
            title: courseTitle,
            shortName,
            source: this._mapReasonToSource(reason),
        });

        // Clear any existing sessions for this context before loading new ones
        const contextKey = `course:${courseId}`;
        this._contextStore.clearSessionsForContext(contextKey);

        // Set context without automatically ensuring a session (we'll load from server first)
        this._contextStore.setActiveContext({
            type: 'course',
            id: courseId,
            title: courseTitle,
            shortName,
            source: this._mapReasonToSource(reason),
            locked: reason === 'workspace-detected',
            selectedAt: Date.now(),
        }, false);

        this._resetSessionStateForContextChange();

        // Clear messages immediately to avoid showing old context messages
        if (this._view) {
            this._view.webview.postMessage({ command: 'clearChatMessages' });
        }

        vscode.window.showInformationMessage(`Course context set to: ${courseTitle}`);

        // Load sessions for the new context, then update UI
        // The snapshot will be posted after sessions are loaded
        void this._chatSessionService.loadAllSessionsForContext();
    }

    public setExerciseContext(
        exerciseId: number,
        exerciseTitle: string,
        reason: ChatContextReason = 'user-selected',
        shortName?: string,
        releaseDate?: string,
        dueDate?: string,
    ): void {
        console.log('📍 [SET EXERCISE CONTEXT] Called with:', {
            exerciseId,
            exerciseTitle,
            shortName,
            releaseDate,
            dueDate,
            reason,
            source: this._mapReasonToSource(reason)
        });

        console.log('📍 [SET EXERCISE CONTEXT] Current active context BEFORE:', this._contextStore.getActiveContext());

        this._contextStore.registerExercise({
            id: exerciseId,
            title: exerciseTitle,
            shortName,
            releaseDate,
            dueDate,
            source: this._mapReasonToSource(reason),
            isWorkspace: reason === 'workspace-detected' || reason === 'auto-workspace',
        });

        console.log('📍 [SET EXERCISE CONTEXT] Exercise registered. Active context AFTER registerExercise:',
            this._contextStore.getActiveContext());

        // Clear any existing sessions for this context before loading new ones
        const contextKey = `exercise:${exerciseId}`;
        console.log('📍 [SET EXERCISE CONTEXT] Clearing sessions for context key:', contextKey);
        this._contextStore.clearSessionsForContext(contextKey);

        // Set context without automatically ensuring a session (we'll load from server first)
        console.log('📍 [SET EXERCISE CONTEXT] Setting active context to:', {
            type: 'exercise',
            id: exerciseId,
            title: exerciseTitle,
            shortName
        });

        this._contextStore.setActiveContext({
            type: 'exercise',
            id: exerciseId,
            title: exerciseTitle,
            shortName,
            source: this._mapReasonToSource(reason),
            locked: reason === 'workspace-detected' || reason === 'auto-workspace',
            selectedAt: Date.now(),
        }, false);

        console.log('📍 [SET EXERCISE CONTEXT] Active context AFTER setActiveContext:',
            this._contextStore.getActiveContext());

        this._resetSessionStateForContextChange();

        // Clear messages immediately to avoid showing old context messages
        if (this._view) {
            this._view.webview.postMessage({ command: 'clearChatMessages' });
        }

        vscode.window.showInformationMessage(`Exercise context set to: ${exerciseTitle}`);

        console.log('📍 [SET EXERCISE CONTEXT] Starting to load sessions for context...');

        // Load sessions for the new context, then update UI
        // The snapshot will be posted after sessions are loaded
        void this._chatSessionService.loadAllSessionsForContext();
    }

    public clearContext(): void {
        this._contextStore.clearActiveContext();
        this._postSnapshot();
    }
}
