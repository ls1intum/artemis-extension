import { Client, StompConfig, StompSubscription, IFrame, IMessage, ReconnectionTimeMode } from '@stomp/stompjs';
import WebSocket from 'ws';
import * as vscode from 'vscode';
import { AuthManager } from '../auth';
import { CONFIG, WEBSOCKET_TOPICS, resolveServerUrl, getUserAgent } from '../../utils';
import { logger, LogCategory } from '../loggingService';
import {
    parseResultDTO,
    parseProgrammingSubmission,
    parseSubmissionProcessingMessage,
} from '../../types';
import type { WebSocketMessageHandler } from '../../types';
import type { ConnectionState } from './connectionState';
import { deriveDisplayStatus } from './displayStatus';
import type { WebSocketDisplayStatus } from '../../../shared/messageContracts';

interface Deferred<T> {
    promise: Promise<T>;
    resolve: (value: T) => void;
    reject: (error: Error) => void;
}

function createDeferred<T>(): Deferred<T> {
    let resolve!: (value: T) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

const SAFETY_TIMEOUT_MS = 15000;

/** Matches Artemis webapp CONNECTION_STATE_DELAY_MS. */
const CONNECTION_STATE_DELAY_MS = 5000;

const MAX_CONNECTION_ATTEMPTS = 20;

const INITIAL_RECONNECT_DELAY_MS = 500;
const MAX_RECONNECT_DELAY_MS = 10000;
const CONNECTION_TIMEOUT_MS = 10000;
const HEARTBEAT_INTERVAL_MS = 10000;

/**
 * Manages STOMP/WebSocket connections to Artemis for real-time updates
 * (submissions, results, build status, Iris chat).
 */
export class ArtemisWebsocketService {
    private _client?: Client;
    private _authManager: AuthManager;
    private _connectionState: ConnectionState = 'disconnected';
    private _connectionGeneration: number = 0;
    private _reconnectAttempts: number = 0;
    private _disconnectCountedThisAttempt = false;

    private _wasConnectedOnce: boolean = false;
    private _connectionStateDebounceTimer?: ReturnType<typeof setTimeout>;

    private _subscriptions: Map<string, StompSubscription> = new Map();
    private _sessionId: string = '';
    private _messageHandlers: WebSocketMessageHandler[] = [];

    private readonly _onDidChangeConnectionState = new vscode.EventEmitter<{ connected: boolean; wasEverConnected: boolean }>();
    public readonly onDidChangeConnectionState = this._onDidChangeConnectionState.event;

    private _connectDeferred?: Deferred<void>;
    private _safetyTimeout?: ReturnType<typeof setTimeout>;

    constructor(authManager: AuthManager) {
        this._authManager = authManager;
        this._sessionId = this._generateSecureSessionId();
    }

    private _generateSecureSessionId(): string {
        const bytes = new Uint8Array(6);
        crypto.getRandomValues(bytes);
        return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
    }

    /** Register a message handler for WebSocket events. */
    public registerMessageHandler(handler: WebSocketMessageHandler): void {
        if (this._messageHandlers.includes(handler)) { return; }
        this._messageHandlers.push(handler);
        this._log(`Message handler registered. Total handlers: ${this._messageHandlers.length}`);
    }

    /** Unregister a previously registered message handler. */
    public unregisterMessageHandler(handler: WebSocketMessageHandler): void {
        const index = this._messageHandlers.indexOf(handler);
        if (index !== -1) {
            this._messageHandlers.splice(index, 1);
        }
    }

    /** Check if the WebSocket is currently connected. */
    public isConnected(): boolean {
        return this._connectionState === 'connected' && this._client?.connected === true;
    }

    /** Current number of reconnect attempts. */
    public get reconnectAttempts(): number {
        return this._reconnectAttempts;
    }

    /** Reset connection state to allow retrying after giving up. */
    public resetConnectionState(): void {
        this._log('Resetting connection state');
        this._reconnectAttempts = 0;
        this._transitionTo('disconnected');
    }

    /** Connect to the Artemis WebSocket server. */
    public async connect(): Promise<void> {
        const reuse = this._maybeReuseInflightConnect();
        if (reuse !== undefined) { return reuse; }

        this._transitionTo('connecting');
        // Generation bumped before deactivation so old lifecycle callbacks are ignored
        const generation = ++this._connectionGeneration;

        this._connectDeferred = createDeferred<void>();
        this._startSafetyTimeout();

        try {
            await this._teardownExistingClient();
            const { authHeaders, wsUrl } = await this._prepareConnectionContext();
            this._client = this._createClient(this._buildStompConfig(generation, authHeaders, wsUrl));
        } catch (error) {
            this._handleConnectError(error);
            throw error;
        }

        if (this._connectionGeneration !== generation) {
            this._log('Connection aborted: superseded by newer connect/disconnect');
            this._transitionTo('disconnected');
            throw new Error('Connection aborted: superseded by newer connect/disconnect');
        }

        this._client.activate();
        return this._connectDeferred.promise;
    }

    /**
     * If a connect is already in flight (or the STOMP client is mid-handshake),
     * return the existing deferred so callers join the running attempt instead
     * of stomping on it. Returns `undefined` when a fresh attempt is required.
     * Throws for unrecoverable states (`disconnecting`, `gave-up`, stale
     * `connecting` without a deferred).
     */
    private _maybeReuseInflightConnect(): Promise<void> | undefined {
        if (this._connectionState === 'connecting') {
            if (this._connectDeferred) { return this._connectDeferred.promise; }
            throw new Error('Connection attempt already timed out');
        }
        if (this._connectionState === 'disconnecting') {
            throw new Error('Disconnect in progress');
        }
        if (this._connectionState === 'gave-up') {
            throw new Error('Max attempts reached. Call resetConnectionState() to retry.');
        }
        if (this._client?.active && !this._client.connected) {
            if (!this._connectDeferred) {
                this._connectDeferred = createDeferred<void>();
                this._startSafetyTimeout();
            }
            return this._connectDeferred.promise;
        }
        return undefined;
    }

    /** Tear down a prior STOMP client before reconnecting. */
    private async _teardownExistingClient(): Promise<void> {
        if (!this._client) { return; }
        this._log('Deactivating existing connection before reconnect');
        await this._client.deactivate();
        this._clearSubscriptions();
        this._client = undefined;
    }

    /**
     * Resolve server URL, fetch auth headers, validate them, and derive the
     * WebSocket URL. Throws if there is no usable cookie/JWT — this is the
     * auth pre-flight check that keeps the connection from racing into a
     * 4xx-only loop.
     */
    private async _prepareConnectionContext(): Promise<{ authHeaders: Record<string, string>; wsUrl: string }> {
        const serverUrl = resolveServerUrl();
        this._log(`Connecting to Artemis WebSocket (attempt ${this._reconnectAttempts + 1}/${MAX_CONNECTION_ATTEMPTS})...`);

        const authHeaders = await this._authManager.getAuthHeaders();
        if (Object.keys(authHeaders).length === 0) {
            const errorMsg = 'No authentication cookie available. Please log in first.';
            this._log(`⚠️ ${errorMsg}`);
            throw new Error(errorMsg);
        }

        // Validation only: the JWT itself isn't forwarded as a STOMP connect
        // header (connectHeaders stays empty); we just want to fail fast when
        // the cookie carries no usable token.
        if (!this._extractJwtFromHeaders(authHeaders)) {
            const errorMsg = 'Failed to extract JWT token from auth headers';
            this._log(`⚠️ ${errorMsg}`);
            throw new Error(errorMsg);
        }

        const wsUrl = this._buildWebSocketUrl(serverUrl);
        this._log(`Connecting to ${wsUrl}`);
        return { authHeaders, wsUrl };
    }

    private _buildStompConfig(
        generation: number,
        authHeaders: Record<string, string>,
        wsUrl: string,
    ): StompConfig {
        this._log(`Reconnect config: delay=${INITIAL_RECONNECT_DELAY_MS}ms, timeout=${CONNECTION_TIMEOUT_MS}ms, heartbeat=${HEARTBEAT_INTERVAL_MS}ms`);

        return {
            brokerURL: wsUrl,
            connectHeaders: {},
            reconnectDelay: INITIAL_RECONNECT_DELAY_MS,
            reconnectTimeMode: ReconnectionTimeMode.EXPONENTIAL,
            maxReconnectDelay: MAX_RECONNECT_DELAY_MS,
            connectionTimeout: CONNECTION_TIMEOUT_MS,
            // Must match Artemis server heartbeat (10s)
            heartbeatIncoming: HEARTBEAT_INTERVAL_MS,
            heartbeatOutgoing: HEARTBEAT_INTERVAL_MS,
            discardWebsocketOnCommFailure: true,

            webSocketFactory: () => {
                this._disconnectCountedThisAttempt = false;
                const ws = new WebSocket(wsUrl, {
                    headers: {
                        ...authHeaders,
                        'User-Agent': getUserAgent(),
                    },
                });

                ws.on('error', (err) => {
                    this._log(`WebSocket error: ${err.message}`);
                });

                // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-return -- STOMP library expects generic WebSocket type
                return ws as any;
            },

            onConnect: () => {
                if (this._connectionGeneration !== generation) { return; }
                this._onConnected();
            },

            onStompError: (frame: IFrame) => {
                if (this._connectionGeneration !== generation) { return; }
                const body = frame.body ? ` body=${frame.body.substring(0, 500)}` : '';
                this._onError(`STOMP error: ${frame.headers['message']}${body}`);
            },

            // eslint-disable-next-line @typescript-eslint/no-explicit-any -- STOMP library onWebSocketError uses generic event type
            onWebSocketError: (event: any) => {
                if (this._connectionGeneration !== generation) { return; }
                // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment -- event shape is untyped
                const detail = event?.message || event?.type || 'unknown';
                this._onError(`WebSocket error: ${detail}`);
            },

            onDisconnect: () => {
                if (this._connectionGeneration !== generation) { return; }
                this._onDisconnected();
            },

            onWebSocketClose: () => {
                if (this._connectionGeneration !== generation) { return; }
                this._onDisconnected();
            },
        };
    }

    /**
     * Common cleanup for the `connect()` catch path. Settling the deferred
     * matters because a concurrent `connect()` that joined while we awaited
     * `deactivate()` (via `_maybeReuseInflightConnect`) is awaiting the same
     * promise; failing to reject it would orphan that caller forever.
     */
    private _handleConnectError(error: unknown): void {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        this._log(`❌ Failed to connect to WebSocket: ${errorMessage}`);
        logger.error(`Failed to connect to WebSocket: ${errorMessage}`, LogCategory.WEBSOCKET);
        this._clearSubscriptions();
        this._transitionTo('disconnected');
        const settleError = error instanceof Error ? error : new Error(String(error));
        this._settleDeferred(settleError);
    }

    protected _createClient(config: StompConfig): Client {
        return new Client(config);
    }

    private _startSafetyTimeout(): void {
        this._safetyTimeout = setTimeout(() => {
            this._safetyTimeout = undefined;
            if (!this._connectDeferred) { return; }
            this._connectDeferred.reject(new Error('Connection timed out'));
            this._connectDeferred = undefined;
            this._transitionTo('disconnected');
        }, SAFETY_TIMEOUT_MS);
    }

    private _settleDeferred(outcome: 'resolve' | Error): void {
        if (this._safetyTimeout) {
            clearTimeout(this._safetyTimeout);
            this._safetyTimeout = undefined;
        }
        const deferred = this._connectDeferred;
        this._connectDeferred = undefined;
        if (!deferred) { return; }
        if (outcome === 'resolve') {
            deferred.resolve();
        } else {
            // Attach a fallback catch BEFORE rejecting so the rejection is
            // considered handled even when no external caller is awaiting
            // this deferred (e.g. the catch path of `connect()` throws
            // directly and no parallel `connect()` ever attached an awaiter).
            // External awaiters still observe the rejection via their own await.
            deferred.promise.catch(() => { /* defensive no-op */ });
            deferred.reject(outcome);
        }
    }

    /** Disconnect from the WebSocket server. */
    public async disconnect(): Promise<void> {
        this._connectionGeneration++;
        this._transitionTo('disconnecting');
        this._settleDeferred(new Error('Disconnected'));

        if (this._connectionStateDebounceTimer) {
            clearTimeout(this._connectionStateDebounceTimer);
            this._connectionStateDebounceTimer = undefined;
        }

        if (this._client) {
            this._log('Disconnecting from Artemis WebSocket (intentional)');
            this._clearSubscriptions();

            try {
                await this._client.deactivate();
            } catch (e) {
                this._log(`Error deactivating client: ${e}`);
            }
            this._client = undefined;

            // Fire before resetting wasConnectedOnce so consumers see (false, true)
            this._onDidChangeConnectionState.fire({ connected: false, wasEverConnected: this._wasConnectedOnce });

            this._wasConnectedOnce = false;
            this._reconnectAttempts = 0;
            this._sessionId = this._generateSecureSessionId();
        }

        this._transitionTo('disconnected');
    }

    private _subscribeToTopic<T>(
        topic: string,
        parser: (data: unknown) => T,
        dispatch: (handler: WebSocketMessageHandler, parsed: T) => void,
        logFormatter: (parsed: T) => string,
    ): void {
        if (this._connectionState !== 'connected' || !this._client) {
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

    /** Subscribe to personal result updates for the authenticated user. */
    public subscribeToPersonalResults(): void {
        this._subscribeToTopic(
            WEBSOCKET_TOPICS.NEW_RESULTS,
            (data) => parseResultDTO(data),
            (handler, result) => handler.onNewResult?.(result),
            (result) => `Received new result: score=${result.score}, successful=${result.successful}`,
        );
    }

    /** Subscribe to personal submission updates. */
    public subscribeToPersonalSubmissions(): void {
        this._subscribeToTopic(
            WEBSOCKET_TOPICS.NEW_SUBMISSIONS,
            (data) => parseProgrammingSubmission(data),
            (handler, submission) => handler.onNewSubmission?.(submission),
            (submission) => `Received new submission: ${submission.id}`,
        );
    }

    /** Subscribe to submission processing updates (build status). */
    public subscribeToSubmissionProcessing(): void {
        this._subscribeToTopic(
            WEBSOCKET_TOPICS.SUBMISSION_PROCESSING,
            (data) => parseSubmissionProcessingMessage(data),
            (handler, msg) => handler.onSubmissionProcessing?.(msg),
            (msg) => `Received submission processing update: participationId=${msg.participationId}`,
        );
    }

    /** Subscribe to Iris chat session updates for the given session ID. */
    public subscribeToIrisSession(sessionId: number, onMessage: (message: unknown) => void): () => void {
        if (this._connectionState !== 'connected' || !this._client) {
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
                const data: unknown = JSON.parse(message.body);
                this._log(`Received Iris message for session ${sessionId}`);
                onMessage(data);
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

    /** Public read-only accessor for connection state. */
    public get connectionState(): ConnectionState {
        return this._connectionState;
    }

    /** Derived UI status for consumers (status bar, chat webview). */
    public getDisplayStatus(): WebSocketDisplayStatus {
        const baseStatus = deriveDisplayStatus(this._connectionState, this._wasConnectedOnce);

        if (baseStatus === 'connected' || baseStatus === 'disconnected') {
            return baseStatus;
        }

        // Only report 'connecting'/'reconnecting' if STOMP is actively retrying
        const stompTrying = this._client?.active === true;
        const inFlightConnectingState = this._connectionState === 'connecting';
        if (!stompTrying && !inFlightConnectingState) {
            return 'disconnected';
        }
        return baseStatus;
    }

    /** Synchronous diagnostics snapshot for debugging and status display. */
    public getDiagnostics(): {
        clientConnected: boolean;
        clientActive: boolean;
        subscriptionCount: number;
        subscriptions: string[];
        reconnectAttempts: number;
        maxReconnectAttempts: number;
        sessionId: string;
        serverUrl: string;
        websocketUrl: string;
    } {
        const serverUrl = resolveServerUrl();
        return {
            clientConnected: this._client?.connected ?? false,
            clientActive: this._client?.active ?? false,
            subscriptionCount: this._subscriptions.size,
            subscriptions: Array.from(this._subscriptions.keys()),
            reconnectAttempts: this._reconnectAttempts,
            maxReconnectAttempts: MAX_CONNECTION_ATTEMPTS,
            sessionId: this._sessionId,
            serverUrl,
            websocketUrl: this._buildWebSocketUrl(serverUrl),
        };
    }

    /** Dispose and cleanup. */
    public dispose(): void {
        this._log('Disposing WebSocket service');
        this._onDidChangeConnectionState.dispose();
        this._messageHandlers = [];

        if (this._connectionStateDebounceTimer) {
            clearTimeout(this._connectionStateDebounceTimer);
            this._connectionStateDebounceTimer = undefined;
        }
        void this.disconnect().catch(err => this._log(`Error during disconnect in dispose: ${err}`));
    }

    // Private helper methods

    private _clearSubscriptions(): void {
        this._subscriptions.forEach((subscription, topic) => {
            try {
                subscription.unsubscribe();
                this._log(`Unsubscribed from ${topic}`);
            } catch {
                // Stale subscription after disconnect — safe to ignore
            }
        });
        this._subscriptions.clear();
    }

    private _onConnected(): void {
        this._disconnectCountedThisAttempt = false;

        if (this._connectionState === 'disconnecting') {
            this._log('Ignoring onConnected during disconnect');
            return;
        }

        this._transitionTo('connected');
        this._reconnectAttempts = 0; // Reset on successful connection
        this._wasConnectedOnce = true;

        // Resolve the connect() promise so callers know the socket is usable
        this._settleDeferred('resolve');

        // Cancel any pending disconnect notification
        if (this._connectionStateDebounceTimer) {
            clearTimeout(this._connectionStateDebounceTimer);
            this._connectionStateDebounceTimer = undefined;
        }

        this._log('✅ Connected to Artemis WebSocket');

        // Immediately notify of connection (no delay for connect events)
        this._onDidChangeConnectionState.fire({ connected: true, wasEverConnected: this._wasConnectedOnce });

        // Auto-subscribe to personal topics
        this.subscribeToPersonalResults();
        this.subscribeToPersonalSubmissions();
        this.subscribeToSubmissionProcessing();
    }

    private _onDisconnected(): void {
        // Intentional disconnect: don't count
        if (this._connectionState === 'disconnecting') {
            this._log('Ignoring onDisconnected during intentional disconnect');
            return;
        }

        // Reject deferred if still in connecting state (handshake failure)
        if (this._connectionState === 'connecting') {
            this._settleDeferred(new Error('WebSocket closed during connection'));
            this._transitionTo('disconnected');
        }

        // Double-count prevention: only count once per physical WebSocket attempt
        if (this._disconnectCountedThisAttempt) { return; }
        this._disconnectCountedThisAttempt = true;
        this._reconnectAttempts++;

        // Transition to disconnected if we were connected
        if (this._connectionState === 'connected') {
            this._transitionTo('disconnected');
            this._clearSubscriptions();
            this._log('Disconnected from Artemis WebSocket');
        }

        // Debounce disconnect notification (5 seconds grace period)
        if (!this._connectionStateDebounceTimer) {
            this._connectionStateDebounceTimer = setTimeout(() => {
                this._connectionStateDebounceTimer = undefined;
                if (this._connectionState !== 'connected' && this._connectionState !== 'disconnecting') {
                    this._log('Disconnect grace period elapsed, notifying consumers');
                    this._onDidChangeConnectionState.fire({ connected: false, wasEverConnected: this._wasConnectedOnce });
                }
            }, CONNECTION_STATE_DELAY_MS);
        }

        // Check gave-up threshold
        if (this._reconnectAttempts >= MAX_CONNECTION_ATTEMPTS) {
            if (this._connectionStateDebounceTimer) {
                clearTimeout(this._connectionStateDebounceTimer);
                this._connectionStateDebounceTimer = undefined;
            }
            this._transitionTo('gave-up');
            this._log(`MAX RECONNECTION ATTEMPTS (${MAX_CONNECTION_ATTEMPTS}) REACHED`);
            this._onDidChangeConnectionState.fire({ connected: false, wasEverConnected: this._wasConnectedOnce });
            // Stop STOMP's internal reconnection loop, but KEEP gave-up state
            if (this._client) {
                this._connectionGeneration++;
                void this._client.deactivate({ force: true });
            }
        } else {
            this._log(`STOMP will attempt reconnection (attempt ${this._reconnectAttempts}/${MAX_CONNECTION_ATTEMPTS})`);
        }
    }

    private _onError(message: string): void {
        this._log(`❌ ${message}`);
        logger.error(message, LogCategory.WEBSOCKET);
        this._settleDeferred(new Error(message));
        this._clearSubscriptions();
        this._transitionTo('disconnected');
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

    private _extractJwtFromHeaders(headers: Record<string, string>): string | undefined {
        const bearer = headers['Authorization'];
        if (bearer) {
            return bearer.replace(/^Bearer\s+/, '');
        }

        const cookie = headers['Cookie'];
        if (cookie) {
            const jwtMatch = cookie.match(new RegExp(`${CONFIG.AUTH_COOKIE_NAME}=([^;]+)`));
            return jwtMatch ? jwtMatch[1] : undefined;
        }

        return undefined;
    }

    private _transitionTo(newState: ConnectionState): void {
        this._connectionState = newState;
    }

    private _log(message: string): void {
        logger.websocket(message);
    }
}
