import * as vscode from 'vscode';
import { Client, StompConfig } from '@stomp/stompjs';

import type { WebSocketDisplayStatus } from '@shared/messageContracts';

import { AuthManager } from '@extension/services/auth';
import { LogCategory, logger } from '@extension/services/loggingService';
import type { WebSocketMessageHandler } from '@extension/types';
import { resolveServerUrl } from '@extension/utils';

import type { ConnectionState } from './connectionState';
import { deriveDisplayStatus } from './displayStatus';
import { extractJwtFromHeaders } from './jwtExtractor';
import { buildStompConfig } from './stompConfigBuilder';
import { SubscriptionRegistry } from './subscriptionRegistry';
import { buildWebSocketUrl } from './webSocketUrl';

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

    private readonly _subscriptions = new SubscriptionRegistry({ log: (m) => this._log(m) });
    private _sessionId: string = '';

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
        this._subscriptions.registerMessageHandler(handler);
    }

    /** Unregister a previously registered message handler. */
    public unregisterMessageHandler(handler: WebSocketMessageHandler): void {
        this._subscriptions.unregisterMessageHandler(handler);
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
            this._client = this._createClient(buildStompConfig({
                generation,
                authHeaders,
                wsUrl,
                currentGeneration: () => this._connectionGeneration,
                onConnected: () => this._onConnected(),
                onStompError: (msg) => this._onError(msg),
                onWebSocketError: (msg) => this._onError(msg),
                onDisconnected: () => this._onDisconnected(),
                onWebSocketBeforeOpen: () => { this._disconnectCountedThisAttempt = false; },
                log: (msg) => this._log(msg),
            }));
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
        this._subscriptions.clearAll();
        this._subscriptions.detachClient();
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
        if (!extractJwtFromHeaders(authHeaders)) {
            const errorMsg = 'Failed to extract JWT token from auth headers';
            this._log(`⚠️ ${errorMsg}`);
            throw new Error(errorMsg);
        }

        const wsUrl = buildWebSocketUrl(serverUrl);
        this._log(`Connecting to ${wsUrl}`);
        return { authHeaders, wsUrl };
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
        this._subscriptions.clearAll();
        this._subscriptions.detachClient();
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
            this._subscriptions.clearAll();
            this._subscriptions.detachClient();

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

    /** Subscribe to personal result updates for the authenticated user. */
    public subscribeToPersonalResults(): void {
        this._subscriptions.subscribeToPersonalResults();
    }

    /** Subscribe to personal submission updates. */
    public subscribeToPersonalSubmissions(): void {
        this._subscriptions.subscribeToPersonalSubmissions();
    }

    /** Subscribe to submission processing updates (build status). */
    public subscribeToSubmissionProcessing(): void {
        this._subscriptions.subscribeToSubmissionProcessing();
    }

    /** Subscribe to Iris chat session updates for the given session ID. */
    public subscribeToIrisSession(sessionId: number, onMessage: (message: unknown) => void): () => void {
        return this._subscriptions.subscribeToIrisSession(sessionId, onMessage);
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
            subscriptions: this._subscriptions.topics,
            reconnectAttempts: this._reconnectAttempts,
            maxReconnectAttempts: MAX_CONNECTION_ATTEMPTS,
            sessionId: this._sessionId,
            serverUrl,
            websocketUrl: buildWebSocketUrl(serverUrl),
        };
    }

    /** Dispose and cleanup. */
    public dispose(): void {
        this._log('Disposing WebSocket service');
        this._onDidChangeConnectionState.dispose();
        this._subscriptions.clearMessageHandlers();

        if (this._connectionStateDebounceTimer) {
            clearTimeout(this._connectionStateDebounceTimer);
            this._connectionStateDebounceTimer = undefined;
        }
        void this.disconnect().catch(err => this._log(`Error during disconnect in dispose: ${err}`));
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

        // Attach client to registry BEFORE firing the connected event.
        // Synchronous consumers (e.g. IrisWebSocketSessionClient) may call
        // subscribeToIrisSession during the fire callback; the registry must
        // already own a client at that moment. Auto-subscribes below also
        // rely on an attached client.
        this._subscriptions.attachClient(this._client!);

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
            this._subscriptions.detachClient();
            this._transitionTo('disconnected');
            this._subscriptions.clearAll();
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
        this._subscriptions.detachClient();
        this._settleDeferred(new Error(message));
        this._subscriptions.clearAll();
        this._transitionTo('disconnected');
    }

    private _transitionTo(newState: ConnectionState): void {
        this._connectionState = newState;
    }

    private _log(message: string): void {
        logger.websocket(message);
    }
}
