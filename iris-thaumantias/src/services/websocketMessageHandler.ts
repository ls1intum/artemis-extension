import * as vscode from 'vscode';
import { ArtemisWebsocketService } from './artemisWebsocketService';
import { IrisSessionManager } from './irisSessionManager';
import type { IrisChatMessage } from '../types/apiResponses';
import { logger, LogCategory } from './loggingService';
import { extractIrisMessageContent } from '../utils/irisMessageUtils';
import { ExtensionMsg } from '../shared/messageContracts';
import type { ExtensionToWebviewMessage } from '../shared/messageContracts';

export class IrisWebSocketMessageHandler {
    constructor(
        private readonly _websocketService: ArtemisWebsocketService | undefined,
        private readonly _getIrisSessionManager: () => IrisSessionManager | undefined,
        private readonly _postMessage: (message: ExtensionToWebviewMessage) => void
    ) { }

    public handleIrisWebSocketMessage(data: unknown): void {
        logger.info(`🔔 Received Iris WebSocket message: ${JSON.stringify(data, null, 2)}`, LogCategory.WEBSOCKET);

        // Runtime type guard for the incoming WebSocket payload
        if (!this._isIrisWebSocketPayload(data)) {
            logger.info(`⚠️ Unknown message type or format: ${JSON.stringify(data)}`, LogCategory.WEBSOCKET);
            return;
        }

        // Handle different message types
        if (data.type === 'MESSAGE' && data.message) {
            logger.info('📦 Processing MESSAGE type', LogCategory.WEBSOCKET);
            // Extract content from the message
            const msg = data.message;
            const content = extractIrisMessageContent(msg.content);

            logger.info(`📝 Extracted content length: ${content.length} chars`, LogCategory.WEBSOCKET);
            logger.info(`👤 Message sender: ${msg.sender}`, LogCategory.WEBSOCKET);

            // Only show assistant messages (user messages were already shown)
            if (msg.sender !== 'USER' && content) {
                logger.info('🤖 Sending assistant message to webview (this should hide thinking indicator)', LogCategory.WEBSOCKET);
                this._postMessage({
                    type: ExtensionMsg.AddMessage,
                    message: {
                        id: msg.id,
                        role: 'assistant',
                        content: content,
                        timestamp: msg.sentAt ? new Date(msg.sentAt).getTime() : Date.now(),
                        helpful: typeof msg['helpful'] === 'boolean' ? msg['helpful'] : null
                    }
                });
                logger.info('✅ Assistant message sent to webview', LogCategory.WEBSOCKET);
            } else {
                logger.info('⏭️ Skipping message (either USER message or no content)', LogCategory.WEBSOCKET);
            }
        } else if (data.type === 'STATUS') {
            // Handle status updates (e.g., "Iris is thinking...")
            logger.info(`📊 Iris status update: ${JSON.stringify(data)}`, LogCategory.WEBSOCKET);
            // TODO: Show status indicator in UI
        }
    }

    private _isIrisWebSocketPayload(data: unknown): data is { type: string; message?: IrisChatMessage } {
        return typeof data === 'object' && data !== null && 'type' in data && typeof (data as { type: unknown }).type === 'string';
    }

    public async handleReconnectWebSocket(): Promise<void> {
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
            const irisSessionManager = this._getIrisSessionManager();
            if (irisSessionManager?.currentSessionId && this._websocketService.isConnected()) {
                logger.info(`Resubscribing to Iris session after reconnect: ${irisSessionManager.currentSessionId}`, LogCategory.IRIS_CHAT);
                void irisSessionManager.subscribeToSession(irisSessionManager.currentSessionId);
            }

            this._updateWebSocketStatus(true);
            vscode.window.showInformationMessage('Successfully reconnected to WebSocket');
        } catch (error: unknown) {
            logger.error('Failed to reconnect WebSocket', LogCategory.WEBSOCKET, error);
            const errorMessage = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Failed to reconnect: ${errorMessage}`);
            this._updateWebSocketStatus(false);
        }
    }

    public updateWebSocketStatus(isConnected: boolean): void {
        this._updateWebSocketStatus(isConnected);
    }

    private _updateWebSocketStatus(isConnected: boolean): void {
        this._postMessage({
            type: ExtensionMsg.UpdateWebSocketStatus,
            isConnected: isConnected
        });
    }
}
