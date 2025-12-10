import * as vscode from 'vscode';
import { ArtemisWebsocketService } from './artemisWebsocketService';
import { IrisSessionManager } from './irisSessionManager';

export class WebSocketMessageHandler {
    constructor(
        private readonly _websocketService: ArtemisWebsocketService | undefined,
        private readonly _getIrisSessionManager: () => IrisSessionManager | undefined,
        private readonly _postMessage: (message: any) => void
    ) {}

    public handleIrisWebSocketMessage(data: any): void {
        console.log('[WebsocketLog] 🔔 Received Iris WebSocket message:', JSON.stringify(data, null, 2));

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
                this._postMessage({
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
                console.log('[Iris Chat] Resubscribing to Iris session after reconnect:', irisSessionManager.currentSessionId);
                irisSessionManager.subscribeToSession(irisSessionManager.currentSessionId);
            }

            this._updateWebSocketStatus(true);
            vscode.window.showInformationMessage('Successfully reconnected to WebSocket');
        } catch (error: any) {
            console.error('Failed to reconnect WebSocket:', error);
            vscode.window.showErrorMessage(`Failed to reconnect: ${error.message}`);
            this._updateWebSocketStatus(false);
        }
    }

    public updateWebSocketStatus(isConnected: boolean): void {
        this._updateWebSocketStatus(isConnected);
    }

    private _updateWebSocketStatus(isConnected: boolean): void {
        this._postMessage({
            command: 'updateWebSocketStatus',
            isConnected: isConnected
        });
    }
}
