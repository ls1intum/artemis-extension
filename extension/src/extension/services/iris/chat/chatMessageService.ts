import * as vscode from 'vscode';
import { ArtemisWebsocketService } from '../../websocket/artemisWebsocketService';
import { IrisWebSocketSessionClient } from '../transport/irisWebSocketSessionClient';
import { IrisChatSessionService } from './chatSessionService';
import { ActiveContext } from '../../../types';
import { checkWorkspaceFiles } from '../../workspace/workspaceFileChecker';
import { StruggleContext } from '../../telemetry';
import { logger, LogCategory } from '../../loggingService';
import { ExtensionMsg } from '../../../../shared/messageContracts';
import type { IrisServiceDeps } from '../context/sessionSyncUtils';

interface SendMessageInput {
    text: string;
    isNoAiEnabled: boolean;
    struggleContext?: StruggleContext;
}

type SendMessageResult =
    | { sent: true }
    | { sent: false; reason: 'no-ai' | 'no-context' | 'iris-disabled'; contextLabel?: string };

export class ChatMessageService {
    constructor(
        private readonly deps: IrisServiceDeps,
        private readonly _websocketService: ArtemisWebsocketService | undefined,
        private readonly _getIrisWebSocketSessionClient: () => IrisWebSocketSessionClient | undefined,
        private readonly _chatSessionService: IrisChatSessionService,
    ) { }

    public async sendMessage(input: SendMessageInput): Promise<SendMessageResult> {
        if (input.isNoAiEnabled) {
            logger.warn('Chat blocked: .noai file detected', LogCategory.IRIS_CHAT);
            return { sent: false, reason: 'no-ai' };
        }

        const activeContext = this.deps.contextStore.getActiveContext();
        if (!activeContext) {
            logger.warn('No active context', LogCategory.IRIS_CHAT);
            return { sent: false, reason: 'no-context' };
        }

        const isEnabled = await this._chatSessionService.checkAndLoadIrisSettings(activeContext);
        if (!isEnabled) {
            const contextLabel = activeContext.type === 'course' ? 'course' : 'exercise';
            return { sent: false, reason: 'iris-disabled', contextLabel };
        }

        await this._sendToIris(input.text, activeContext, input.struggleContext);
        return { sent: true };
    }

    private async _sendToIris(messageText: string, activeContext: ActiveContext, struggleContext?: StruggleContext): Promise<void> {
        logger.websocket(`📤 handleChatMessage called with: ${JSON.stringify({ text: messageText?.substring(0, 50) })}`);

        if (!messageText) {
            logger.websocket('⚠️ No text in message, returning');
            return;
        }

        logger.websocket(`✅ Active context: ${JSON.stringify({ type: activeContext.type, id: activeContext.id, title: activeContext.title })}`);

        if (struggleContext) {
            logger.websocket(`Struggle context: ${JSON.stringify({
                isStruggling: struggleContext.isStruggling,
                eq: struggleContext.eq,
                eqConfidence: struggleContext.eqConfidence,
                recommendedAction: struggleContext.recommendedAction
            })}`);
        }

        if (!this.deps.artemisApiService) {
            throw new Error('Artemis API service not available');
        }

        try {
            // Check WebSocket connection before sending
            await this._ensureWebSocketConnection();

            // Get or create Iris session
            await this._ensureIrisSession(activeContext);

            const irisSessionManager = this._getIrisWebSocketSessionClient();
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
            logger.error('Error sending chat message', LogCategory.IRIS_CHAT, error);
            throw error;
        }
    }

    /**
     * Ensure WebSocket is connected before sending a message.
     *
     * SAFETY: connect() has all safety guards built in:
     * - State machine guards (connecting/disconnecting/gave-up)
     * - Max attempts (20 attempts, then gives up)
     * - Mutex protection via connection state
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
            await this._websocketService.connect();
            logger.websocket('✅ WebSocket connected successfully');
        } catch {
            logger.warn('⚠️ WebSocket connection not established', LogCategory.WEBSOCKET);
        }
    }

    private async _ensureIrisSession(activeContext: ActiveContext): Promise<void> {
        const irisSessionManager = this._getIrisWebSocketSessionClient();
        logger.websocket(`🔑 Checking for existing Iris session... ${JSON.stringify({
            hasSessionId: !!irisSessionManager?.currentSessionId,
            sessionId: irisSessionManager?.currentSessionId
        })}`);

        if (!irisSessionManager?.currentSessionId) {
            logger.websocket('🆕 No active session found, initializing new Iris session...');
            if (irisSessionManager) {
                await this._chatSessionService.initializeIrisSessionAndLoadMessages(activeContext, irisSessionManager);
            }
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
            // Continue without uncommitted files - this is not a critical error
            return undefined;
        }
    }
}
