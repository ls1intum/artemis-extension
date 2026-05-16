import * as vscode from 'vscode';

import type { ExtensionToWebviewMessage, WebSocketDisplayStatus } from '@shared/messageContracts';
import { ExtensionMsg } from '@shared/messageContracts';

import { LogCategory, logger } from '@extension/services/loggingService';
import { ArtemisWebsocketService } from '@extension/services/websocket/artemisWebsocketService';
import type { IrisChatMessage, IrisStageDTO } from '@extension/types';

import { IrisWebSocketSessionClient } from '../transport/irisWebSocketSessionClient';
import { extractIrisMessageContent } from './messageUtils';

type ReconnectResult =
    | { status: 'reconnected' }
    | { status: 'already-connected' }
    | { status: 'no-service' }
    | { status: 'failed'; error: string };

interface ReceivedIrisChatMessage {
    content: string;
    /** Numeric message ID from the Artemis server, stringified for recording. */
    messageId?: string;
    /** Numeric session ID from the Artemis server, stringified for recording. */
    sessionId?: string;
    /** Unix-ms timestamp derived from the server's sentAt ISO string. */
    sentAt?: number;
}

export class IrisWebSocketMessageHandler {
    private readonly _onDidReceiveIrisChatMessage = new vscode.EventEmitter<ReceivedIrisChatMessage>();
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
                const sentAtMs = msg.sentAt ? new Date(msg.sentAt).getTime() : undefined;
                this._postMessage({
                    type: ExtensionMsg.AddMessage,
                    message: {
                        id: msg.id,
                        role: 'assistant',
                        content: content,
                        timestamp: sentAtMs ?? Date.now(),
                        helpful: typeof msg['helpful'] === 'boolean' ? msg['helpful'] : null
                    }
                });

                // Build the enriched received-message payload for recording.
                // sessionId is not available in the per-message payload; it is
                // stored at the subscription level. We omit it here and rely on
                // the recorder consumer to enrich it if needed in the future.
                const receivedMsg: ReceivedIrisChatMessage = {
                    content,
                    messageId: msg.id !== undefined ? String(msg.id) : undefined,
                    sentAt: sentAtMs,
                };
                this._onDidReceiveIrisChatMessage.fire(receivedMsg);
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
                this.publishCurrentStatus();
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
                this.publishCurrentStatus();
                return { status: 'reconnected' };
            }

            return { status: 'failed', error: 'Connection attempt did not establish' };
        } catch (error: unknown) {
            logger.error('Failed to reconnect WebSocket', LogCategory.WEBSOCKET, error);
            this.publishCurrentStatus();
            return { status: 'failed', error: error instanceof Error ? error.message : String(error) };
        }
    }

    /**
     * Push the current display status to the webview. Reads it from the
     * websocket service so the status bar and the chat webview cannot
     * disagree about what state the connection is in.
     */
    public publishCurrentStatus(): void {
        const status = this._websocketService?.getDisplayStatus() ?? 'disconnected';
        this.publishStatus(status);
    }

    public publishStatus(status: WebSocketDisplayStatus): void {
        this._postMessage({
            type: ExtensionMsg.UpdateWebSocketStatus,
            status,
        });
    }
}
