import * as vscode from 'vscode';
import { ArtemisApiService } from '../api';
import { ArtemisWebsocketService } from './artemisWebsocketService';
import { IrisSessionManager } from './irisSessionManager';
import { ContextStore } from './contextStore';
import { ActiveContext } from '../provider/contextTypes';
import { checkWorkspaceFiles } from '../utils';

export class ChatMessageService {
    constructor(
        private readonly _contextStore: ContextStore,
        private readonly _artemisApiService: ArtemisApiService | undefined,
        private readonly _websocketService: ArtemisWebsocketService | undefined,
        private readonly _getIrisSessionManager: () => IrisSessionManager | undefined,
        private readonly _postMessage: (message: any) => void,
        private readonly _initializeIrisSession: (context: ActiveContext) => Promise<void>,
        private readonly _postSnapshot: () => void
    ) { }

    public async handleChatMessage(messageText: string, activeContext: ActiveContext): Promise<void> {
        console.log('[WebsocketLog] 📤 handleChatMessage called with:', { text: messageText?.substring(0, 50) });

        if (!messageText) {
            console.log('[WebsocketLog] ⚠️ No text in message, returning');
            return;
        }

        console.log('[WebsocketLog] ✅ Active context:', { type: activeContext.type, id: activeContext.id, title: activeContext.title });

        if (!this._artemisApiService) {
            vscode.window.showErrorMessage('Artemis API service not available');
            return;
        }

        try {
            // Check WebSocket connection before sending
            await this._ensureWebSocketConnection();

            // Show user message immediately
            this._displayUserMessage(messageText);

            // Get or create Iris session
            await this._ensureIrisSession(activeContext);

            const irisSessionManager = this._getIrisSessionManager();
            if (!irisSessionManager?.currentSessionId) {
                throw new Error('Failed to initialize Iris session');
            }

            // Collect uncommitted files from the current workspace
            const uncommittedFiles = await this._collectUncommittedFiles();

            // Send message to Iris
            console.log('[WebsocketLog] 🚀 Sending message to Artemis API...', {
                sessionId: irisSessionManager.currentSessionId,
                messageLength: messageText.length,
                hasUncommittedFiles: uncommittedFiles ? uncommittedFiles.size : 0
            });
            await this._artemisApiService.sendChatMessage(
                irisSessionManager.currentSessionId,
                messageText,
                uncommittedFiles
            );

            console.log('[WebsocketLog] ✅ Message sent to Iris, waiting for WebSocket response...');

            // Note: The assistant's response will arrive via WebSocket
            this._contextStore.incrementActiveSessionMessageCount();
            this._postSnapshot();

        } catch (error: any) {
            console.error('Error sending chat message:', error);
            vscode.window.showErrorMessage(`Failed to send message: ${error.message}`);

            this._postMessage({
                command: 'addMessage',
                message: {
                    role: 'error',
                    content: `Error: ${error.message}`,
                    timestamp: Date.now()
                }
            });
        }
    }

    private async _ensureWebSocketConnection(): Promise<void> {
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
    }

    private _displayUserMessage(text: string): void {
        console.log('[WebsocketLog] 💬 Sending user message to webview');
        this._postMessage({
            command: 'addMessage',
            message: {
                role: 'user',
                content: text,
                timestamp: Date.now()
            }
        });
        console.log('[WebsocketLog] ✅ User message sent to webview (this should trigger thinking indicator)');
    }

    private async _ensureIrisSession(activeContext: ActiveContext): Promise<void> {
        const irisSessionManager = this._getIrisSessionManager();
        console.log('[WebsocketLog] 🔑 Checking for existing Iris session...', {
            hasSessionId: !!irisSessionManager?.currentSessionId,
            sessionId: irisSessionManager?.currentSessionId
        });

        if (!irisSessionManager?.currentSessionId) {
            console.log('[WebsocketLog] 🆕 No active session found, initializing new Iris session...');
            await this._initializeIrisSession(activeContext);
        } else {
            console.log('[WebsocketLog] ✅ Using existing Iris session:', irisSessionManager.currentSessionId);
        }
    }

    private async _collectUncommittedFiles(): Promise<Map<string, string> | undefined> {
        let uncommittedFiles: Map<string, string> | undefined;

        // Check if the user has enabled sending uncommitted changes
        const sendUncommittedChanges = vscode.workspace.getConfiguration('artemis.iris').get<boolean>('sendUncommittedChanges', true);

        if (!sendUncommittedChanges) {
            console.log('[Iris Chat] 📁 Uncommitted changes sending is disabled by user setting');
            return undefined;
        }

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
                console.log(`[Iris Chat] 📁 Sending ${uncommittedFiles.size} uncommitted file(s) to Iris`);

                // Update display with detailed analysis
                const excludedFiles = result.files
                    .filter(f => f.status === 'excluded')
                    .map(f => ({ path: f.path, reason: f.reason || 'Excluded' }));

                this._postMessage({
                    command: 'updateReferencedFiles',
                    includedFiles: Array.from(uncommittedFiles.keys()),
                    excludedFiles: excludedFiles,
                    totalCount: result.totalCount
                });
            }

            return uncommittedFiles;
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
            return undefined;
        }
    }
}
