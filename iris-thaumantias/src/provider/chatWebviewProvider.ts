import * as vscode from 'vscode';
import { IrisChatView } from '../views/irisChat/irisChatView';
import { ExerciseRegistry } from './exerciseRegistry';
import { ContextStore } from './contextStore';
import { detectWorkspaceExercise } from '../services';
import {
    ActiveContext,
    StoredSession,
    ChatContextType,
    ContextSnapshot,
} from './contextTypes';
import { ArtemisApiService } from '../api';
import { ArtemisWebsocketService, FileMonitorService, IrisSessionManager } from '../services';
import { checkWorkspaceFiles } from '../utils';

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
    private _contextLoadToken = 0;
    private _fileMonitorService: FileMonitorService;
    private _irisSessionManager?: IrisSessionManager;

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly _extensionContext: vscode.ExtensionContext,
        private readonly _artemisApiService?: ArtemisApiService,
        private readonly _websocketService?: ArtemisWebsocketService,
    ) {
        this._contextStore = new ContextStore(this._extensionContext);
        this._fileMonitorService = new FileMonitorService();
        this._disposables.push(this._fileMonitorService);

        if (this._artemisApiService && this._websocketService) {
            this._irisSessionManager = new IrisSessionManager(this._artemisApiService, this._websocketService);
            this._disposables.push(this._irisSessionManager);

            this._irisSessionManager.onDidReceiveMessage(data => this._handleIrisWebSocketMessage(data));
            this._irisSessionManager.onDidConnectionStateChange(isConnected => this._updateWebSocketStatus(isConnected));
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
        console.log('[WebsocketLog] 🔔 Received Iris WebSocket message:', JSON.stringify(data, null, 2));

        if (!this._view) {
            console.log('[WebsocketLog] ⚠️ No view available to display message');
            return;
        }

        // Handle different message types
        if (data.type === 'MESSAGE' && data.message) {
            console.log('[WebsocketLog] 📦 Processing MESSAGE type');
            // Extract content from the message
            let content = '';
            const msg = data.message;

            if (msg.content && Array.isArray(msg.content) && msg.content.length > 0) {
                content = msg.content.map((item: any) => {
                    if (item.textContent) {
                        return item.textContent;
                    }
                    return item.toString();
                }).join('\n');
            } else if (typeof msg.content === 'string') {
                content = msg.content;
            }

            console.log('[WebsocketLog] 📝 Extracted content length:', content.length, 'chars');
            console.log('[WebsocketLog] 👤 Message sender:', msg.sender);

            // Only show assistant messages (user messages were already shown)
            if (msg.sender !== 'USER' && content) {
                console.log('[WebsocketLog] 🤖 Sending assistant message to webview (this should hide thinking indicator)');
                this._view.webview.postMessage({
                    command: 'addMessage',
                    message: {
                        id: msg.id,
                        role: 'assistant',
                        content: content,
                        timestamp: msg.sentAt ? new Date(msg.sentAt).getTime() : Date.now(),
                        helpful: msg.helpful // true, false, or null
                    }
                });
                console.log('[WebsocketLog] ✅ Assistant message sent to webview');
            } else {
                console.log('[WebsocketLog] ⏭️ Skipping message (either USER message or no content)');
            }
        } else if (data.type === 'STATUS') {
            // Handle status updates (e.g., "Iris is thinking...")
            console.log('[WebsocketLog] 📊 Iris status update:', data);
            // TODO: Show status indicator in UI
        } else {
            console.log('[WebsocketLog] ⚠️ Unknown message type or format:', data);
        }
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

    private _isCurrentContext(expected: ActiveContext, loadToken: number): boolean {
        if (loadToken !== this._contextLoadToken) {
            return false;
        }
        const current = this._contextStore.getActiveContext();
        return !!current && current.type === expected.type && current.id === expected.id;
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
            const exercises = registry.getAllExercises();

            const detected = await detectWorkspaceExercise(exercises);
            if (!detected) {
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
                this._handleOpenDiagnostics().catch(err => {
                    console.error('Error opening diagnostics:', err);
                    vscode.window.showErrorMessage('Failed to open diagnostics report');
                });
                break;
            case 'debugSessions':
                this._handleDebugSessions().catch((err: any) => {
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
            default:
                console.log('Unhandled message in chat view:', message);
                break;
        }
    }

    private _handleContextSelection(contextType: ChatContextType, itemId: number, itemName: string, itemShortName?: string): void {
        if (contextType === 'exercise') {
            this._contextStore.registerExercise({
                id: itemId,
                title: itemName,
                shortName: itemShortName,
                source: 'user-selected',
            });
        } else if (contextType === 'course') {
            this._contextStore.registerCourse({
                id: itemId,
                title: itemName,
                shortName: itemShortName,
                source: 'user-selected',
            });
        }

        this._contextStore.setActiveContext({
            type: contextType,
            id: itemId,
            title: itemName,
            shortName: itemShortName,
            source: 'user-selected',
            locked: false,
            selectedAt: Date.now(),
        });

        // Reset Iris session when context changes
        if (this._irisSessionManager) {
            this._irisSessionManager.unsubscribe();
        }

        // Clear chat messages
        if (this._view) {
            this._view.webview.postMessage({ command: 'clearChatMessages' });
        }

        // Don't post snapshot yet - wait for sessions to load first

        const label = contextType === 'exercise' ? 'Exercise' : contextType === 'course' ? 'Course' : 'Context';
        vscode.window.showInformationMessage(`${label} context set to: ${itemName}`);

        // Load all sessions for the new context and initialize
        // The snapshot will be posted after sessions are loaded
        this._loadAllSessionsForContext().catch((err: any) => {
            console.error('Error loading Iris sessions:', err);
        });
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

        // If we have an active session ID, just reload the messages for that session
        // (this handles the case when the sidebar is reopened and the webview is recreated)
        if (this._irisSessionManager?.currentSessionId) {
            console.log('[WebsocketLog] 🔄 Active session found on view reopen, reloading messages...', {
                sessionId: this._irisSessionManager.currentSessionId
            });
            await this._loadIrisMessages();
        } else {
            // No session initialized yet, load all sessions for the context
            console.log('[WebsocketLog] 📋 Active context found on startup, loading Iris messages...', {
                contextType: activeContext.type,
                contextId: activeContext.id
            });
            await this._loadAllSessionsForContext();
        }
    }

    private async _checkAndLoadIrisSettings(context: ActiveContext): Promise<boolean> {
        if (!this._artemisApiService) {
            console.warn('Artemis API service not available');
            return false;
        }

        try {
            console.log(`Checking Iris settings for ${context.type}: ${context.title}`);

            // Fetch settings based on context type
            let settings: any;
            if (context.type === 'course') {
                settings = await this._artemisApiService.getIrisCourseChatSettings(context.id);
            } else if (context.type === 'exercise') {
                settings = await this._artemisApiService.getIrisExerciseChatSettings(context.id);
            } else {
                console.warn(`Unsupported context type for Iris: ${context.type}`);
                return false;
            }

            // Check if Iris chat is enabled
            const chatSettings = context.type === 'course'
                ? settings?.irisChatSettings
                : settings?.irisProgrammingExerciseChatSettings;

            if (!chatSettings?.enabled) {
                console.log('Iris chat is disabled in settings');
                return false;
            }

            console.log('Iris chat is enabled, settings loaded:', {
                enabled: chatSettings.enabled,
                rateLimit: chatSettings.rateLimit,
                rateLimitTimeframeHours: chatSettings.rateLimitTimeframeHours
            });

            return true;
        } catch (error: any) {
            console.error('Error checking Iris settings:', error);

            // If it's a 403, Iris is probably disabled - return false to show disabled overlay
            if (error.status === 403 || error.message?.includes('403')) {
                console.log('Iris is not available (403 error)');
                return false;
            }

            // For other errors, log but still return false to show disabled state
            console.log(`Could not load Iris settings: ${error.message}`);
            return false;
        }
    }

    private async _loadAllSessionsForContext(): Promise<void> {
        const activeContext = this._contextStore.getActiveContext();

        console.log('🔄 [LOAD SESSIONS] Starting _loadAllSessionsForContext');
        console.log('🔄 [LOAD SESSIONS] Active context:', activeContext);

        if (!activeContext || !this._artemisApiService || !this._view) {
            console.log('🔄 [LOAD SESSIONS] Cannot load sessions: missing context, API service, or view', {
                hasContext: !!activeContext,
                hasApiService: !!this._artemisApiService,
                hasView: !!this._view
            });
            return;
        }

        const targetContext: ActiveContext = { ...activeContext };
        const loadToken = ++this._contextLoadToken;

        console.log('🔄 [LOAD SESSIONS] Target context for loading:', targetContext);
        console.log('🔄 [LOAD SESSIONS] Load token:', loadToken);

        try {
            console.log(`🔄 [LOAD SESSIONS] Loading all Iris sessions for ${activeContext.type}: ${activeContext.title} (ID: ${activeContext.id})`);

            // Step 0: Check if Iris is enabled for this context
            const isEnabled = await this._checkAndLoadIrisSettings(activeContext);

            if (!this._isCurrentContext(targetContext, loadToken)) {
                console.log('Context changed while checking Iris settings, aborting load');
                return;
            }

            if (!isEnabled) {
                console.log('Iris is disabled, not loading sessions');
                // Clear any existing sessions and show disabled overlay
                if (this._view) {
                    this._view.webview.postMessage({
                        command: 'clearChatMessages'
                    });
                    const contextLabel = activeContext.type === 'course' ? 'course' : 'exercise';
                    this._view.webview.postMessage({
                        command: 'showDisabledState',
                        message: `Iris chat is not enabled for this ${contextLabel}. Please contact your instructor.`
                    });
                }
                return;
            }

            // Hide disabled overlay if it was previously shown
            if (this._view) {
                this._view.webview.postMessage({
                    command: 'hideDisabledState'
                });
            }

            // Step 1: Fetch session metadata (fast, lightweight)
            let artemisSessionsMetadata: any[] = [];
            if (activeContext.type === 'course') {
                artemisSessionsMetadata = await this._artemisApiService.getCourseChatSessions(activeContext.id);
            } else if (activeContext.type === 'exercise') {
                artemisSessionsMetadata = await this._artemisApiService.getExerciseChatSessions(activeContext.id);
            } else {
                console.log(`Unsupported context type: ${activeContext.type}`);
                return;
            }

            console.log(`Fetched ${artemisSessionsMetadata.length} session(s) metadata from Artemis`);

            // Step 2: Fetch messages for each session (to display in list)
            const artemisSessionsListFromServer: any[] = await Promise.all(
                artemisSessionsMetadata.map(async (session) => {
                    if (!this._artemisApiService) {
                        return { ...session, messages: [] };
                    }
                    try {
                        console.log(`Fetching messages for session ${session.id}...`);
                        const messages = await this._artemisApiService.getChatMessages(session.id);
                        return {
                            ...session,
                            messages: messages
                        };
                    } catch (error) {
                        console.warn(`Failed to fetch messages for session ${session.id}:`, error);
                        return {
                            ...session,
                            messages: []
                        };
                    }
                })
            );

            console.log(`Fetched messages for all ${artemisSessionsListFromServer.length} sessions`);

            // CLEAR all existing sessions for this context to avoid stale data
            if (!this._isCurrentContext(targetContext, loadToken)) {
                console.log('Context changed before clearing sessions, aborting load');
                return;
            }

            const contextKey = `${targetContext.type}:${targetContext.id}`;
            console.log(`Clearing all existing sessions for context ${contextKey} before loading fresh data from Artemis`);
            this._contextStore.clearSessionsForContext(contextKey);

            // Clear chat messages immediately after clearing sessions to avoid showing old messages
            if (this._view) {
                this._view.webview.postMessage({ command: 'clearChatMessages' });
            }

            // Import all sessions from Artemis
            if (artemisSessionsListFromServer.length > 0) {
                // Sort sessions by creation date (newest first)
                artemisSessionsListFromServer.sort((a, b) => {
                    const dateA = a.creationDate ? new Date(a.creationDate).getTime() : 0;
                    const dateB = b.creationDate ? new Date(b.creationDate).getTime() : 0;
                    return dateB - dateA;
                });

                console.log(`Importing ${artemisSessionsListFromServer.length} sessions from Artemis`);

                for (const artemisSession of artemisSessionsListFromServer) {

                    if (!this._isCurrentContext(targetContext, loadToken)) {
                        console.log('Context changed while importing sessions, aborting load');
                        return;
                    }

                    // Create local session for each Artemis session
                    const messageCount = artemisSession.messages?.length || 0;
                    const createdAt = artemisSession.creationDate ? new Date(artemisSession.creationDate).getTime() : Date.now();

                    // Create preview from first user message or use default
                    let preview = 'New conversation';
                    if (artemisSession.messages && artemisSession.messages.length > 0) {
                        const firstUserMsg = artemisSession.messages.find((m: any) => m.sender === 'USER');
                        if (firstUserMsg?.content?.[0]?.textContent) {
                            preview = firstUserMsg.content[0].textContent.substring(0, 50);
                        }
                    }

                    console.log(`Importing session ${artemisSession.id}: ${messageCount} messages, preview: "${preview}"`);

                    // Create local session with Artemis session ID and messages
                    this._contextStore.createSessionWithDetails(
                        preview,
                        messageCount,
                        createdAt,
                        artemisSession.id,
                        artemisSession.messages || []
                    );
                }

                console.log(`Imported ${artemisSessionsListFromServer.length} sessions for ${activeContext.type} ${activeContext.id}`);
            }

            // Get the latest snapshot after importing sessions
            const updatedSnapshot = this._contextStore.snapshot();

            // If there are sessions, switch to the first one and load its messages
            if (updatedSnapshot.sessions.length > 0) {
                if (!this._isCurrentContext(targetContext, loadToken)) {
                    console.log('Context changed before switching to first session, aborting load');
                    return;
                }

                // Switch to the first (most recent) session
                this._contextStore.switchToFirstSession();

                // Load messages for the first session
                if (!this._isCurrentContext(targetContext, loadToken)) {
                    console.log('Context changed before loading messages, aborting load');
                    return;
                }

                await this._loadIrisMessages();
            } else {
                // No sessions exist, create a new one
                console.log('No sessions found, creating a new one');
                if (!this._isCurrentContext(targetContext, loadToken)) {
                    console.log('Context changed before creating new session, aborting load');
                    return;
                }
                this._contextStore.createSession();
                this.createNewSession();
            }

            // Post updated snapshot to show sessions in UI
            if (!this._isCurrentContext(targetContext, loadToken)) {
                console.log('Context changed before posting snapshot, aborting load');
                return;
            }

            this._postSnapshot();

        } catch (error: any) {
            console.error('Error loading sessions for context:', error);
            vscode.window.showWarningMessage(`Could not load sessions: ${error.message}`);

            if (!this._isCurrentContext(targetContext, loadToken)) {
                console.log('Context changed during error handling, skipping fallback session creation');
                return;
            }

            // Fall back to creating a new session
            this._contextStore.createSession();
            this.createNewSession();
            this._postSnapshot();
        }
    }

    private _handleSwitchContext(): void {
        this._contextStore.unlockActiveContext();
        this._postSnapshot({ showContextPicker: true });
    }

    private _handleSwitchToWorkspaceContext(): void {
        // Find the workspace exercise from all exercises (not just recent)
        const snapshot = this._contextStore.snapshot();
        
        console.log('[IRISDEBUG] _handleSwitchToWorkspaceContext called');
        console.log('[IRISDEBUG] recentExercises:', snapshot.recentExercises.map(e => ({ id: e.id, title: e.title, isWorkspace: e.isWorkspace })));
        console.log('[IRISDEBUG] allExercises with isWorkspace:', snapshot.allExercises.filter(e => e.isWorkspace).map(e => ({ id: e.id, title: e.title })));
        
        // Search in both recent and all exercises
        const workspaceExercise = snapshot.recentExercises.find(exercise =>
            exercise.isWorkspace || /\(Workspace\)/i.test(exercise.title)
        ) || snapshot.allExercises.find(exercise =>
            exercise.isWorkspace || /\(Workspace\)/i.test(exercise.title)
        );

        console.log('[IRISDEBUG] Found workspaceExercise:', workspaceExercise);

        if (!workspaceExercise) {
            vscode.window.showWarningMessage('No workspace exercise detected. Open a workspace folder with a git repository.');
            return;
        }

        // Switch to the workspace exercise context
        this.setExerciseContext(
            workspaceExercise.id,
            workspaceExercise.title,
            'workspace-detected',
            workspaceExercise.shortName,
            workspaceExercise.releaseDate,
            workspaceExercise.dueDate
        );
    }

    private _handleCourseSelection(courseId: number): void {
        const latest = this._contextStore.registerCourse({
            id: courseId,
            title: `Course ${courseId}`,
        });
        const course = latest.recentCourses.find(course => course.id === courseId) ?? latest.allCourses.find(c => c.id === courseId);
        this._contextStore.setActiveContext({
            type: 'course',
            id: courseId,
            title: course?.title ?? `Course ${courseId}`,
            shortName: course?.shortName,
            source: 'user-selected',
            locked: false,
            selectedAt: Date.now(),
        });

        // Reset Iris session when context changes
        if (this._irisSessionManager) {
            this._irisSessionManager.unsubscribe();
        }

        // Clear chat messages
        if (this._view) {
            this._view.webview.postMessage({ command: 'clearChatMessages' });
        }

        // Don't post snapshot yet - wait for sessions to load first

        // Load all sessions for the new context
        // The snapshot will be posted after sessions are loaded
        this._loadAllSessionsForContext().catch((err: any) => {
            console.error('Error loading Iris sessions:', err);
        });
    }

    private _handleExerciseSelection(exerciseId: number): void {
        const latest = this._contextStore.registerExercise({
            id: exerciseId,
            title: `Exercise ${exerciseId}`,
        });
        const exercise =
            latest.recentExercises.find(ex => ex.id === exerciseId) ?? latest.allExercises.find(ex => ex.id === exerciseId);
        this._contextStore.setActiveContext({
            type: 'exercise',
            id: exerciseId,
            title: exercise?.title ?? `Exercise ${exerciseId}`,
            shortName: exercise?.shortName,
            source: 'user-selected',
            locked: false,
            selectedAt: Date.now(),
        });

        // Reset Iris session when context changes
        if (this._irisSessionManager) {
            this._irisSessionManager.unsubscribe();
        }

        // Clear chat messages
        if (this._view) {
            this._view.webview.postMessage({ command: 'clearChatMessages' });
        }

        // Don't post snapshot yet - wait for sessions to load first

        vscode.window.showInformationMessage(`Exercise context set to: ${exercise?.title ?? `Exercise ${exerciseId}`}`);

        // Load all sessions for the new context
        // The snapshot will be posted after sessions are loaded
        this._loadAllSessionsForContext().catch((err: any) => {
            console.error('Error loading Iris sessions:', err);
        });
    }

    private async _handleOpenDiagnostics(): Promise<void> {
        const snapshot = this._contextStore.snapshot();
        let report = '='.repeat(80) + '\n';
        report += '🐛 IRIS CHAT DIAGNOSTICS\n';
        report += 'Generated at: ' + new Date().toISOString() + '\n';
        report += '='.repeat(80) + '\n\n';

        report += '📌 ACTIVE CONTEXT:\n';
        if (snapshot.activeContext) {
            report += `  Type: ${snapshot.activeContext.type}\n`;
            report += `  ID: ${snapshot.activeContext.id}\n`;
            report += `  Title: ${snapshot.activeContext.title}\n`;
            report += `  Short Name: ${snapshot.activeContext.shortName ?? '—'}\n`;
            report += `  Source: ${snapshot.activeContext.source}\n`;
            report += `  Locked: ${snapshot.activeContext.locked}\n`;
            report += `  Selected At: ${new Date(snapshot.activeContext.selectedAt).toISOString()}\n`;
        } else {
            report += '  No context selected\n';
        }

        report += '\n💬 ACTIVE SESSION:\n';
        if (snapshot.activeSession) {
            report += `  ID: ${snapshot.activeSession.id}\n`;
            report += `  Preview: ${snapshot.activeSession.preview}\n`;
            report += `  Messages: ${snapshot.activeSession.messageCount}\n`;
            report += `  Created: ${new Date(snapshot.activeSession.createdAt).toISOString()}\n`;
            report += `  Last Activity: ${new Date(snapshot.activeSession.lastActivity).toISOString()}\n`;
        } else {
            report += '  No session available\n';
        }

        report += `\n🗂️  SESSIONS (${snapshot.sessions.length} total):\n`;
        if (snapshot.sessions.length > 0) {
            snapshot.sessions.forEach((session, idx) => {
                report += `  ${idx + 1}. ${session.id}\n`;
                report += `     Preview: ${session.preview}\n`;
                report += `     Messages: ${session.messageCount}\n`;
                report += `     Created: ${new Date(session.createdAt).toISOString()}\n`;
                report += `     Last Activity: ${new Date(session.lastActivity).toISOString()}\n`;
            });
        } else {
            report += '  No sessions recorded\n';
        }

        report += `\n💻 RECENT EXERCISES (${snapshot.recentExercises.length}):\n`;
        if (snapshot.recentExercises.length > 0) {
            snapshot.recentExercises.forEach((exercise, idx) => {
                report += `  ${idx + 1}. [${exercise.id}] ${exercise.title}${exercise.isWorkspace ? ' ⭐' : ''}\n`;
                report += `     Short Name: ${exercise.shortName ?? '—'}\n`;
                report += `     Priority: ${exercise.priority}\n`;
                if (exercise.releaseDate) {
                    report += `     Release: ${exercise.releaseDate}\n`;
                }
                if (exercise.dueDate) {
                    report += `     Due: ${exercise.dueDate}\n`;
                }
                if (exercise.lastViewed) {
                    report += `     Last Viewed: ${new Date(exercise.lastViewed).toISOString()}\n`;
                }
            });
        } else {
            report += '  No recent exercises tracked\n';
        }

        report += `\n📚 RECENT COURSES (${snapshot.recentCourses.length}):\n`;
        if (snapshot.recentCourses.length > 0) {
            snapshot.recentCourses.forEach((course, idx) => {
                report += `  ${idx + 1}. [${course.id}] ${course.title}\n`;
                report += `     Short Name: ${course.shortName ?? '—'}\n`;
                report += `     Priority: ${course.priority}\n`;
                if (course.lastViewed) {
                    report += `     Last Viewed: ${new Date(course.lastViewed).toISOString()}\n`;
                }
            });
        } else {
            report += '  No recent courses tracked\n';
        }

        const registry = ExerciseRegistry.getInstance();
        const registeredExercises = registry.getAllExercises();
        report += `\n📘 EXERCISE REGISTRY (${registeredExercises.length} total):\n`;
        if (registeredExercises.length > 0) {
            registeredExercises.forEach((exercise, idx) => {
                report += `  ${idx + 1}. [${exercise.id}] ${exercise.title}\n`;
                report += `     Repository: ${exercise.repositoryUri}\n`;
            });
        } else {
            report += '  Registry is empty\n';
        }

        const document = await vscode.workspace.openTextDocument({
            content: report,
            language: 'plaintext',
        });
        await vscode.window.showTextDocument(document, {
            preview: false,
            viewColumn: vscode.ViewColumn.Active,
        });
    }

    private async _handleDebugSessions(): Promise<void> {
        const activeContext = this._contextStore.getActiveContext();
        if (!activeContext) {
            vscode.window.showWarningMessage('No context selected. Please select an exercise or course first.');
            return;
        }

        if (!this._artemisApiService) {
            vscode.window.showErrorMessage('Artemis API service not available');
            return;
        }

        try {
            let report = '='.repeat(80) + '\n';
            report += '🔍 RAW ARTEMIS SESSION DEBUG DATA\n';
            report += 'Generated at: ' + new Date().toISOString() + '\n';
            report += '='.repeat(80) + '\n\n';

            report += '📌 CURRENT CONTEXT:\n';
            report += `  Type: ${activeContext.type}\n`;
            report += `  ID: ${activeContext.id}\n`;
            report += `  Title: ${activeContext.title}\n`;
            report += `  Short Name: ${activeContext.shortName ?? '—'}\n\n`;

            report += '🌐 FETCHING SESSIONS FROM ARTEMIS...\n\n';

            // Fetch session metadata first
            let artemisSessionsMetadata: any[] = [];
            if (activeContext.type === 'course') {
                artemisSessionsMetadata = await this._artemisApiService.getCourseChatSessions(activeContext.id);
            } else if (activeContext.type === 'exercise') {
                artemisSessionsMetadata = await this._artemisApiService.getExerciseChatSessions(activeContext.id);
            } else {
                report += `❌ Unsupported context type: ${activeContext.type}\n`;
            }

            // Fetch messages for all sessions
            const artemisSessionsListFromServer: any[] = await Promise.all(
                artemisSessionsMetadata.map(async (session) => {
                    try {
                        const messages = await this._artemisApiService!.getChatMessages(session.id);
                        return {
                            ...session,
                            messages: messages
                        };
                    } catch (error) {
                        console.warn(`Failed to fetch messages for session ${session.id}:`, error);
                        return {
                            ...session,
                            messages: []
                        };
                    }
                })
            );

            report += `📊 TOTAL SESSIONS FOUND: ${artemisSessionsListFromServer.length}\n`;
            report += `   (All sessions are for ${activeContext.type} ${activeContext.id}: ${activeContext.title})\n`;
            report += '='.repeat(80) + '\n\n';

            // Also check local storage
            const snapshot = this._contextStore.snapshot();
            const contextKey = `${activeContext.type}:${activeContext.id}`;
            const localSessions = snapshot.sessions.filter(s => s.contextKey === contextKey);

            report += `💾 LOCAL STORAGE INFO:\n`;
            report += `   Context Key: ${contextKey}\n`;
            report += `   Local Sessions for this context: ${localSessions.length}\n`;
            report += `   All Local Sessions (all contexts): ${snapshot.sessions.length}\n`;
            if (snapshot.sessions.length > localSessions.length) {
                const otherContexts = new Set(snapshot.sessions.map(s => s.contextKey).filter(k => k !== contextKey));
                report += `   ⚠️  WARNING: Found sessions from other contexts: ${Array.from(otherContexts).join(', ')}\n`;
            }
            report += '\n';

            // Show what snapshot.sessions contains (this is what the UI displays)
            report += `📋 SNAPSHOT SESSIONS (what UI shows):\n`;
            report += `   Total in snapshot: ${snapshot.sessions.length}\n`;
            if (snapshot.sessions.length > 0) {
                snapshot.sessions.forEach((s, idx) => {
                    report += `   ${idx + 1}. Session ${s.id} (artemisId: ${s.artemisSessionId}) - contextKey: ${s.contextKey}\n`;
                    report += `      Preview: "${s.preview}"\n`;
                    report += `      Messages: ${s.messageCount}\n`;
                });
            }
            report += '\n' + '='.repeat(80) + '\n\n';

            if (artemisSessionsListFromServer.length === 0) {
                report += '⚠️  No sessions found on Artemis for this context.\n';
            } else {
                artemisSessionsListFromServer.forEach((session, idx) => {
                    report += `SESSION ${idx + 1}:\n`;
                    report += '-'.repeat(80) + '\n';
                    report += JSON.stringify(session, null, 2);
                    report += '\n\n';
                });
            }

            report += '='.repeat(80) + '\n';
            report += 'END OF DEBUG DATA\n';
            report += '='.repeat(80) + '\n';

            const document = await vscode.workspace.openTextDocument({
                content: report,
                language: 'json',
            });
            await vscode.window.showTextDocument(document, {
                preview: false,
                viewColumn: vscode.ViewColumn.Active,
            });

            vscode.window.showInformationMessage(`Found ${artemisSessionsListFromServer.length} session(s) on Artemis`);
        } catch (error: any) {
            console.error('Error fetching debug session data:', error);
            vscode.window.showErrorMessage(`Failed to fetch sessions from Artemis: ${error.message}`);
        }
    }

    private async _handleChatMessage(message: any): Promise<void> {
        console.log('[WebsocketLog] 📤 _handleChatMessage called with:', { text: message?.text?.substring(0, 50) });

        if (!message?.text) {
            console.log('[WebsocketLog] ⚠️ No text in message, returning');
            return;
        }

        const activeContext = this._contextStore.getActiveContext();
        if (!activeContext) {
            console.log('[WebsocketLog] ⚠️ No active context');
            vscode.window.showErrorMessage('Please select a course or exercise context first');
            return;
        }
        console.log('[WebsocketLog] ✅ Active context:', { type: activeContext.type, id: activeContext.id, title: activeContext.title });

        if (!this._artemisApiService) {
            vscode.window.showErrorMessage('Artemis API service not available');
            return;
        }

        // Check if Iris is enabled
        const isEnabled = await this._checkAndLoadIrisSettings(activeContext);
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

        try {
            // Check WebSocket connection before sending
            console.log('[WebsocketLog] 🔍 Checking WebSocket connection before sending message...');
            if (this._websocketService && !this._websocketService.isConnected()) {
                console.log('[WebsocketLog] ⚠️ WebSocket not connected, attempting to connect...');
                try {
                    await this._websocketService.connect();
                    console.log('[WebsocketLog] ✅ WebSocket connected successfully');
                } catch (error) {
                    console.error('[WebsocketLog] ❌ Failed to connect WebSocket:', error);
                    vscode.window.showWarningMessage('WebSocket connection failed. You may not receive responses in real-time.');
                }
            } else if (this._websocketService) {
                console.log('[WebsocketLog] ✅ WebSocket already connected');
            } else {
                console.warn('[WebsocketLog] ⚠️ No WebSocket service available');
            }

            // Show user message immediately
            console.log('[WebsocketLog] 💬 Sending user message to webview');
            if (this._view) {
                this._view.webview.postMessage({
                    command: 'addMessage',
                    message: {
                        role: 'user',
                        content: message.text,
                        timestamp: Date.now()
                    }
                });
                console.log('[WebsocketLog] ✅ User message sent to webview (this should trigger thinking indicator)');
            } else {
                console.log('[WebsocketLog] ⚠️ No view available to send message');
            }

            // Get or create Iris session
            console.log('[WebsocketLog] 🔑 Checking for existing Iris session...', {
                hasSessionId: !!this._irisSessionManager?.currentSessionId,
                sessionId: this._irisSessionManager?.currentSessionId
            });

            if (!this._irisSessionManager?.currentSessionId) {
                console.log('[WebsocketLog] 🆕 No active session found, initializing new Iris session...');
                await this._initializeIrisSession(activeContext);
            } else {
                console.log('[WebsocketLog] ✅ Using existing Iris session:', this._irisSessionManager.currentSessionId);
            }

            if (!this._irisSessionManager?.currentSessionId) {
                throw new Error('Failed to initialize Iris session');
            }

            // Collect uncommitted files from the current workspace
            let uncommittedFiles: Map<string, string> | undefined;

            // Check if the user has enabled sending uncommitted changes
            const sendUncommittedChanges = vscode.workspace.getConfiguration('artemis.iris').get<boolean>('sendUncommittedChanges', true);

            if (sendUncommittedChanges) {
                try {
                    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];

                    // Use unified checker with full options (content + filters + status)
                    const result = await checkWorkspaceFiles(workspaceFolder, {
                        includeContent: true,
                        applyFilters: true,
                        includeStatus: true,
                        checkUnpushed: true,
                        includeDirty: true
                    });

                    // Convert to Map for backward compatibility
                    uncommittedFiles = new Map();
                    result.files
                        .filter(f => f.status === 'included' && f.content !== undefined)
                        .forEach(f => uncommittedFiles!.set(f.path, f.content!));

                    if (uncommittedFiles.size > 0) {
                        console.log(`📁 Sending ${uncommittedFiles.size} uncommitted file(s) to Iris`);

                        // Update display with detailed analysis
                        if (this._view) {
                            const excludedFiles = result.files
                                .filter(f => f.status === 'excluded')
                                .map(f => ({ path: f.path, reason: f.reason || 'Excluded' }));

                            this._view.webview.postMessage({
                                command: 'updateReferencedFiles',
                                includedFiles: Array.from(uncommittedFiles.keys()),
                                excludedFiles: excludedFiles,
                                totalCount: result.totalCount
                            });
                        }
                    }
                } catch (error: any) {
                    console.error('Error collecting uncommitted files:', error);

                    // Show user-friendly error message based on error type
                    if (error.message?.includes('Git')) {
                        vscode.window.showWarningMessage(
                            'Failed to collect uncommitted files from Git. Iris will only see your repository content.',
                            'OK'
                        );
                    } else if (error.code === 'ENOENT') {
                        vscode.window.showWarningMessage(
                            'Some files could not be read. Iris might not have full context of your changes.',
                            'OK'
                        );
                    } else {
                        vscode.window.showWarningMessage(
                            'Could not collect uncommitted changes. Iris will work with repository content only.',
                            'Disable Feature',
                            'OK'
                        ).then(selection => {
                            if (selection === 'Disable Feature') {
                                vscode.workspace.getConfiguration('artemis.iris').update('sendUncommittedChanges', false, true);
                            }
                        });
                    }

                    // Continue without uncommitted files - this is not a critical error
                    uncommittedFiles = undefined;
                }
            } else {
                console.log('📁 Uncommitted changes sending is disabled by user setting');
            }

            // Send message to Iris
            // The response will come through WebSocket, so we don't need to wait for it here
            console.log('[WebsocketLog] 🚀 Sending message to Artemis API...', {
                sessionId: this._irisSessionManager.currentSessionId,
                messageLength: message.text.length,
                hasUncommittedFiles: uncommittedFiles ? uncommittedFiles.size : 0
            });
            await this._artemisApiService.sendChatMessage(
                this._irisSessionManager.currentSessionId,
                message.text,
                uncommittedFiles
            );

            console.log('[WebsocketLog] ✅ Message sent to Iris, waiting for WebSocket response...');

            // Note: The assistant's response will arrive via WebSocket
            // and will be handled by _handleIrisWebSocketMessage()

            this._contextStore.incrementActiveSessionMessageCount();
            this._postSnapshot();

        } catch (error: any) {
            console.error('Error sending chat message:', error);
            vscode.window.showErrorMessage(`Failed to send message: ${error.message}`);

            if (this._view) {
                this._view.webview.postMessage({
                    command: 'addMessage',
                    message: {
                        role: 'error',
                        content: `Error: ${error.message}`,
                        timestamp: Date.now()
                    }
                });
            }
        }
    }

    private async _handleMessageFeedback(message: any): Promise<void> {
        const sessionId: number | undefined = message.sessionId;
        const messageId: number | undefined = message.messageId;
        const feedback: string | undefined = message.feedback;

        console.log('Message feedback received:', { sessionId, messageId, feedback });

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
            console.log(`Feedback submitted: ${feedback} for message ${messageId} in session ${sessionId}`);

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
            console.log(`Initializing Iris session for ${context.type}: ${context.title} (ID: ${context.id})`);

            // Check if we have a stored Artemis session ID for this local session
            const snapshot = this._contextStore.snapshot();
            const activeLocalSession = snapshot.activeSession;

            console.log('Active local session:', {
                id: activeLocalSession?.id,
                messageCount: activeLocalSession?.messageCount,
                artemisSessionId: activeLocalSession?.artemisSessionId,
                createdAt: activeLocalSession?.createdAt ? new Date(activeLocalSession.createdAt).toISOString() : 'unknown'
            });

            const sessionId = await this._irisSessionManager.initializeSession(context, activeLocalSession?.artemisSessionId);

            // If we didn't have a stored session ID, store it now
            if (!activeLocalSession?.artemisSessionId) {
                console.log('Storing NEW Artemis session ID mapping:', sessionId);
                this._storeArtemisSessionId(sessionId);
            }

            console.log('[WebsocketLog] 🎯 Iris session initialized with ID:', sessionId);

            // Load existing messages if any
            console.log('Fetching messages for session:', sessionId);
            const messages = await this._artemisApiService.getChatMessages(sessionId);
            console.log(`Received ${messages?.length || 0} messages from Iris`);

            // If we expected messages but got none, the stored session might be stale
            if (activeLocalSession?.messageCount && activeLocalSession.messageCount > 0 &&
                (!messages || messages.length === 0)) {
                console.log('Warning: Expected', activeLocalSession.messageCount, 'messages but got none. Stored session might be stale.');
                console.log('Clearing stale Artemis session ID mapping...');

                // Clear the stale mapping
                this._storeArtemisSessionId(undefined as any);

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
                console.log('Sending messages to webview:', messages);

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
                        console.log('Messages sent to webview');
                    }
                }, 100);
            } else {
                console.log('No messages to load or view not ready');
            }

            vscode.window.showInformationMessage(`Connected to Iris for ${context.title}`);
        } catch (error: any) {
            console.error('Error initializing Iris session:', error);
            throw new Error(`Failed to connect to Iris: ${error.message}`);
        }
    }

    public clearAllSessions(): void {
        console.log('Clearing all local Iris sessions...');

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

        console.log('All Iris sessions cleared');
    }

    private async _handleReconnectWebSocket(): Promise<void> {
        if (!this._websocketService) {
            vscode.window.showErrorMessage('WebSocket service not available');
            return;
        }

        try {
            const isConnected = this._websocketService.isConnected();
            if (isConnected) {
                vscode.window.showInformationMessage('WebSocket is already connected');
                this._updateWebSocketStatus(true);
                return;
            }

            vscode.window.showInformationMessage('Reconnecting to WebSocket...');
            await this._websocketService.connect();

            // If we have an active Iris session, resubscribe to it
            if (this._irisSessionManager?.currentSessionId && this._websocketService.isConnected()) {
                console.log('Resubscribing to Iris session after reconnect:', this._irisSessionManager.currentSessionId);
                this._irisSessionManager.subscribeToSession(this._irisSessionManager.currentSessionId);
            }

            this._updateWebSocketStatus(true);
            vscode.window.showInformationMessage('Successfully reconnected to WebSocket');
        } catch (error: any) {
            console.error('Failed to reconnect WebSocket:', error);
            vscode.window.showErrorMessage(`Failed to reconnect: ${error.message}`);
            this._updateWebSocketStatus(false);
        }
    }

    private _updateWebSocketStatus(isConnected: boolean): void {
        if (this._view) {
            this._view.webview.postMessage({
                command: 'updateWebSocketStatus',
                isConnected: isConnected
            });
        }
    }

    private async _handleResetSessions(): Promise<void> {
        const confirmation = await vscode.window.showWarningMessage(
            'This will clear all local Iris chat session data and reload all sessions from Artemis. Continue?',
            { modal: true },
            'Yes, Reset & Reload'
        );

        if (confirmation === 'Yes, Reset & Reload') {
            this.clearAllSessions();

            // If there's an active context, reload all sessions from Artemis
            const activeContext = this._contextStore.getActiveContext();
            if (activeContext && this._artemisApiService) {
                try {
                    console.log('Fetching all Iris sessions from Artemis for context:', activeContext.title);

                    // Step 1: Fetch session metadata
                    let artemisSessionsMetadata: any[] = [];
                    if (activeContext.type === 'course') {
                        artemisSessionsMetadata = await this._artemisApiService.getCourseChatSessions(activeContext.id);
                    } else if (activeContext.type === 'exercise') {
                        artemisSessionsMetadata = await this._artemisApiService.getExerciseChatSessions(activeContext.id);
                    }

                    console.log(`Fetched ${artemisSessionsMetadata.length} session(s) metadata from Artemis`);

                    // Step 2: Fetch messages for all sessions
                    const artemisSessionsListFromServer: any[] = await Promise.all(
                        artemisSessionsMetadata.map(async (session) => {
                            try {
                                const messages = await this._artemisApiService!.getChatMessages(session.id);
                                return {
                                    ...session,
                                    messages: messages
                                };
                            } catch (error) {
                                console.warn(`Failed to fetch messages for session ${session.id}:`, error);
                                return {
                                    ...session,
                                    messages: []
                                };
                            }
                        })
                    );

                    console.log(`Fetched messages for all ${artemisSessionsListFromServer.length} sessions`);

                    // Import all sessions from Artemis
                    if (artemisSessionsListFromServer.length > 0) {
                        // Sort sessions by creation date (newest first)
                        artemisSessionsListFromServer.sort((a, b) => {
                            const dateA = a.creationDate ? new Date(a.creationDate).getTime() : 0;
                            const dateB = b.creationDate ? new Date(b.creationDate).getTime() : 0;
                            return dateB - dateA;
                        });

                        for (const artemisSession of artemisSessionsListFromServer) {
                            // Create local session for each Artemis session
                            const messageCount = artemisSession.messages?.length || 0;
                            const createdAt = artemisSession.creationDate ? new Date(artemisSession.creationDate).getTime() : Date.now();

                            // Create preview from first user message or use default
                            let preview = 'New conversation';
                            if (artemisSession.messages && artemisSession.messages.length > 0) {
                                const firstUserMsg = artemisSession.messages.find((m: any) => m.sender === 'USER');
                                if (firstUserMsg?.content?.[0]?.textContent) {
                                    preview = firstUserMsg.content[0].textContent.substring(0, 50);
                                }
                            }

                            console.log(`Importing session ${artemisSession.id}: ${messageCount} messages, preview: "${preview}"`);

                            // Create local session with messages
                            this._contextStore.createSessionWithDetails(
                                preview,
                                messageCount,
                                createdAt,
                                artemisSession.id,
                                artemisSession.messages || []
                            );
                        }

                        // Switch to the first (most recent) session
                        this._contextStore.switchToFirstSession();

                        // Post updated snapshot to show sessions in UI
                        this._postSnapshot();

                        // Get the first session's messages from the data we already have
                        const firstSession = artemisSessionsListFromServer[0];
                        if (firstSession.messages && firstSession.messages.length > 0) {
                            const formattedMessages = firstSession.messages.map((msg: any) => {
                                let content = '';
                                if (msg.content && Array.isArray(msg.content) && msg.content.length > 0) {
                                    content = msg.content.map((item: any) => {
                                        if (item.textContent) {
                                            return item.textContent;
                                        }
                                        return item.toString();
                                    }).join('\n');
                                } else if (typeof msg.content === 'string') {
                                    content = msg.content;
                                }

                                return {
                                    id: msg.id,
                                    role: msg.sender === 'USER' ? 'user' : 'assistant',
                                    content: content,
                                    timestamp: msg.sentAt ? new Date(msg.sentAt).getTime() : Date.now(),
                                    helpful: msg.helpful // true, false, or null
                                };
                            });

                            // Send messages to webview
                            if (this._view) {
                                this._view.webview.postMessage({
                                    command: 'loadMessages',
                                    messages: formattedMessages
                                });
                            }

                            // Store the Artemis session ID and subscribe to WebSocket
                            if (this._irisSessionManager) {
                                this._irisSessionManager.subscribeToSession(firstSession.id);
                            }
                        }

                        vscode.window.showInformationMessage(
                            `✅ Loaded ${artemisSessionsListFromServer.length} session(s) from Artemis`
                        );
                    } else {
                        vscode.window.showInformationMessage('✅ No existing sessions found on Artemis');
                    }
                } catch (error: any) {
                    console.error('Failed to reload sessions from Artemis:', error);
                    vscode.window.showWarningMessage('Sessions cleared, but failed to reload from Artemis: ' + error.message);
                }
            } else {
                vscode.window.showInformationMessage('✅ Iris chat sessions have been reset');
            }
        }
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
        console.log('Creating new session');

        if (this._irisSessionManager) {
            this._irisSessionManager.unsubscribe();
        }

        this._contextStore.createSession();
        this._postSnapshot();

        if (this._view) {
            this._view.webview.postMessage({ command: 'clearChatMessages' });
        }

        // Create a brand new Iris session on the backend
        const activeContext = this._contextStore.getActiveContext();
        if (activeContext && this._irisSessionManager) {
            this._irisSessionManager.createNewSession(activeContext)
                .then(sessionId => {
                    this._storeArtemisSessionId(sessionId);
                    vscode.window.showInformationMessage('New conversation started!');
                })
                .catch(err => {
                    console.error('Error creating new Iris session:', err);
                    vscode.window.showErrorMessage(`Failed to create new conversation: ${err.message}`);
                });
        }
    }

    // private async _createNewIrisSession(): Promise<void> { ... } // Removed

    private _storeArtemisSessionId(artemisSessionId: number): void {
        // Store the Artemis session ID in the active local session
        this._contextStore.setArtemisSessionId(artemisSessionId);
        this._postSnapshot();
    }

    public switchToSession(sessionId: string): void {
        console.log('Switching to session:', sessionId);

        if (this._irisSessionManager) {
            this._irisSessionManager.unsubscribe();
        }

        this._contextStore.switchSession(sessionId);
        this._postSnapshot();

        if (this._view) {
            this._view.webview.postMessage({ command: 'clearChatMessages' });
        }

        // Load messages for the switched session
        this._loadIrisMessages().catch(err => {
            console.error('Error loading messages for switched session:', err);
        });
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
        void this._loadAllSessionsForContext();
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
        void this._loadAllSessionsForContext();
    }

    public clearContext(): void {
        this._contextStore.clearActiveContext();
        this._postSnapshot();
    }
}
