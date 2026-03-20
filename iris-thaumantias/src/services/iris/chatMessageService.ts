import * as vscode from 'vscode';
import { ArtemisWebsocketService } from '../websocket/artemisWebsocketService';
import { IrisSessionManager } from './irisSessionManager';
import { ActiveContext } from '../../types';
import { checkWorkspaceFiles } from '../../utils';
import { StruggleContext } from '../telemetry';
import { logger, LogCategory } from '../loggingService';
import { ExtensionMsg } from '../../shared/messageContracts';
import type { IrisServiceDeps } from './sessionSyncUtils';

export class ChatMessageService {
    constructor(
        private readonly deps: IrisServiceDeps,
        private readonly _websocketService: ArtemisWebsocketService | undefined,
        private readonly _getIrisSessionManager: () => IrisSessionManager | undefined,
        private readonly _initializeIrisSession: (context: ActiveContext) => Promise<void>,
    ) { }

    public async handleChatMessage(messageText: string, activeContext: ActiveContext, struggleContext?: StruggleContext): Promise<void> {
        logger.websocket(`📤 handleChatMessage called with: ${JSON.stringify({ text: messageText?.substring(0, 50) })}`);

        if (!messageText) {
            logger.websocket('⚠️ No text in message, returning');
            return;
        }

        logger.websocket(`✅ Active context: ${JSON.stringify({ type: activeContext.type, id: activeContext.id, title: activeContext.title })}`);

        if (struggleContext) {
            logger.websocket(`📊 Struggle context: ${JSON.stringify({
                isStruggling: struggleContext.isStruggling,
                eq: struggleContext.eq,
                eqConfidence: struggleContext.eqConfidence,
                recommendedAction: struggleContext.recommendedAction
            })}`);
        }

        if (!this.deps.artemisApiService) {
            vscode.window.showErrorMessage('Artemis API service not available');
            return;
        }

        try {
            // Check WebSocket connection before sending
            await this._ensureWebSocketConnection();

            // Get or create Iris session
            await this._ensureIrisSession(activeContext);

            const irisSessionManager = this._getIrisSessionManager();
            if (!irisSessionManager?.currentSessionId) {
                throw new Error('Failed to initialize Iris session');
            }

            // Collect uncommitted files from the current workspace
            const uncommittedFiles = await this._collectUncommittedFiles();

            // Send message to Iris
            logger.websocket(`🚀 Sending message to Artemis API... ${JSON.stringify({
                sessionId: irisSessionManager.currentSessionId,
                messageLength: messageText.length,
                hasUncommittedFiles: uncommittedFiles ? uncommittedFiles.size : 0
            })}`);
            await this.deps.artemisApiService.sendChatMessage(
                irisSessionManager.currentSessionId,
                messageText,
                uncommittedFiles
            );

            logger.websocket('✅ Message sent to Iris, waiting for WebSocket response...');

            // Note: The assistant's response will arrive via WebSocket
            this.deps.contextStore.incrementActiveSessionMessageCount();
            this.deps.postSnapshot();

        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error('Error sending chat message', LogCategory.IRIS_CHAT, error);
            vscode.window.showErrorMessage(`Failed to send message: ${errorMessage}`);

            this.deps.postMessage({
                type: ExtensionMsg.AddMessage,
                message: {
                    role: 'assistant',
                    content: `Error: ${errorMessage}`,
                    timestamp: Date.now()
                }
            });
        }
    }

    /**
     * Ensure WebSocket is connected before sending a message.
     * 
     * SAFETY: Uses ensureConnection() which has all safety guards:
     * - Rate limiting
     * - Max attempts
     * - Mutex protection
     */
    private async _ensureWebSocketConnection(): Promise<void> {
        logger.websocket('🔍 Checking WebSocket connection before sending message...');
        if (!this._websocketService) {
            logger.warn('⚠️ No WebSocket service available', LogCategory.WEBSOCKET);
            return;
        }

        if (this._websocketService.isConnected()) {
            logger.websocket('✅ WebSocket already connected');
            return;
        }

        logger.websocket('⚠️ WebSocket not connected, attempting to connect...');
        try {
            // Use ensureConnection() which has all safety guards
            const connected = await this._websocketService.ensureConnection();
            if (connected) {
                logger.websocket('✅ WebSocket connected successfully');
            } else {
                logger.warn('⚠️ WebSocket connection not established', LogCategory.WEBSOCKET);
                vscode.window.showWarningMessage('WebSocket connection not available. You may not receive responses in real-time.');
            }
        } catch (error) {
            logger.error('❌ Failed to connect WebSocket', LogCategory.WEBSOCKET, error as Error);
            vscode.window.showWarningMessage('WebSocket connection failed. You may not receive responses in real-time.');
        }
    }

    private async _ensureIrisSession(activeContext: ActiveContext): Promise<void> {
        const irisSessionManager = this._getIrisSessionManager();
        logger.websocket(`🔑 Checking for existing Iris session... ${JSON.stringify({
            hasSessionId: !!irisSessionManager?.currentSessionId,
            sessionId: irisSessionManager?.currentSessionId
        })}`);

        if (!irisSessionManager?.currentSessionId) {
            logger.websocket('🆕 No active session found, initializing new Iris session...');
            await this._initializeIrisSession(activeContext);
        } else {
            logger.websocket(`✅ Using existing Iris session: ${irisSessionManager.currentSessionId}`);
        }
    }

    private async _collectUncommittedFiles(): Promise<Map<string, string> | undefined> {
        let uncommittedFiles: Map<string, string> | undefined;

        // Check if the user has enabled sending uncommitted changes
        const sendUncommittedChanges = vscode.workspace.getConfiguration('artemis.iris').get<boolean>('sendUncommittedChanges', true);

        if (!sendUncommittedChanges) {
            logger.irisChat('📁 Uncommitted changes sending is disabled by user setting');
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
                logger.irisChat(`📁 Sending ${uncommittedFiles.size} uncommitted file(s) to Iris`);

                // Update display with detailed analysis
                const excludedFiles = result.files
                    .filter(f => f.status === 'excluded')
                    .map(f => ({ path: f.path, reason: f.reason || 'Excluded' }));

                this.deps.postMessage({
                    type: ExtensionMsg.UpdateReferencedFiles,
                    includedFiles: Array.from(uncommittedFiles.keys()),
                    excludedFiles: excludedFiles,
                    totalCount: result.totalCount
                });
            }

            return uncommittedFiles;
        } catch (error: unknown) {
            logger.error('Error collecting uncommitted files', LogCategory.IRIS_CHAT, error);

            const errorMessage = error instanceof Error ? error.message : '';
            const errorCode = (error as { code?: string }).code;

            // Show user-friendly error message based on error type
            if (errorMessage.includes('Git')) {
                vscode.window.showWarningMessage(
                    'Failed to collect uncommitted files from Git. Iris will only see your repository content.',
                    'OK'
                );
            } else if (errorCode === 'ENOENT') {
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
                        void vscode.workspace.getConfiguration('artemis.iris').update('sendUncommittedChanges', false, true);
                    }
                }, err => logger.error('Error showing uncommitted files warning', LogCategory.IRIS_CHAT, err));
            }

            // Continue without uncommitted files - this is not a critical error
            return undefined;
        }
    }
}
