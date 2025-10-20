import * as vscode from 'vscode';
import { IrisChatView } from '../templates/irisChatView';
import { StyleManager } from '../styles';
import { ExerciseRegistry } from './exerciseRegistry';
import { ContextStore } from './contextStore';
import {
    ActiveContext,
    StoredSession,
    ChatContextType,
    ContextSnapshot,
} from './contextTypes';
import { ArtemisApiService } from '../../api';
import { ArtemisWebsocketService } from '../../services';

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
    private readonly _styleManager: StyleManager;
    private readonly _contextStore: ContextStore;
    private readonly _disposables: vscode.Disposable[] = [];
    private _currentArtemisSessionId?: number;
    private _irisUnsubscribe?: () => void;

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly _extensionContext: vscode.ExtensionContext,
        private readonly _artemisApiService?: ArtemisApiService,
        private readonly _websocketService?: ArtemisWebsocketService,
    ) {
        this._styleManager = new StyleManager(this._extensionUri);
        this._contextStore = new ContextStore(this._extensionContext);
    }

    public dispose(): void {
        // Unsubscribe from Iris WebSocket
        if (this._irisUnsubscribe) {
            this._irisUnsubscribe();
            this._irisUnsubscribe = undefined;
        }

        while (this._disposables.length > 0) {
            const disposable = this._disposables.pop();
            disposable?.dispose();
        }
    }

    private _handleIrisWebSocketMessage(data: any): void {
        console.log('🔔 Received Iris WebSocket message:', JSON.stringify(data, null, 2));

        if (!this._view) {
            console.log('⚠️ No view available to display message');
            return;
        }

        // Handle different message types
        if (data.type === 'MESSAGE' && data.message) {
            console.log('Processing MESSAGE type');
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

            console.log('Extracted content:', content);
            console.log('Message sender:', msg.sender);

            // Only show assistant messages (user messages were already shown)
            if (msg.sender !== 'USER' && content) {
                console.log('Sending assistant message to webview');
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
            } else {
                console.log('Skipping message (either USER message or no content)');
            }
        } else if (data.type === 'STATUS') {
            // Handle status updates (e.g., "Iris is thinking...")
            console.log('📊 Iris status update:', data);
            // TODO: Show status indicator in UI
        } else {
            console.log('⚠️ Unknown message type or format:', data);
        }
    }

    private _getOrCreateIrisChatView(): IrisChatView {
        if (!this._irisChatView) {
            this._irisChatView = new IrisChatView(this._extensionContext, this._styleManager);
        }
        return this._irisChatView;
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
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
                this._postSnapshot();
                void this._detectWorkspaceExercise();
                // Load Iris messages if context is already selected
                void this._loadIrisMessagesIfNeeded();
            }
        });
        this._disposables.push(visibilityListener);

        const workspaceListener = vscode.workspace.onDidChangeWorkspaceFolders(() => {
            void this._detectWorkspaceExercise();
        });
        this._disposables.push(workspaceListener);

        const configListener = vscode.workspace.onDidChangeConfiguration(event => {
            if (
                event.affectsConfiguration('artemis.hideDeveloperTools') ||
                event.affectsConfiguration('artemis.theme')
            ) {
                this.refreshTheme();
            }
        });
        this._disposables.push(configListener);

        this._postSnapshot();
        void this._detectWorkspaceExercise();
        // Load Iris messages if context is already selected
        void this._loadIrisMessagesIfNeeded();

        // Start monitoring WebSocket status
        this._startWebSocketMonitoring();
    }

    private _startWebSocketMonitoring(): void {
        if (!this._websocketService) {
            return;
        }

        // Register for connection state changes
        this._websocketService.onConnectionStateChange((isConnected: boolean) => {
            console.log('WebSocket connection state changed:', isConnected);
            this._updateWebSocketStatus(isConnected);

            // If reconnected and we have an active session, resubscribe
            if (isConnected && this._currentArtemisSessionId) {
                console.log('WebSocket reconnected, resubscribing to session:', this._currentArtemisSessionId);

                // Unsubscribe from old subscription if any
                if (this._irisUnsubscribe) {
                    this._irisUnsubscribe();
                }

                // Subscribe to the current session
                try {
                    this._irisUnsubscribe = this._websocketService!.subscribeToIrisSession(
                        this._currentArtemisSessionId,
                        (data: any) => this._handleIrisWebSocketMessage(data)
                    );
                    console.log('Successfully resubscribed to Iris session');
                } catch (error) {
                    console.error('Failed to resubscribe to Iris session:', error);
                }
            }
        });
    }

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

    private async _detectWorkspaceExercise(): Promise<void> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            return;
        }

        try {
            const { exec } = require('child_process');
            const { promisify } = require('util');
            const execAsync = promisify(exec);

            const { stdout } = await execAsync('git remote get-url origin', {
                cwd: workspaceFolder.uri.fsPath,
            });

            const repoUrl = stdout.trim();
            if (!repoUrl) {
                return;
            }

            const registry = ExerciseRegistry.getInstance();
            const matchedExercise = registry.findByRepositoryUrl(repoUrl);
            if (!matchedExercise) {
                return;
            }

            const baseTitle = matchedExercise.title.replace(/ \\(Workspace\\)$/i, '');
            const displayTitle = `${baseTitle} (Workspace)`;

            this._contextStore.registerExercise({
                id: matchedExercise.id,
                title: displayTitle,
                shortName: matchedExercise.shortName,
                repositoryUri: matchedExercise.repositoryUri,
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
            case 'clearHistory':
                this._handleClearHistory();
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
        this._currentArtemisSessionId = undefined;

        // Clear chat messages
        if (this._view) {
            this._view.webview.postMessage({ command: 'clearChatMessages' });
        }

        this._postSnapshot();

        const label = contextType === 'exercise' ? 'Exercise' : contextType === 'course' ? 'Course' : 'Context';
        vscode.window.showInformationMessage(`${label} context set to: ${itemName}`);

        // Load all sessions for the new context and initialize
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
        const activeContext = this._contextStore.getActiveContext();

        // Only load if there's an active context and we haven't initialized yet
        if (activeContext && !this._currentArtemisSessionId) {
            console.log('Active context found on startup, loading Iris messages...');
            await this._loadAllSessionsForContext();
        }
    }

    private async _loadAllSessionsForContext(): Promise<void> {
        const activeContext = this._contextStore.getActiveContext();
        if (!activeContext || !this._artemisApiService || !this._view) {
            console.log('Cannot load sessions: missing context, API service, or view');
            return;
        }

        try {
            console.log(`Loading all Iris sessions for ${activeContext.type}: ${activeContext.title} (ID: ${activeContext.id})`);

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
            const contextKey = `${activeContext.type}:${activeContext.id}`;
            console.log(`Clearing all existing sessions for context ${contextKey} before loading fresh data from Artemis`);
            this._contextStore.clearSessionsForContext(contextKey);

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
                // Switch to the first (most recent) session
                this._contextStore.switchToFirstSession();

                // Load messages for the first session
                await this._loadIrisMessages();
            } else {
                // No sessions exist, create a new one
                console.log('No sessions found, creating a new one');
                this._contextStore.createSession();
                await this._createNewIrisSession();
            }

            // Post updated snapshot to show sessions in UI
            this._postSnapshot();

        } catch (error: any) {
            console.error('Error loading sessions for context:', error);
            vscode.window.showWarningMessage(`Could not load sessions: ${error.message}`);

            // Fall back to creating a new session
            this._contextStore.createSession();
            await this._createNewIrisSession();
            this._postSnapshot();
        }
    }

    private _handleSwitchContext(): void {
        this._contextStore.unlockActiveContext();
        this._postSnapshot({ showContextPicker: true });
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
        this._currentArtemisSessionId = undefined;

        // Clear chat messages
        if (this._view) {
            this._view.webview.postMessage({ command: 'clearChatMessages' });
        }

        this._postSnapshot();

        // Load all sessions for the new context
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
        this._currentArtemisSessionId = undefined;

        // Clear chat messages
        if (this._view) {
            this._view.webview.postMessage({ command: 'clearChatMessages' });
        }

        this._postSnapshot();

        vscode.window.showInformationMessage(`Exercise context set to: ${exercise?.title ?? `Exercise ${exerciseId}`}`);

        // Load all sessions for the new context
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
        if (!message?.text) {
            return;
        }

        const activeContext = this._contextStore.getActiveContext();
        if (!activeContext) {
            vscode.window.showErrorMessage('Please select a course or exercise context first');
            return;
        }

        if (!this._artemisApiService) {
            vscode.window.showErrorMessage('Artemis API service not available');
            return;
        }

        try {
            // Check WebSocket connection before sending
            if (this._websocketService && !this._websocketService.isConnected()) {
                console.log('WebSocket not connected, attempting to connect...');
                try {
                    await this._websocketService.connect();
                } catch (error) {
                    console.error('Failed to connect WebSocket:', error);
                    vscode.window.showWarningMessage('WebSocket connection failed. You may not receive responses in real-time.');
                }
            }

            // Show user message immediately
            if (this._view) {
                this._view.webview.postMessage({
                    command: 'addMessage',
                    message: {
                        role: 'user',
                        content: message.text,
                        timestamp: Date.now()
                    }
                });
            }

            // Get or create Iris session
            if (!this._currentArtemisSessionId) {
                await this._initializeIrisSession(activeContext);
            }

            if (!this._currentArtemisSessionId) {
                throw new Error('Failed to initialize Iris session');
            }

            // Send message to Iris
            // The response will come through WebSocket, so we don't need to wait for it here
            await this._artemisApiService.sendChatMessage(
                this._currentArtemisSessionId,
                message.text
            );

            console.log('Message sent to Iris, waiting for WebSocket response...');

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
        if (!this._artemisApiService) {
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

            let session;
            if (activeLocalSession?.artemisSessionId) {
                // We have a stored Artemis session ID, use it directly
                console.log('Using stored Artemis session ID:', activeLocalSession.artemisSessionId);
                session = { id: activeLocalSession.artemisSessionId };
            } else {
                // No stored session, get or create the current one
                console.log('No stored session, fetching current session from Artemis');
                if (context.type === 'course') {
                    session = await this._artemisApiService.getCurrentCourseChat(context.id);
                } else if (context.type === 'exercise') {
                    session = await this._artemisApiService.getCurrentExerciseChat(context.id);
                } else {
                    throw new Error(`Unsupported context type: ${context.type}`);
                }

                // Store the Artemis session ID for future use (only for new mappings)
                console.log('Storing NEW Artemis session ID mapping:', session.id);
                this._storeArtemisSessionId(session.id);
            }

            console.log(`Iris session initialized with ID: ${session.id}`);
            this._currentArtemisSessionId = session.id;

            // Unsubscribe from previous session if any
            if (this._irisUnsubscribe) {
                console.log('Unsubscribing from previous Iris session');
                this._irisUnsubscribe();
                this._irisUnsubscribe = undefined;
            }

            // Subscribe to WebSocket messages for this session
            if (this._websocketService) {
                const isConnected = this._websocketService.isConnected();
                console.log('WebSocket service status:', { isConnected });

                if (isConnected) {
                    console.log('Subscribing to Iris WebSocket for session:', session.id);
                    try {
                        this._irisUnsubscribe = this._websocketService.subscribeToIrisSession(
                            session.id,
                            (data: any) => this._handleIrisWebSocketMessage(data)
                        );
                        console.log('Successfully subscribed to Iris WebSocket');
                    } catch (error) {
                        console.error('Failed to subscribe to Iris WebSocket:', error);
                        vscode.window.showErrorMessage('Failed to connect to Iris WebSocket. Messages may not appear in real-time.');
                    }
                } else {
                    console.log('WebSocket not connected, attempting to connect...');
                    // Try to connect the WebSocket
                    try {
                        await this._websocketService.connect();
                        console.log('WebSocket connected, now subscribing to Iris session:', session.id);
                        this._irisUnsubscribe = this._websocketService.subscribeToIrisSession(
                            session.id,
                            (data: any) => this._handleIrisWebSocketMessage(data)
                        );
                    } catch (error) {
                        console.error('Failed to connect WebSocket:', error);
                        vscode.window.showWarningMessage('WebSocket not connected. You may need to connect manually via "Artemis: Connect to WebSocket"');
                    }
                }
            } else {
                console.error('WebSocket service not provided to ChatWebviewProvider');
                vscode.window.showWarningMessage('WebSocket service not available. Real-time messages will not work.');
            }

            // Load existing messages if any
            if (session.id) {
                console.log('Fetching messages for session:', session.id);
                const messages = await this._artemisApiService.getChatMessages(session.id);
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
                        console.log('Message:', msg);

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
            }

            vscode.window.showInformationMessage(`Connected to Iris for ${context.title}`);
        } catch (error: any) {
            console.error('Error initializing Iris session:', error);
            throw new Error(`Failed to connect to Iris: ${error.message}`);
        }
    }

    private _handleClearHistory(): void {
        this._contextStore.clearAll();
        this._postSnapshot();
        if (this._view) {
            this._view.webview.postMessage({ command: 'clearChatMessages' });
        }
        vscode.window.showInformationMessage('Chat history cleared');
    }

    public clearAllSessions(): void {
        console.log('Clearing all local Iris sessions...');

        // Unsubscribe from current WebSocket
        if (this._irisUnsubscribe) {
            this._irisUnsubscribe();
            this._irisUnsubscribe = undefined;
        }

        // Clear current session ID
        this._currentArtemisSessionId = undefined;

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
            if (this._currentArtemisSessionId && this._websocketService.isConnected()) {
                console.log('Resubscribing to Iris session after reconnect:', this._currentArtemisSessionId);

                // Unsubscribe from old subscription if any
                if (this._irisUnsubscribe) {
                    this._irisUnsubscribe();
                }

                // Subscribe to the current session
                this._irisUnsubscribe = this._websocketService.subscribeToIrisSession(
                    this._currentArtemisSessionId,
                    (data: any) => this._handleIrisWebSocketMessage(data)
                );
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
            'Yes, Reset & Reload',
            'Cancel'
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
                            this._currentArtemisSessionId = firstSession.id;

                            if (this._websocketService && this._websocketService.isConnected()) {
                                console.log('Subscribing to WebSocket for session:', firstSession.id);
                                this._irisUnsubscribe = this._websocketService.subscribeToIrisSession(
                                    firstSession.id,
                                    (data: any) => this._handleIrisWebSocketMessage(data)
                                );
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

        // Unsubscribe from old WebSocket session
        if (this._irisUnsubscribe) {
            console.log('Unsubscribing from previous Iris session');
            this._irisUnsubscribe();
            this._irisUnsubscribe = undefined;
        }

        this._contextStore.createSession();
        this._currentArtemisSessionId = undefined;
        this._postSnapshot();

        if (this._view) {
            this._view.webview.postMessage({ command: 'clearChatMessages' });
        }

        // Create a brand new Iris session on the backend
        this._createNewIrisSession().catch(err => {
            console.error('Error creating new Iris session:', err);
        });
    }

    private async _createNewIrisSession(): Promise<void> {
        const activeContext = this._contextStore.getActiveContext();
        if (!activeContext || !this._artemisApiService || !this._view) {
            console.log('Cannot create new session: missing context, API service, or view');
            return;
        }

        try {
            console.log('Creating NEW Iris session for', activeContext.type, activeContext.id);

            // Create a brand new session instead of getting the current one
            let newSession;
            if (activeContext.type === 'course') {
                newSession = await this._artemisApiService.createCourseChatSession(activeContext.id);
            } else if (activeContext.type === 'exercise') {
                newSession = await this._artemisApiService.createExerciseChatSession(activeContext.id);
            } else {
                throw new Error(`Unsupported context type: ${activeContext.type}`);
            }

            console.log('New Iris session created with ID:', newSession.id);
            this._currentArtemisSessionId = newSession.id;

            // Store the Artemis session ID in the local session
            this._storeArtemisSessionId(newSession.id);

            // Subscribe to WebSocket for the new session
            if (this._websocketService && this._websocketService.isConnected()) {
                console.log('Subscribing to new Iris WebSocket session:', newSession.id);
                this._irisUnsubscribe = this._websocketService.subscribeToIrisSession(
                    newSession.id,
                    (data: any) => this._handleIrisWebSocketMessage(data)
                );
                console.log('Successfully subscribed to new Iris WebSocket session');
            }

            vscode.window.showInformationMessage('New conversation started!');
        } catch (error: any) {
            console.error('Failed to create new Iris session:', error);
            vscode.window.showErrorMessage(`Failed to create new conversation: ${error.message}`);
        }
    }

    private _storeArtemisSessionId(artemisSessionId: number): void {
        // Store the Artemis session ID in the active local session
        this._contextStore.setArtemisSessionId(artemisSessionId);
        this._postSnapshot();
    }

    public switchToSession(sessionId: string): void {
        console.log('Switching to session:', sessionId);

        // Unsubscribe from old WebSocket session
        if (this._irisUnsubscribe) {
            console.log('Unsubscribing from previous Iris session');
            this._irisUnsubscribe();
            this._irisUnsubscribe = undefined;
        }

        this._contextStore.switchSession(sessionId);
        this._currentArtemisSessionId = undefined;
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
        this._contextStore.setActiveContext({
            type: 'course',
            id: courseId,
            title: courseTitle,
            shortName,
            source: this._mapReasonToSource(reason),
            locked: reason === 'workspace-detected',
            selectedAt: Date.now(),
        });
        this._postSnapshot();
    }

    public setExerciseContext(
        exerciseId: number,
        exerciseTitle: string,
        reason: ChatContextReason = 'user-selected',
        shortName?: string,
    ): void {
        this._contextStore.registerExercise({
            id: exerciseId,
            title: exerciseTitle,
            shortName,
            source: this._mapReasonToSource(reason),
            isWorkspace: reason === 'workspace-detected' || reason === 'auto-workspace',
        });
        this._contextStore.setActiveContext({
            type: 'exercise',
            id: exerciseId,
            title: exerciseTitle,
            shortName,
            source: this._mapReasonToSource(reason),
            locked: reason === 'workspace-detected' || reason === 'auto-workspace',
            selectedAt: Date.now(),
        });
        this._postSnapshot();
    }

    public clearContext(): void {
        this._contextStore.clearActiveContext();
        this._postSnapshot();
    }
}
