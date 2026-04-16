import * as vscode from 'vscode';
import { ArtemisWebsocketService } from './artemisWebsocketService';
import { IrisWebSocketSessionClient } from '../iris/irisWebSocketSessionClient';
import type { IrisChatMessage, IrisStageDTO } from '../../types';
import { logger, LogCategory } from '../loggingService';
import { extractIrisMessageContent } from '../iris/messageUtils';
import { ExtensionMsg } from '../../../shared/messageContracts';
import type { ExtensionToWebviewMessage } from '../../../shared/messageContracts';

export type ReconnectResult =
    | { status: 'reconnected' }
    | { status: 'already-connected' }
    | { status: 'no-service' }
    | { status: 'failed'; error: string };

export class IrisWebSocketMessageHandler {
    private readonly _onDidReceiveIrisChatMessage = new vscode.EventEmitter<string>();
    public readonly onDidReceiveIrisChatMessage = this._onDidReceiveIrisChatMessage.event;

    constructor(
        private readonly _websocketService: ArtemisWebsocketService | undefined,
        private readonly _getIrisWebSocketSessionClient: () => IrisWebSocketSessionClient | undefined,
        private readonly _postMessage: (message: ExtensionToWebviewMessage) => void,
        private readonly _onSessionTitleUpdate?: (artemisSessionId: number, title: string) => void,
    ) { }

    public handleIrisWebSocketMessage(data: unknown): void {
        logger.info(`Received Iris WebSocket message: ${JSON.stringify(data, null, 2)}`, LogCategory.WEBSOCKET);

        // Runtime type guard for the incoming WebSocket payload
        if (!this._isIrisWebSocketPayload(data)) {
            logger.info(`Unknown message type or format: ${JSON.stringify(data)}`, LogCategory.WEBSOCKET);
            return;
        }

        // Extract sessionTitle if present (sent with both MESSAGE and STATUS payloads)
        this._handleSessionTitle(data);

        // Handle different message types
        if (data.type === 'MESSAGE' && data.message) {
            logger.info('Processing MESSAGE type', LogCategory.WEBSOCKET);
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
                this._onDidReceiveIrisChatMessage.fire(content);
                logger.info('Assistant message sent to webview', LogCategory.WEBSOCKET);
            } else {
                logger.info('Skipping message (either USER message or no content)', LogCategory.WEBSOCKET);
            }
        } else if (data.type === 'STATUS') {
            const rawStages = data['stages'];
            if (Array.isArray(rawStages)) {
                const visibleStages = (rawStages as unknown[]).filter(
                    (stage): stage is IrisStageDTO =>
                        typeof stage === 'object' && stage !== null && (stage as IrisStageDTO).internal !== true
                );
                logger.info(`Iris status update: ${visibleStages.length} visible stage(s)`, LogCategory.WEBSOCKET);
                this._postMessage({
                    type: ExtensionMsg.UpdateIrisStages,
                    stages: visibleStages,
                });
            } else {
                logger.info(`Iris STATUS message without stages array: ${JSON.stringify(data)}`, LogCategory.WEBSOCKET);
            }
        }
    }

    private _handleSessionTitle(data: Record<string, unknown>): void {
        const sessionTitle = data['sessionTitle'];
        if (typeof sessionTitle !== 'string' || !sessionTitle) {
            return;
        }

        const irisSession = this._getIrisWebSocketSessionClient();
        const artemisSessionId = irisSession?.currentSessionId;
        if (!artemisSessionId) {
            return;
        }

        logger.info(`Session title received: "${sessionTitle}" for session ${artemisSessionId}`, LogCategory.WEBSOCKET);
        this._onSessionTitleUpdate?.(artemisSessionId, sessionTitle);
    }

    private _isIrisWebSocketPayload(data: unknown): data is Record<string, unknown> & { type: string; message?: IrisChatMessage } {
        return typeof data === 'object' && data !== null && 'type' in data && typeof (data as { type: unknown }).type === 'string';
    }

    public async handleReconnectWebSocket(): Promise<ReconnectResult> {
        if (!this._websocketService) {
            return { status: 'no-service' };
        }

        try {
            if (this._websocketService.isConnected()) {
                this._updateWebSocketStatus(true);
                return { status: 'already-connected' };
            }

            // Reset state in case previous attempts exhausted the limit
            this._websocketService.resetConnectionState();
            await this._websocketService.connect();

            // If we have an active Iris session, resubscribe to it
            const irisSessionManager = this._getIrisWebSocketSessionClient();
            if (irisSessionManager?.currentSessionId && this._websocketService.isConnected()) {
                logger.info(`Resubscribing to Iris session after reconnect: ${irisSessionManager.currentSessionId}`, LogCategory.IRIS_CHAT);
                void irisSessionManager.subscribeToSession(irisSessionManager.currentSessionId);
            }

            if (this._websocketService.isConnected()) {
                this._updateWebSocketStatus(true);
                return { status: 'reconnected' };
            }

            return { status: 'failed', error: 'Connection attempt did not establish' };
        } catch (error: unknown) {
            logger.error('Failed to reconnect WebSocket', LogCategory.WEBSOCKET, error);
            this._updateWebSocketStatus(false);
            return { status: 'failed', error: error instanceof Error ? error.message : String(error) };
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
