import { Client, StompConfig, StompSubscription, IFrame, IMessage } from '@stomp/stompjs';
import WebSocket from 'ws';
import * as vscode from 'vscode';
import { AuthManager } from '../auth';
import { CONFIG, VSCODE_CONFIG } from '../utils';
import {
    ResultDTO,
    ProgrammingSubmission,
    SubmissionProcessingMessage,
    WebSocketMessageHandler
} from '../types';

/**
 * Delay in milliseconds before emitting non-connected states to consumers.
 * This grace period allows brief disconnections to recover without triggering UI warnings.
 * Matches Artemis webapp behavior (CONNECTION_STATE_DELAY_MS = 5000)
 */
const CONNECTION_STATE_DELAY_MS = 5000;

/**
 * Minimum interval between connection attempts to prevent flooding.
 * Even with exponential backoff, we enforce this minimum gap.
 */
const MIN_CONNECTION_INTERVAL_MS = 2000;

/**
 * Maximum number of connection attempts before giving up.
 * After this, user must manually trigger reconnection.
 */
const MAX_CONNECTION_ATTEMPTS = 20;

/**
 * Service for managing WebSocket/STOMP connections to Artemis server
 * Handles real-time updates for submissions, results, and build status
 * 
 * SAFETY FEATURES to prevent connection flooding:
 * 1. Connection mutex (_isConnecting) - prevents parallel connection attempts
 * 2. Rate limiting (MIN_CONNECTION_INTERVAL_MS) - minimum 2s between attempts
 * 3. Max attempts (MAX_CONNECTION_ATTEMPTS) - stops after 20 failed attempts
 * 4. Exponential backoff - 500ms → 1s → 2s → 4s → ... → max 10s
 * 5. Debounced disconnect notifications - 5s grace period
 * 6. Single STOMP reconnection handler - we don't call connect() on reconnect
 */
export class ArtemisWebsocketService {
    private _client?: Client;
    private _authManager: AuthManager;
    private _isConnected: boolean = false;
    private _isConnecting: boolean = false;
    private _isDisconnecting: boolean = false; // NEW: Prevent reconnect during disconnect
    private _reconnectAttempts: number = 0;
    private _lastConnectionAttempt: number = 0; // NEW: Track last attempt time
    private _connectionGaveUp: boolean = false; // NEW: Track if we gave up
    
    // Artemis webapp uses these values (see websocket.service.ts lines 305-314)
    private readonly _initialReconnectDelay: number = 500;  // Start at 500ms like webapp
    private readonly _maxReconnectDelay: number = 10000;    // Max 10 seconds like webapp
    private readonly _connectionTimeout: number = 10000;    // Abort connection after 10s (like webapp)
    private readonly _heartbeatInterval: number = 10000;    // 10 seconds for heartbeats
    
    // Track connection state for debounced notifications
    private _wasConnectedOnce: boolean = false;
    private _connectionStateDebounceTimer?: ReturnType<typeof setTimeout>;
    private _pendingDisconnectNotification: boolean = false;
    
    private _subscriptions: Map<string, StompSubscription> = new Map();
    private _subscriptionCounter: number = 0;
    private _sessionId: string = '';
    private _messageHandlers: WebSocketMessageHandler[] = [];
    private _connectionStateCallbacks: Map<string, (isConnected: boolean, wasEverConnected: boolean) => void> = new Map(); // CHANGED: Map for deduplication
    private _callbackIdCounter: number = 0;

    constructor(authManager: AuthManager) {
        this._authManager = authManager;
        this._sessionId = this._generateSecureSessionId();
    }

    /**
     * Generate a cryptographically secure session ID (12 hex characters)
     * Matches Artemis webapp implementation
     */
    private _generateSecureSessionId(): string {
        const bytes = new Uint8Array(6);
        // Use crypto.getRandomValues if available, otherwise fallback
        if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
            crypto.getRandomValues(bytes);
        } else {
            // Fallback for Node.js environment
            for (let i = 0; i < 6; i++) {
                bytes[i] = Math.floor(Math.random() * 256);
            }
        }
        return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
    }

    /**
     * Register a callback for connection state changes.
     * Returns an unsubscribe function to prevent memory leaks and callback accumulation.
     * 
     * IMPORTANT: Always call the returned unsubscribe function when done!
     * 
     * @returns Unsubscribe function
     */
    public onConnectionStateChange(callback: (isConnected: boolean, wasEverConnected?: boolean) => void): () => void {
        const callbackId = `cb_${++this._callbackIdCounter}`;
        this._connectionStateCallbacks.set(callbackId, callback);
        this._log(`Connection state callback registered: ${callbackId} (total: ${this._connectionStateCallbacks.size})`);
        
        // Immediately notify of current state
        callback(this._isConnected, this._wasConnectedOnce);
        
        // Return unsubscribe function
        return () => {
            this._connectionStateCallbacks.delete(callbackId);
            this._log(`Connection state callback unregistered: ${callbackId} (remaining: ${this._connectionStateCallbacks.size})`);
        };
    }

    /**
     * Register a message handler for WebSocket events
     */
    public registerMessageHandler(handler: WebSocketMessageHandler): void {
        this._messageHandlers.push(handler);
        this._log(`Message handler registered. Total handlers: ${this._messageHandlers.length}`);
    }

    /**
     * Check if the WebSocket is currently connected
     * Also attempts to ensure connection is valid
     */
    public isConnected(): boolean {
        return this._isConnected && this._client?.connected === true;
    }

    /**
     * Attempt to ensure WebSocket connection
     * Returns true if connected, false otherwise
     */
    public async ensureConnection(): Promise<boolean> {
        if (this.isConnected()) {
            return true;
        }

        this._log('⚠️ WebSocket not connected, attempting to reconnect...');
        try {
            await this.connect();
            return this.isConnected();
        } catch (error) {
            this._log(`❌ Failed to reconnect WebSocket: ${error instanceof Error ? error.message : 'Unknown error'}`);
            return false;
        }
    }

    /**
     * Calculate reconnect delay with exponential backoff.
     * Matches Artemis webapp: starts at 500ms, doubles each attempt, max 10s
     * (ReconnectionTimeMode.EXPONENTIAL behavior)
     */
    private _getReconnectDelay(): number {
        // Exponential backoff: 500ms * 2^attempts, capped at 10s
        const delay = Math.min(
            this._initialReconnectDelay * Math.pow(2, this._reconnectAttempts),
            this._maxReconnectDelay
        );
        return delay;
    }

    /**
     * Check if we can attempt a connection right now.
     * Enforces rate limiting and max attempts.
     */
    private _canAttemptConnection(): { allowed: boolean; reason?: string } {
        // Check if we gave up
        if (this._connectionGaveUp) {
            return { allowed: false, reason: 'Max connection attempts reached. Call resetConnectionState() to retry.' };
        }
        
        // Check if already connecting
        if (this._isConnecting) {
            return { allowed: false, reason: 'Connection already in progress' };
        }
        
        // Check if disconnecting
        if (this._isDisconnecting) {
            return { allowed: false, reason: 'Disconnect in progress' };
        }
        
        // Check rate limiting
        const now = Date.now();
        const timeSinceLastAttempt = now - this._lastConnectionAttempt;
        if (this._lastConnectionAttempt > 0 && timeSinceLastAttempt < MIN_CONNECTION_INTERVAL_MS) {
            return { 
                allowed: false, 
                reason: `Rate limited: ${MIN_CONNECTION_INTERVAL_MS - timeSinceLastAttempt}ms until next attempt` 
            };
        }
        
        // Check max attempts
        if (this._reconnectAttempts >= MAX_CONNECTION_ATTEMPTS) {
            this._connectionGaveUp = true;
            this._log(`🛑 MAX CONNECTION ATTEMPTS (${MAX_CONNECTION_ATTEMPTS}) REACHED - GIVING UP`);
            return { allowed: false, reason: `Max attempts (${MAX_CONNECTION_ATTEMPTS}) reached` };
        }
        
        return { allowed: true };
    }

    /**
     * Reset connection state to allow retrying after giving up.
     * Call this when user explicitly wants to reconnect.
     */
    public resetConnectionState(): void {
        this._log('Resetting connection state');
        this._reconnectAttempts = 0;
        this._connectionGaveUp = false;
        this._lastConnectionAttempt = 0;
    }

    /**
     * Connect to the Artemis WebSocket server.
     * 
     * SAFETY FEATURES:
     * 1. Mutex check FIRST (before any deactivation)
     * 2. Rate limiting (minimum 2s between attempts)
     * 3. Max attempts (20 attempts, then gives up)
     * 4. Proper error handling and state reset
     */
    public async connect(): Promise<void> {
        // SAFETY CHECK FIRST - before doing anything else!
        const canConnect = this._canAttemptConnection();
        if (!canConnect.allowed) {
            this._log(`⚠️ Connection blocked: ${canConnect.reason}`);
            return;
        }

        // Set mutex IMMEDIATELY
        this._isConnecting = true;
        this._lastConnectionAttempt = Date.now();

        try {
            // Now safe to deactivate existing connection
            if (this._client) {
                this._log('Deactivating existing connection before reconnect');
                // Temporarily set flag to prevent onDisconnected from triggering reconnect
                this._isDisconnecting = true;
                await this._client.deactivate();
                this._client = undefined;
                this._isDisconnecting = false;
            }

            const serverUrl = this._getServerUrl();
            this._log(`Connecting to Artemis WebSocket (attempt ${this._reconnectAttempts + 1}/${MAX_CONNECTION_ATTEMPTS})...`);

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

            // Configure STOMP client - matching Artemis webapp settings
            const currentReconnectDelay = this._getReconnectDelay();
            this._log(`Reconnect config: delay=${currentReconnectDelay}ms, timeout=${this._connectionTimeout}ms, heartbeat=${this._heartbeatInterval}ms`);

            // StompConfig type doesn't include all options, but they are supported at runtime
            // See: https://stomp-js.github.io/api-docs/latest/classes/Client.html
            const stompConfig: StompConfig & {
                connectionTimeout?: number;
                discardWebsocketOnCommFailure?: boolean;
            } = {
                brokerURL: wsUrl,
                connectHeaders: {},
                // Exponential backoff - STOMP library handles reconnection
                reconnectDelay: currentReconnectDelay,
                // Connection timeout - abort and retry after 10 seconds (matching webapp)
                connectionTimeout: this._connectionTimeout,
                // Heartbeat settings - must match server (10 seconds)
                heartbeatIncoming: this._heartbeatInterval,
                heartbeatOutgoing: this._heartbeatInterval,
                // Discard WebSocket on communication failure (matching webapp)
                discardWebsocketOnCommFailure: true,

                webSocketFactory: () => {
                    const ws = new WebSocket(wsUrl, {
                        headers: {
                            'Cookie': cookie,
                            'User-Agent': CONFIG.API.USER_AGENT
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

            this._client = this._createClient(stompConfig as StompConfig);
            this._client.activate();

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            this._onError(`Failed to connect to WebSocket: ${errorMessage}`);
            this._isConnecting = false;
            throw error;
        }
    }

    /**
     * Create a new STOMP client
     * Protected to allow mocking in tests
     */
    protected _createClient(config: StompConfig): Client {
        return new Client(config);
    }

    /**
     * Disconnect from the WebSocket server.
     * 
     * SAFETY: Sets _isDisconnecting flag to prevent onDisconnected from triggering reconnect.
     */
    public async disconnect(): Promise<void> {
        // Set flag to prevent reconnect loop
        this._isDisconnecting = true;
        
        // Clear any pending disconnect notification
        if (this._connectionStateDebounceTimer) {
            clearTimeout(this._connectionStateDebounceTimer);
            this._connectionStateDebounceTimer = undefined;
        }

        if (this._client) {
            this._log('Disconnecting from Artemis WebSocket (intentional)');

            // Unsubscribe from all topics
            this._subscriptions.forEach((subscription, topic) => {
                try {
                    subscription.unsubscribe();
                    this._log(`Unsubscribed from ${topic}`);
                } catch (e) {
                    this._log(`Error unsubscribing from ${topic}: ${e}`);
                }
            });
            this._subscriptions.clear();

            // Deactivate the client
            try {
                await this._client.deactivate();
            } catch (e) {
                this._log(`Error deactivating client: ${e}`);
            }
            this._client = undefined;
            this._isConnected = false;
            this._isConnecting = false;
            
            // Reset all state on intentional disconnect
            this._wasConnectedOnce = false;
            this._reconnectAttempts = 0;
            this._connectionGaveUp = false;
            this._lastConnectionAttempt = 0;
            this._subscriptionCounter = 0;
            this._pendingDisconnectNotification = false;
            this._sessionId = this._generateSecureSessionId();
        }
        
        this._isDisconnecting = false;
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
     * Subscribe to Iris chat session updates
     * Topic format: /user/topic/iris/{sessionId} for authenticated user-specific messages
     */
    public subscribeToIrisSession(sessionId: number, onMessage: (message: any) => void): () => void {
        if (!this._isConnected || !this._client) {
            this._log('Cannot subscribe: not connected');
            throw new Error('WebSocket not connected');
        }

        // Use /user/topic/ prefix for user-specific authenticated messages
        const topic = `/user/topic/iris/${sessionId}`;

        // Check if already subscribed
        if (this._subscriptions.has(topic)) {
            this._log(`Already subscribed to ${topic}`);
            // Return unsubscribe function for existing subscription
            return () => {
                const sub = this._subscriptions.get(topic);
                if (sub) {
                    sub.unsubscribe();
                    this._subscriptions.delete(topic);
                    this._log(`Unsubscribed from ${topic}`);
                }
            };
        }

        const subscription = this._client.subscribe(topic, (message: IMessage) => {
            try {
                this._log(`📨 Received WebSocket message for Iris session ${sessionId}`);
                const data = JSON.parse(message.body);
                this._log(`📦 Message data preview: ${JSON.stringify(data).substring(0, 200)}...`);
                this._log(`🔔 Invoking onMessage callback for session ${sessionId}`);
                onMessage(data);
                this._log(`✅ onMessage callback completed for session ${sessionId}`);
            } catch (error) {
                this._log(`❌ Error processing Iris message: ${error}`);
                console.error('[WebsocketLog] Full error:', error);
            }
        });

        this._subscriptions.set(topic, subscription);
        this._log(`✅ Subscribed to Iris session: ${topic}`);

        // Return unsubscribe function
        return () => {
            subscription.unsubscribe();
            this._subscriptions.delete(topic);
            this._log(`Unsubscribed from ${topic}`);
        };
    }

    /**
     * Unsubscribe from a specific Iris session
     */
    public unsubscribeFromIrisSession(sessionId: number): void {
        const topic = `/user/topic/iris/${sessionId}`;
        const subscription = this._subscriptions.get(topic);

        if (subscription) {
            subscription.unsubscribe();
            this._subscriptions.delete(topic);
            this._log(`Unsubscribed from ${topic}`);
        }
    }

    /**
     * Get connection status
     */
    public getStatus(): string {
        if (this._connectionGaveUp) {
            return `Disconnected (gave up after ${MAX_CONNECTION_ATTEMPTS} attempts)`;
        } else if (this._isDisconnecting) {
            return 'Disconnecting...';
        } else if (this._isConnecting) {
            return 'Connecting...';
        } else if (this._isConnected && this._client?.connected) {
            return `Connected (${this._subscriptions.size} subscriptions)`;
        } else if (this._pendingDisconnectNotification) {
            return `Reconnecting (attempt ${this._reconnectAttempts}/${MAX_CONNECTION_ATTEMPTS})...`;
        } else if (this._reconnectAttempts > 0) {
            const nextDelay = this._getReconnectDelay();
            return `Reconnecting in ${Math.round(nextDelay / 1000)}s (${this._reconnectAttempts}/${MAX_CONNECTION_ATTEMPTS})`;
        } else {
            return 'Disconnected';
        }
    }

    /**
     * Check if we gave up on reconnecting
     */
    public hasGivenUp(): boolean {
        return this._connectionGaveUp;
    }

    /**
     * Get detailed debugging information with async cookie check
     */
    public async getDebugInfoAsync(): Promise<{
        isConnected: boolean;
        isConnecting: boolean;
        isDisconnecting: boolean;
        wasConnectedOnce: boolean;
        connectionGaveUp: boolean;
        clientConnected: boolean;
        clientActive: boolean;
        subscriptionCount: number;
        subscriptions: string[];
        callbackCount: number;
        reconnectAttempts: number;
        maxReconnectAttempts: number;
        currentReconnectDelay: number;
        sessionId: string;
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
            isConnecting: this._isConnecting,
            isDisconnecting: this._isDisconnecting,
            wasConnectedOnce: this._wasConnectedOnce,
            connectionGaveUp: this._connectionGaveUp,
            clientConnected: this._client?.connected || false,
            clientActive: this._client?.active || false,
            subscriptionCount: this._subscriptions.size,
            subscriptions: Array.from(this._subscriptions.keys()),
            callbackCount: this._connectionStateCallbacks.size,
            reconnectAttempts: this._reconnectAttempts,
            maxReconnectAttempts: MAX_CONNECTION_ATTEMPTS,
            currentReconnectDelay: this._getReconnectDelay(),
            sessionId: this._sessionId,
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
     * Dispose and cleanup.
     * Clears all callbacks, timers, and disconnects.
     */
    public dispose(): void {
        this._log('Disposing WebSocket service');
        
        // Clear all callbacks to prevent memory leaks
        this._connectionStateCallbacks.clear();
        this._messageHandlers = [];
        
        if (this._connectionStateDebounceTimer) {
            clearTimeout(this._connectionStateDebounceTimer);
            this._connectionStateDebounceTimer = undefined;
        }
        this.disconnect();
    }

    // Private helper methods

    private _onConnected(): void {
        // SAFETY: Don't process if we're in the middle of disconnecting
        if (this._isDisconnecting) {
            this._log('Ignoring onConnected during disconnect');
            return;
        }
        
        this._isConnected = true;
        this._isConnecting = false;
        this._reconnectAttempts = 0; // Reset on successful connection
        this._connectionGaveUp = false; // Allow future reconnects
        this._wasConnectedOnce = true;
        
        // Cancel any pending disconnect notification
        if (this._connectionStateDebounceTimer) {
            clearTimeout(this._connectionStateDebounceTimer);
            this._connectionStateDebounceTimer = undefined;
            this._pendingDisconnectNotification = false;
        }
        
        this._log('✅ Connected to Artemis WebSocket');

        // Immediately notify of connection (no delay for connect events)
        this._notifyConnectionStateChange(true);

        // Auto-subscribe to personal topics
        this.subscribeToPersonalResults();
        this.subscribeToPersonalSubmissions();
        this.subscribeToSubmissionProcessing();
    }

    /**
     * Handle WebSocket disconnection.
     * 
     * SAFETY FEATURES:
     * 1. Ignores disconnect events during intentional disconnect
     * 2. Debounces disconnect notifications (5s)
     * 3. Tracks reconnect attempts with max limit
     * 4. Does NOT call connect() - STOMP library handles reconnection
     */
    private _onDisconnected(): void {
        // SAFETY: Don't process if we're intentionally disconnecting
        if (this._isDisconnecting) {
            this._log('Ignoring onDisconnected during intentional disconnect');
            return;
        }
        
        this._isConnected = false;
        // NOTE: Do NOT reset _isConnecting here - it's managed by connect()
        this._subscriptions.clear();
        this._log('Disconnected from Artemis WebSocket');

        // Debounce disconnect notification (5 seconds grace period)
        if (!this._pendingDisconnectNotification) {
            this._pendingDisconnectNotification = true;
            this._connectionStateDebounceTimer = setTimeout(() => {
                if (!this._isConnected && !this._isDisconnecting) {
                    this._log('Disconnect grace period elapsed, notifying consumers');
                    this._notifyConnectionStateChange(false);
                }
                this._pendingDisconnectNotification = false;
            }, CONNECTION_STATE_DELAY_MS);
        }

        // Track reconnect attempts for logging and max limit
        this._reconnectAttempts++;
        
        if (this._reconnectAttempts >= MAX_CONNECTION_ATTEMPTS) {
            this._connectionGaveUp = true;
            this._log(`🛑 MAX RECONNECTION ATTEMPTS (${MAX_CONNECTION_ATTEMPTS}) REACHED`);
            this._notifyConnectionStateChange(false);
        } else {
            const nextDelay = this._getReconnectDelay();
            this._log(`STOMP will attempt reconnection with delay: ${nextDelay}ms (attempt ${this._reconnectAttempts}/${MAX_CONNECTION_ATTEMPTS})`);
        }
        
        // IMPORTANT: We do NOT call connect() here!
        // The STOMP library handles automatic reconnection.
        // Calling connect() here would cause the reconnection loop bug.
    }

    /**
     * Notify all registered callbacks of connection state change.
     */
    private _notifyConnectionStateChange(isConnected: boolean): void {
        const callbackCount = this._connectionStateCallbacks.size;
        this._log(`Notifying ${callbackCount} callbacks: connected=${isConnected}`);
        
        this._connectionStateCallbacks.forEach((callback, id) => {
            try {
                callback(isConnected, this._wasConnectedOnce);
            } catch (error) {
                this._log(`Error in connection state callback ${id}: ${error}`);
            }
        });
    }

    private _onError(message: string): void {
        this._log(`❌ ${message}`);
        console.error(`[WebsocketLog] ERROR: ${message}`);
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
        console.log(`[WebsocketLog] ${message}`);
    }
}
