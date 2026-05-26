import * as vscode from 'vscode';
import { Client, StompConfig } from '@stomp/stompjs';

import type { WebSocketDisplayStatus } from '@shared/messageContracts';

import { AuthManager } from '@extension/services/auth';
import { LogCategory, logger } from '@extension/services/loggingService';
import type { WebSocketMessageHandler } from '@extension/types';
import { resolveServerUrl } from '@extension/utils';

import { ConnectionLifecycle, MAX_CONNECTION_ATTEMPTS } from './connectionLifecycle';
import type { ConnectionState } from './connectionState';
import { deriveDisplayStatus } from './displayStatus';
import { extractJwtFromHeaders } from './jwtExtractor';
import { buildStompConfig } from './stompConfigBuilder';
import { SubscriptionRegistry } from './subscriptionRegistry';
import { buildWebSocketUrl } from './webSocketUrl';

/**
 * Manages STOMP/WebSocket connections to Artemis for real-time updates
 * (submissions, results, build status, Iris chat).
 *
 * The service is a thin coordinator. The connection state machine lives in
 * {@link ConnectionLifecycle}. Topic subscriptions live in
 * {@link SubscriptionRegistry}. STOMP `Client` config is built by
 * {@link buildStompConfig}. The service owns only:
 *   - the STOMP `Client` instance,
 *   - the `AuthManager` reference,
 *   - a per-connection session id (debug-only),
 *   - the `vscode.EventEmitter` exposed to consumers.
 */
export class ArtemisWebsocketService {
    private _client?: Client;
    private readonly _authManager: AuthManager;
    private _sessionId: string;
    private readonly _subscriptions: SubscriptionRegistry;
    private readonly _lifecycle: ConnectionLifecycle;
    private readonly _onDidChangeConnectionState = new vscode.EventEmitter<{ connected: boolean; wasEverConnected: boolean }>();
    public readonly onDidChangeConnectionState = this._onDidChangeConnectionState.event;

    constructor(authManager: AuthManager) {
        this._authManager = authManager;
        this._sessionId = this._generateSecureSessionId();
        this._subscriptions = new SubscriptionRegistry({ log: (m) => this._log(m) });
        this._lifecycle = new ConnectionLifecycle({
            log: (m) => this._log(m),
            onDidChangeConnectionState: (evt) => this._onDidChangeConnectionState.fire(evt),
        });
    }

    public registerMessageHandler(h: WebSocketMessageHandler): void { this._subscriptions.registerMessageHandler(h); }
    public unregisterMessageHandler(h: WebSocketMessageHandler): void { this._subscriptions.unregisterMessageHandler(h); }
    public subscribeToPersonalResults(): void { this._subscriptions.subscribeToPersonalResults(); }
    public subscribeToPersonalSubmissions(): void { this._subscriptions.subscribeToPersonalSubmissions(); }
    public subscribeToSubmissionProcessing(): void { this._subscriptions.subscribeToSubmissionProcessing(); }
    public subscribeToIrisSession(id: number, onMessage: (m: unknown) => void): () => void {
        return this._subscriptions.subscribeToIrisSession(id, onMessage);
    }

    public isConnected(): boolean {
        return this._lifecycle.state === 'connected' && this._client?.connected === true;
    }

    public get reconnectAttempts(): number { return this._lifecycle.reconnectAttempts; }
    public get connectionState(): ConnectionState { return this._lifecycle.state; }

    public resetConnectionState(): void { this._lifecycle.reset(); }

    public async connect(): Promise<void> {
        const clientInflight = !!(this._client?.active && !this._client.connected);
        const begin = this._lifecycle.beginConnect({ clientInflight });
        if (begin.kind === 'reuse') { return begin.promise; }

        const { generation, promise } = begin;
        try {
            await this._teardownExistingClient();
            const { authHeaders, wsUrl } = await this._prepareConnectionContext();
            this._client = this._createClient(buildStompConfig({
                generation,
                authHeaders,
                wsUrl,
                currentGeneration: () => this._lifecycle.generation,
                onConnected: () => this._onStompConnected(),
                onStompError: (msg) => this._onStompError(msg),
                onWebSocketError: (msg) => this._onStompError(msg),
                onDisconnected: () => this._onStompDisconnected(),
                onWebSocketBeforeOpen: () => this._lifecycle.recordWebSocketReopened(),
                log: (m) => this._log(m),
            }));
            // Note: NO attachClient() here. The registry attaches only inside
            // _onStompConnected (after recordConnected) so "client attached"
            // is equivalent to "state === 'connected'" by construction.
        } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            this._log(`❌ Failed to connect to WebSocket: ${err.message}`);
            logger.error(`Failed to connect to WebSocket: ${err.message}`, LogCategory.WEBSOCKET);
            this._subscriptions.clearAll();
            this._subscriptions.detachClient(); // defensive: registry may have been attached by a racing onConnect
            this._lifecycle.recordConnectError(err);
            throw err;
        }

        if (this._lifecycle.generation !== generation) {
            this._log('Connection aborted: superseded by newer connect/disconnect');
            // The superseding call (parallel disconnect or reconnect) has already:
            //   - bumped generation
            //   - rejected our deferred via beginDisconnect()/beginConnect()
            //   - cleaned up its own prior client
            // Our just-created `this._client` was never activated and is unreferenced
            // beyond `this._client`. We defensively clean it up here so a later
            // connect() doesn't accidentally `deactivate()` an orphan that was
            // briefly attached to the registry by a racing onConnect.
            this._subscriptions.detachClient();
            this._client = undefined;
            this._lifecycle.abortSupersededConnect();
            throw new Error('Connection aborted: superseded by newer connect/disconnect');
        }

        this._client.activate();
        return promise;
    }

    public async disconnect(): Promise<void> {
        this._lifecycle.beginDisconnect();
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
            this._sessionId = this._generateSecureSessionId();
            this._lifecycle.completeDisconnectWithClient();
        } else {
            this._lifecycle.completeDisconnectNoClient();
        }
    }

    public getDisplayStatus(): WebSocketDisplayStatus {
        const baseStatus = deriveDisplayStatus(this._lifecycle.state, this._lifecycle.wasConnectedOnce);
        if (baseStatus === 'connected' || baseStatus === 'disconnected') { return baseStatus; }
        const stompTrying = this._client?.active === true;
        const inFlightConnectingState = this._lifecycle.state === 'connecting';
        if (!stompTrying && !inFlightConnectingState) { return 'disconnected'; }
        return baseStatus;
    }

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
            reconnectAttempts: this._lifecycle.reconnectAttempts,
            maxReconnectAttempts: MAX_CONNECTION_ATTEMPTS,
            sessionId: this._sessionId,
            serverUrl,
            websocketUrl: buildWebSocketUrl(serverUrl),
        };
    }

    public dispose(): void {
        this._log('Disposing WebSocket service');
        this._onDidChangeConnectionState.dispose();
        this._subscriptions.clearMessageHandlers();
        this._lifecycle.dispose();
        void this.disconnect().catch(err => this._log(`Error during disconnect in dispose: ${err}`));
    }

    protected _createClient(config: StompConfig): Client { return new Client(config); }

    /**
     * STOMP onConnect callback. The lifecycle has already gated on
     * generation match (see {@link buildStompConfig}).
     *
     * Order matters here: we attach the registry to the STOMP client BEFORE
     * `recordConnected()` fires the `onDidChangeConnectionState` event.
     * Consumers (notably `IrisWebSocketSessionClient`) react synchronously
     * to that event and may call `subscribeToIrisSession()` before
     * `recordConnected()` returns. If the registry were unattached at that
     * point, the subscribe would throw and the resubscribe-on-reconnect
     * path would break.
     *
     * Invariant (consumer-observable): at every yield point and at every
     * consumer-visible event boundary, `subscriptions.isAttached` iff
     * `lifecycle.state === 'connected'`. The brief synchronous window
     * between `attachClient` and `recordConnected` is not observable
     * because `_onStompConnected` is invoked on a single STOMP callback
     * and no other coroutine can run before it returns.
     */
    private _onStompConnected(): void {
        if (!this._client) { return; }
        this._subscriptions.attachClient(this._client);
        this._lifecycle.recordConnected();
        if (this._lifecycle.state !== 'connected') {
            // recordConnected refused (we were in 'disconnecting'). Roll back the attach.
            this._subscriptions.detachClient();
            return;
        }
        this._subscriptions.subscribeToPersonalResults();
        this._subscriptions.subscribeToPersonalSubmissions();
        this._subscriptions.subscribeToSubmissionProcessing();
    }

    private _onStompError(message: string): void {
        logger.error(message, LogCategory.WEBSOCKET);
        this._lifecycle.recordError(message);
        this._subscriptions.clearAll();
        this._subscriptions.detachClient();
    }

    private _onStompDisconnected(): void {
        const directive = this._lifecycle.recordDisconnect({ hasClient: !!this._client });
        if (directive.clearedConnectedState) {
            this._subscriptions.clearAll();
            this._subscriptions.detachClient();
        }
        if (directive.gaveUp && this._client) {
            void this._client.deactivate({ force: true });
        }
    }

    private async _teardownExistingClient(): Promise<void> {
        if (!this._client) { return; }
        this._log('Deactivating existing connection before reconnect');
        await this._client.deactivate();
        this._subscriptions.clearAll();
        this._subscriptions.detachClient();
        this._client = undefined;
    }

    private async _prepareConnectionContext(): Promise<{ authHeaders: Record<string, string>; wsUrl: string }> {
        const serverUrl = resolveServerUrl();
        this._log(`Connecting to Artemis WebSocket (attempt ${this._lifecycle.reconnectAttempts + 1}/${MAX_CONNECTION_ATTEMPTS})...`);

        const authHeaders = await this._authManager.getAuthHeaders();
        if (Object.keys(authHeaders).length === 0) {
            const errorMsg = 'No authentication cookie available. Please log in first.';
            this._log(`⚠️ ${errorMsg}`);
            throw new Error(errorMsg);
        }
        if (!extractJwtFromHeaders(authHeaders)) {
            const errorMsg = 'Failed to extract JWT token from auth headers';
            this._log(`⚠️ ${errorMsg}`);
            throw new Error(errorMsg);
        }

        const wsUrl = buildWebSocketUrl(serverUrl);
        this._log(`Connecting to ${wsUrl}`);
        return { authHeaders, wsUrl };
    }

    private _generateSecureSessionId(): string {
        const bytes = new Uint8Array(6);
        crypto.getRandomValues(bytes);
        return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
    }

    private _log(message: string): void {
        logger.websocket(message);
    }
}
