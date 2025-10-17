import { Client, StompConfig, StompSubscription, IFrame, IMessage } from '@stomp/stompjs';
import WebSocket from 'ws';
import * as vscode from 'vscode';
import { AuthManager } from '../auth';
import { VSCODE_CONFIG } from '../utils';
import { 
    ResultDTO, 
    ProgrammingSubmission, 
    SubmissionProcessingMessage,
    WebSocketMessageHandler 
} from '../types';

/**
 * Service for managing WebSocket/STOMP connections to Artemis server
 * Handles real-time updates for submissions, results, and build status
 */
export class ArtemisWebsocketService {
    private _client?: Client;
    private _authManager: AuthManager;
    private _isConnected: boolean = false;
    private _reconnectAttempts: number = 0;
    private _maxReconnectAttempts: number = 10;
    private _reconnectDelay: number = 3000; // 3 seconds
    private _subscriptions: Map<string, StompSubscription> = new Map();
    private _messageHandlers: WebSocketMessageHandler[] = [];

    constructor(authManager: AuthManager) {
        this._authManager = authManager;
    }

    /**
     * Register a message handler for WebSocket events
     */
    public registerMessageHandler(handler: WebSocketMessageHandler): void {
        this._messageHandlers.push(handler);
        this._log(`Message handler registered. Total handlers: ${this._messageHandlers.length}`);
    }

    /**
     * Connect to the Artemis WebSocket server
     */
    public async connect(): Promise<void> {
        if (this._isConnected && this._client?.connected) {
            this._log('Already connected to Artemis WebSocket');
            return;
        }

        try {
            const serverUrl = this._getServerUrl();
            this._log(`Connecting to Artemis WebSocket...`);
            
            const cookie = await this._authManager.getCookieHeader();

            if (!cookie) {
                const errorMsg = 'No authentication cookie available. Please log in first.';
                this._log(`⚠️ ${errorMsg}`);
                throw new Error(errorMsg);
            }

            // Extract JWT token from cookie
            const jwtToken = this._extractJwtFromCookie(cookie);
            
            if (!jwtToken) {
                const errorMsg = 'Failed to extract JWT token from cookie';
                this._log(`⚠️ ${errorMsg}`);
                throw new Error(errorMsg);
            }

            // Construct WebSocket URL
            const wsUrl = this._buildWebSocketUrl(serverUrl);
            this._log(`Connecting to ${wsUrl}`);

            // Configure STOMP client
            const stompConfig: StompConfig = {
                brokerURL: wsUrl,
                connectHeaders: {},
                reconnectDelay: this._reconnectDelay,
                heartbeatIncoming: 10000,
                heartbeatOutgoing: 10000,
                
                webSocketFactory: () => {
                    const ws = new WebSocket(wsUrl, {
                        headers: {
                            'Cookie': cookie
                        }
                    });
                    
                    ws.on('error', (err) => {
                        this._log(`WebSocket error: ${err.message}`);
                    });
                    
                    return ws as any;
                },

                onConnect: () => {
                    this._onConnected();
                },

                onStompError: (frame: IFrame) => {
                    this._onError(`STOMP error: ${frame.headers['message']}`);
                },

                onWebSocketError: (event: any) => {
                    this._onError(`WebSocket error`);
                },

                onDisconnect: () => {
                    this._onDisconnected();
                }
            };

            this._client = new Client(stompConfig);
            this._client.activate();

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            this._onError(`Failed to connect to WebSocket: ${errorMessage}`);
            throw error;
        }
    }

    /**
     * Disconnect from the WebSocket server
     */
    public async disconnect(): Promise<void> {
        if (this._client) {
            this._log('Disconnecting from Artemis WebSocket');
            
            // Unsubscribe from all topics
            this._subscriptions.forEach((subscription, topic) => {
                subscription.unsubscribe();
                this._log(`Unsubscribed from ${topic}`);
            });
            this._subscriptions.clear();

            // Deactivate the client
            await this._client.deactivate();
            this._client = undefined;
            this._isConnected = false;
        }
    }

    /**
     * Subscribe to personal result updates for the authenticated user
     */
    public subscribeToPersonalResults(): void {
        if (!this._isConnected || !this._client) {
            this._log('Cannot subscribe: not connected');
            return;
        }

        // IMPORTANT: Topic is plural 'newResults', not singular 'newResult'
        // See: webapp/app/core/course/shared/services/participation-websocket.service.ts
        const topic = '/user/topic/newResults';
        if (this._subscriptions.has(topic)) {
            this._log(`Already subscribed to ${topic}`);
            return;
        }

        const subscription = this._client.subscribe(topic, (message: IMessage) => {
            try {
                const result: ResultDTO = JSON.parse(message.body);
                this._log(`Received new result: score=${result.score}, successful=${result.successful}`);
                
                // Notify all handlers
                this._messageHandlers.forEach(handler => {
                    if (handler.onNewResult) {
                        handler.onNewResult(result);
                    }
                });
            } catch (error) {
                this._log(`Error processing result message: ${error}`);
            }
        });

        this._subscriptions.set(topic, subscription);
        this._log(`Subscribed to ${topic}`);
    }

    /**
     * Subscribe to personal submission updates
     */
    public subscribeToPersonalSubmissions(): void {
        if (!this._isConnected || !this._client) {
            this._log('Cannot subscribe: not connected');
            return;
        }

        const topic = '/user/topic/newSubmissions';
        if (this._subscriptions.has(topic)) {
            this._log(`Already subscribed to ${topic}`);
            return;
        }

        const subscription = this._client.subscribe(topic, (message: IMessage) => {
            try {
                const submission: ProgrammingSubmission = JSON.parse(message.body);
                this._log(`Received new submission: ${submission.id}`);
                
                // Notify all handlers
                this._messageHandlers.forEach(handler => {
                    if (handler.onNewSubmission) {
                        handler.onNewSubmission(submission);
                    }
                });
            } catch (error) {
                this._log(`Error processing submission message: ${error}`);
            }
        });

        this._subscriptions.set(topic, subscription);
        this._log(`Subscribed to ${topic}`);
    }

    /**
     * Subscribe to submission processing updates (build status)
     */
    public subscribeToSubmissionProcessing(): void {
        if (!this._isConnected || !this._client) {
            this._log('Cannot subscribe: not connected');
            return;
        }

        const topic = '/user/topic/submissionProcessing';
        if (this._subscriptions.has(topic)) {
            this._log(`Already subscribed to ${topic}`);
            return;
        }

        const subscription = this._client.subscribe(topic, (message: IMessage) => {
            try {
                const processingMsg: SubmissionProcessingMessage = JSON.parse(message.body);
                this._log(`Received submission processing update: participationId=${processingMsg.participationId}`);
                
                // Notify all handlers
                this._messageHandlers.forEach(handler => {
                    if (handler.onSubmissionProcessing) {
                        handler.onSubmissionProcessing(processingMsg);
                    }
                });
            } catch (error) {
                this._log(`Error processing submission processing message: ${error}`);
            }
        });

        this._subscriptions.set(topic, subscription);
        this._log(`Subscribed to ${topic}`);
    }

    /**
     * Check if currently connected
     */
    public isConnected(): boolean {
        return this._isConnected && this._client?.connected === true;
    }

    /**
     * Get connection status
     */
    public getStatus(): string {
        if (this._isConnected && this._client?.connected) {
            return `Connected (${this._subscriptions.size} subscriptions)`;
        } else if (this._reconnectAttempts > 0) {
            return `Reconnecting (attempt ${this._reconnectAttempts}/${this._maxReconnectAttempts})`;
        } else {
            return 'Disconnected';
        }
    }

    /**
     * Get detailed debugging information with async cookie check
     */
    public async getDebugInfoAsync(): Promise<{
        isConnected: boolean;
        clientConnected: boolean;
        clientActive: boolean;
        subscriptionCount: number;
        subscriptions: string[];
        reconnectAttempts: number;
        maxReconnectAttempts: number;
        serverUrl: string;
        websocketUrl: string;
        hasCookie: boolean;
        hasJwtToken: boolean;
        cookiePreview?: string;
    }> {
        const serverUrl = this._getServerUrl();
        const wsUrl = this._buildWebSocketUrl(serverUrl);
        
        const info = {
            isConnected: this._isConnected,
            clientConnected: this._client?.connected || false,
            clientActive: this._client?.active || false,
            subscriptionCount: this._subscriptions.size,
            subscriptions: Array.from(this._subscriptions.keys()),
            reconnectAttempts: this._reconnectAttempts,
            maxReconnectAttempts: this._maxReconnectAttempts,
            serverUrl: serverUrl,
            websocketUrl: wsUrl,
            hasCookie: false,
            hasJwtToken: false,
            cookiePreview: undefined as string | undefined
        };
        
        try {
            const cookie = await this._authManager.getCookieHeader();
            info.hasCookie = !!cookie;
            if (cookie) {
                const jwtToken = this._extractJwtFromCookie(cookie);
                info.hasJwtToken = !!jwtToken;
                info.cookiePreview = cookie.substring(0, 20) + '...';
            }
        } catch (error) {
            info.hasCookie = false;
            info.hasJwtToken = false;
        }
        
        return info;
    }

    /**
     * Dispose and cleanup
     */
    public dispose(): void {
        this.disconnect();
    }

    // Private helper methods

    private _onConnected(): void {
        this._isConnected = true;
        this._reconnectAttempts = 0;
        this._log('✅ Connected to Artemis WebSocket');
        
        // Auto-subscribe to personal topics
        this.subscribeToPersonalResults();
        this.subscribeToPersonalSubmissions();
        this.subscribeToSubmissionProcessing();
    }

    private _onDisconnected(): void {
        this._isConnected = false;
        this._subscriptions.clear();
        this._log('Disconnected from Artemis WebSocket');
        
        // Attempt reconnection if within limit
        if (this._reconnectAttempts < this._maxReconnectAttempts) {
            this._reconnectAttempts++;
            this._log(`Will attempt reconnection (${this._reconnectAttempts}/${this._maxReconnectAttempts})`);
        }
    }

    private _onError(message: string): void {
        this._log(`❌ ${message}`);
        console.error(`[Artemis WebSocket] ${message}`);
    }

    private _getServerUrl(): string {
        const config = vscode.workspace.getConfiguration(VSCODE_CONFIG.ARTEMIS_SECTION);
        return config.get<string>(VSCODE_CONFIG.SERVER_URL_KEY) || 'https://artemis.tum.de';
    }

    private _buildWebSocketUrl(serverUrl: string): string {
        // Convert HTTP(S) URL to WS(S) URL
        const url = new URL(serverUrl);
        const protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
        
        // Artemis uses /websocket/websocket to bypass SockJS and use STOMP directly
        // Source: webapp/app/shared/service/websocket.service.ts line 166
        // const url = `//${window.location.host}/websocket/websocket`;
        const wsEndpoint = `${protocol}//${url.host}/websocket/websocket`;
        
        this._log(`Using direct STOMP endpoint (no SockJS): ${wsEndpoint}`);
        return wsEndpoint;
    }

    private _extractJwtFromCookie(cookieHeader: string): string | undefined {
        // Cookie header format: "jwt=<token>; other=value"
        const jwtMatch = cookieHeader.match(/jwt=([^;]+)/);
        return jwtMatch ? jwtMatch[1] : undefined;
    }

    private _log(message: string): void {
        console.log(`[Artemis WebSocket] ${message}`);
    }
}
