import { Client, StompConfig, StompSubscription, IFrame, IMessage, ReconnectionTimeMode } from '@stomp/stompjs';
import WebSocket from 'ws';
import * as vscode from 'vscode';
import { AuthManager } from '../../auth';
import { CONFIG, VSCODE_CONFIG, WEBSOCKET_TOPICS } from '../../utils';
import { logger, LogCategory } from '../loggingService';
import {
    ResultDTO,
    ProgrammingSubmission,
    SubmissionProcessingMessage,
    WebSocketMessageHandler
} from '../../types';

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
    private _connectionGeneration: number = 0; // Monotonic token to detect stale connect() continuations
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
    private _connectionStateCallbacks: Map<string, (isConnected: boolean, wasEverConnected: boolean) => void> = new Map();
    private _callbackIdCounter: number = 0;

    // connect() promise resolution — allows callers to await actual connection
    private _connectPromise?: Promise<void>;
    private _connectResolve?: () => void;
    private _connectReject?: (err: Error) => void;
    private _connectTimeout?: ReturnType<typeof setTimeout>;

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
        if (this._messageHandlers.includes(handler)) { return; }
        this._messageHandlers.push(handler);
        this._log(`Message handler registered. Total handlers: ${this._messageHandlers.length}`);
    }

    /**
     * Unregister a previously registered message handler
     */
    public unregisterMessageHandler(handler: WebSocketMessageHandler): void {
        const index = this._messageHandlers.indexOf(handler);
        if (index !== -1) {
            this._messageHandlers.splice(index, 1);
        }
    }

    /**
     * Check if the WebSocket is currently connected
     * Also attempts to ensure connection is valid
     */
    public isConnected(): boolean {
        return this._isConnected && this._client?.connected === true;
    }

    /**
     * Get the current number of reconnect attempts.
     * Used by WebSocketStatusBarService to show live attempt counter.
     */
    public get reconnectAttempts(): number {
        return this._reconnectAttempts;
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
     *
     * NOTE: This is approximate and used for display/logging only.
     * The STOMP library manages the actual reconnection timing.
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
            this._log(`Connection blocked: ${canConnect.reason}`);
            if (this._connectPromise) {
                return this._connectPromise;  // Piggyback on in-flight connect
            }
            throw new Error(`Connection blocked: ${canConnect.reason}`);
        }

        // Set mutex IMMEDIATELY
        this._isConnecting = true;
        this._lastConnectionAttempt = Date.now();
        const generation = ++this._connectionGeneration;

        // Create promise BEFORE async work so concurrent callers can share it
        this._connectPromise = new Promise<void>((resolve, reject) => {
            this._connectResolve = resolve;
            this._connectReject = reject;
            this._connectTimeout = setTimeout(() => {
                this._rejectConnect(new Error('Connection timed out'));
                this._isConnecting = false;
            }, this._connectionTimeout);
        });

        try {
            // Now safe to deactivate existing connection
            if (this._client) {
                this._log('Deactivating existing connection before reconnect');
                // Temporarily set flag to prevent onDisconnected from triggering reconnect
                this._isDisconnecting = true;
                try {
                    await this._client.deactivate();
                } finally {
                    this._isDisconnecting = false;
                }
                this._subscriptions.clear();
                this._client = undefined;
            }

            if (this._connectionGeneration !== generation) {
                this._log('Connection aborted: superseded by disconnect/newer connect');
                return this._connectPromise;
            }

            const serverUrl = this._getServerUrl();
            this._log(`Connecting to Artemis WebSocket (attempt ${this._reconnectAttempts + 1}/${MAX_CONNECTION_ATTEMPTS})...`);

            const cookie = await this._authManager.getCookieHeader();

            if (this._connectionGeneration !== generation) {
                this._log('Connection aborted: superseded by disconnect/newer connect');
                return this._connectPromise;
            }

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

            const stompConfig: StompConfig = {
                brokerURL: wsUrl,
                connectHeaders: {},
                // Exponential backoff - STOMP library handles reconnection
                reconnectDelay: currentReconnectDelay,
                reconnectTimeMode: ReconnectionTimeMode.EXPONENTIAL,
                maxReconnectDelay: this._maxReconnectDelay,
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

                    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-return -- STOMP library expects generic WebSocket type
                    return ws as any;
                },

                onConnect: () => {
                    this._onConnected();
                },

                onStompError: (frame: IFrame) => {
                    const body = frame.body ? ` body=${frame.body.substring(0, 500)}` : '';
                    this._onError(`STOMP error: ${frame.headers['message']}${body}`);
                },

                // eslint-disable-next-line @typescript-eslint/no-explicit-any -- STOMP library onWebSocketError uses generic event type
                onWebSocketError: (event: any) => {
                    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment -- event shape is untyped
                    const detail = event?.message || event?.type || 'unknown';
                    this._onError(`WebSocket error: ${detail}`);
                },

                onDisconnect: () => {
                    this._onDisconnected();
                },

                onWebSocketClose: () => {
                    this._onDisconnected();
                }
            };

            this._client = this._createClient(stompConfig);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            this._onError(`Failed to connect to WebSocket: ${errorMessage}`);
            this._isConnecting = false;
            throw error;
        }

        this._client.activate();
        return this._connectPromise;
    }

    /**
     * Create a new STOMP client
     * Protected to allow mocking in tests
     */
    protected _createClient(config: StompConfig): Client {
        return new Client(config);
    }

    /** Resolve the pending connect() promise and clear timeout */
    private _resolveConnect(): void {
        if (this._connectTimeout) {
            clearTimeout(this._connectTimeout);
            this._connectTimeout = undefined;
        }
        const resolve = this._connectResolve;
        this._connectResolve = undefined;
        this._connectReject = undefined;
        this._connectPromise = undefined;
        resolve?.();
    }

    /** Reject the pending connect() promise and clear timeout */
    private _rejectConnect(err: Error): void {
        if (this._connectTimeout) {
            clearTimeout(this._connectTimeout);
            this._connectTimeout = undefined;
        }
        const reject = this._connectReject;
        this._connectResolve = undefined;
        this._connectReject = undefined;
        this._connectPromise = undefined;
        reject?.(err);
    }

    /**
     * Disconnect from the WebSocket server.
     * 
     * SAFETY: Sets _isDisconnecting flag to prevent onDisconnected from triggering reconnect.
     */
    public async disconnect(): Promise<void> {
        // Invalidate any in-flight connect() continuation
        this._connectionGeneration++;
        // Set flag to prevent reconnect loop
        this._isDisconnecting = true;

        // Clear any pending connect promise
        this._rejectConnect(new Error('Disconnected'));

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

            // Notify consumers BEFORE resetting wasConnectedOnce so they see (false, true)
            this._notifyConnectionStateChange(false);

            // Reset all state on intentional disconnect
            this._wasConnectedOnce = false;
            this._reconnectAttempts = 0;
            this._connectionGaveUp = false;
            this._lastConnectionAttempt = 0;
            this._subscriptionCounter = 0;
            this._pendingDisconnectNotification = false;
            this._sessionId = this._generateSecureSessionId();
        }

        this._isConnecting = false;  // Always clear, even if _client was null
        this._isDisconnecting = false;
    }

    /**
     * Generic topic subscription with connection/duplicate guards, JSON parsing,
     * handler dispatch, and structured logging.
     */
    private _subscribeToTopic<T>(
        topic: string,
        parser: (data: unknown) => T,
        dispatch: (handler: WebSocketMessageHandler, parsed: T) => void,
        logFormatter: (parsed: T) => string,
    ): void {
        if (!this._isConnected || !this._client) {
            this._log('Cannot subscribe: not connected');
            return;
        }

        if (this._subscriptions.has(topic)) {
            this._log(`Already subscribed to ${topic}`);
            return;
        }

        const subscription = this._client.subscribe(topic, (message: IMessage) => {
            try {
                const parsed = parser(JSON.parse(message.body));
                this._log(logFormatter(parsed));
                [...this._messageHandlers].forEach(handler => dispatch(handler, parsed));
            } catch (error) {
                const stack = error instanceof Error ? error.stack : String(error);
                this._log(`Error processing message on ${topic}: ${stack}`);
            }
        });

        this._subscriptions.set(topic, subscription);
        this._log(`Subscribed to ${topic}`);
    }

    /**
     * Subscribe to personal result updates for the authenticated user
     */
    public subscribeToPersonalResults(): void {
        this._subscribeToTopic(
            WEBSOCKET_TOPICS.NEW_RESULTS,
            (data) => ResultDTO.fromJSON(data),
            (handler, result) => handler.onNewResult?.(result),
            (result) => `Received new result: score=${result.score}, successful=${result.successful}`,
        );
    }

    /**
     * Subscribe to personal submission updates
     */
    public subscribeToPersonalSubmissions(): void {
        this._subscribeToTopic(
            WEBSOCKET_TOPICS.NEW_SUBMISSIONS,
            (data) => ProgrammingSubmission.fromJSON(data),
            (handler, submission) => handler.onNewSubmission?.(submission),
            (submission) => `Received new submission: ${submission.id}`,
        );
    }

    /**
     * Subscribe to submission processing updates (build status)
     */
    public subscribeToSubmissionProcessing(): void {
        this._subscribeToTopic(
            WEBSOCKET_TOPICS.SUBMISSION_PROCESSING,
            (data) => SubmissionProcessingMessage.fromJSON(data),
            (handler, msg) => handler.onSubmissionProcessing?.(msg),
            (msg) => `Received submission processing update: participationId=${msg.participationId}`,
        );
    }

    /**
     * Subscribe to Iris chat session updates
     * Topic format: /user/topic/iris/{sessionId} for authenticated user-specific messages
     */
    public subscribeToIrisSession(sessionId: number, onMessage: (message: unknown) => void): () => void {
        if (!this._isConnected || !this._client) {
            this._log('Cannot subscribe: not connected');
            throw new Error('WebSocket not connected');
        }

        // Use /user/topic/ prefix for user-specific authenticated messages
        const topic = WEBSOCKET_TOPICS.irisSession(sessionId);

        // Replace stale subscription if one exists (e.g. after reconnect)
        if (this._subscriptions.has(topic)) {
            this._log(`Replacing existing subscription for ${topic}`);
            const oldSub = this._subscriptions.get(topic);
            try { oldSub?.unsubscribe(); } catch { /* stale sub, ignore */ }
            this._subscriptions.delete(topic);
        }

        const subscription = this._client.subscribe(topic, (message: IMessage) => {
            try {
                this._log(`📨 Received WebSocket message for Iris session ${sessionId}`);
                const data: unknown = JSON.parse(message.body);
                this._log(`📦 Message data preview: ${JSON.stringify(data).substring(0, 200)}...`);
                this._log(`🔔 Invoking onMessage callback for session ${sessionId}`);
                onMessage(data);
                this._log(`✅ onMessage callback completed for session ${sessionId}`);
            } catch (error) {
                const stack = error instanceof Error ? error.stack : String(error);
                this._log(`Error processing Iris message: ${stack}`);
                logger.error('Full error processing Iris message', LogCategory.WEBSOCKET, error as Error);
            }
        });

        this._subscriptions.set(topic, subscription);
        this._log(`✅ Subscribed to Iris session: ${topic}`);

        // Return unsubscribe function — capture ref to guard against stale closures
        const capturedSub = subscription;
        return () => {
            capturedSub.unsubscribe();
            if (this._subscriptions.get(topic) === capturedSub) {
                this._subscriptions.delete(topic);
            }
            this._log(`Unsubscribed from ${topic}`);
        };
    }

    /**
     * Unsubscribe from a specific Iris session
     */
    public unsubscribeFromIrisSession(sessionId: number): void {
        const topic = WEBSOCKET_TOPICS.irisSession(sessionId);
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
        void this.disconnect().catch(err => this._log(`Error during disconnect in dispose: ${err}`));
        this._connectionStateCallbacks.clear();
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

        // Resolve the connect() promise so callers know the socket is usable
        this._resolveConnect();

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
        // WebSocket close during handshake: _isConnected is still false but
        // _isConnecting is true. Reject the pending connect() promise immediately
        // instead of swallowing the event and letting the timeout expire.
        if (!this._isConnected && this._isConnecting) {
            this._reconnectAttempts++;
            this._rejectConnect(new Error('WebSocket closed during connection'));
            this._isConnecting = false;
            if (this._reconnectAttempts >= MAX_CONNECTION_ATTEMPTS) {
                this._connectionGaveUp = true;
                this._log(`MAX CONNECTION ATTEMPTS (${MAX_CONNECTION_ATTEMPTS}) REACHED during handshake`);
                this._notifyConnectionStateChange(false);
                if (this._client) {
                    this._isDisconnecting = true;
                    void this._client.deactivate({ force: true }).finally(() => {
                        this._isDisconnecting = false;
                    });
                }
            }
            return;
        }

        // Idempotency: if already disconnected, don't double-process
        // (both onDisconnect and onWebSocketClose may fire for the same event)
        if (!this._isConnected) { return; }

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
            // Cancel debounce timer to prevent double notification
            if (this._connectionStateDebounceTimer) {
                clearTimeout(this._connectionStateDebounceTimer);
                this._connectionStateDebounceTimer = undefined;
                this._pendingDisconnectNotification = false;
            }
            this._connectionGaveUp = true;
            this._log(`🛑 MAX RECONNECTION ATTEMPTS (${MAX_CONNECTION_ATTEMPTS}) REACHED`);
            this._notifyConnectionStateChange(false);
            // Stop STOMP's internal reconnection loop
            if (this._client) {
                this._isDisconnecting = true;
                void this._client.deactivate({ force: true }).finally(() => {
                    this._isDisconnecting = false;
                });
            }
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

        const snapshot = new Map(this._connectionStateCallbacks);
        snapshot.forEach((callback, id) => {
            try {
                callback(isConnected, this._wasConnectedOnce);
            } catch (error) {
                this._log(`Error in connection state callback ${id}: ${error}`);
            }
        });
    }

    private _onError(message: string): void {
        this._log(`❌ ${message}`);
        logger.error(message, LogCategory.WEBSOCKET);
        // Reject the connect() promise if pending
        this._rejectConnect(new Error(message));
        this._isConnecting = false;
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
        logger.websocket(message);
    }
}
