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
                        role: 'assistant',
                        content: content,
                        timestamp: msg.sentAt ? new Date(msg.sentAt).getTime() : Date.now()
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
            case 'chatViewReady':
                this._postSnapshot();
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

        // Initialize Iris session and load messages
        this._loadIrisMessages().catch(err => {
            console.error('Error loading Iris messages:', err);
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
        this._postSnapshot();
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
        this._postSnapshot();

        vscode.window.showInformationMessage(`Exercise context set to: ${exercise?.title ?? `Exercise ${exerciseId}`}`);
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

    private async _initializeIrisSession(context: ActiveContext): Promise<void> {
        if (!this._artemisApiService) {
            return;
        }

        try {
            console.log(`Initializing Iris session for ${context.type}: ${context.title} (ID: ${context.id})`);

            let session;
            if (context.type === 'course') {
                session = await this._artemisApiService.getCurrentCourseChat(context.id);
            } else if (context.type === 'exercise') {
                session = await this._artemisApiService.getCurrentExerciseChat(context.id);
            } else {
                throw new Error(`Unsupported context type: ${context.type}`);
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
                            role: msg.sender === 'USER' ? 'user' : 'assistant',
                            content: content,
                            timestamp: msg.sentAt ? new Date(msg.sentAt).getTime() : Date.now()
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
        this._contextStore.createSession();
        this._currentArtemisSessionId = undefined;
        this._postSnapshot();
        if (this._view) {
            this._view.webview.postMessage({ command: 'clearChatMessages' });
        }
    }

    public switchToSession(sessionId: string): void {
        this._contextStore.switchSession(sessionId);
        this._postSnapshot();
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
