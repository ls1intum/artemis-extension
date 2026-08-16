import type { ConnectionState } from './connectionState';

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
const CONNECTION_STATE_DELAY_MS = 5000; // matches Artemis webapp
export const MAX_CONNECTION_ATTEMPTS = 20;

interface ConnectionLifecycleDeps {
    log(message: string): void;
    /**
     * Fired on connect (immediately) and disconnect (after debounce, or
     * immediately on gave-up / intentional disconnect).
     */
    onDidChangeConnectionState(evt: { connected: boolean; wasEverConnected: boolean }): void;
}

interface BeginConnectOptions {
    /**
     * Set to true when the orchestrator detects a STOMP client mid-handshake
     * (`client?.active && !client.connected`). State-based gates are checked
     * first: `connecting` returns reuse, `disconnecting` and `gave-up` throw,
     * regardless of this flag. Only `disconnected` combined with this flag
     * returns reuse.
     */
    clientInflight?: boolean;
}

type BeginConnectResult =
    | { kind: 'fresh'; generation: number; promise: Promise<void> }
    | { kind: 'reuse'; promise: Promise<void> };

interface RecordDisconnectOptions {
    /**
     * True iff the orchestrator currently holds a STOMP `Client` instance.
     * The generation token is only bumped on `gave-up` when one exists, since
     * the bump exists to invalidate STOMP callbacks before force-deactivation.
     */
    hasClient: boolean;
}

interface RecordDisconnectDirective {
    /** True if the lifecycle transitioned 'connected' -> 'disconnected' (orchestrator should clear subscriptions and detach client). */
    clearedConnectedState: boolean;
    /** True if the lifecycle just hit MAX_CONNECTION_ATTEMPTS (orchestrator should force-teardown the STOMP client iff one exists). */
    gaveUp: boolean;
}

/**
 * Pure state machine for the Artemis WebSocket connection.
 *
 * Owns the connection state, generation token, reconnect counting, deferred
 * for connect()-callers, safety timeout, and the debounce timer for
 * disconnect notifications. Does NOT own the STOMP client or any
 * subscriptions, those are the orchestrator's concern.
 *
 * Threading: all methods are synchronous. Timeouts and debounce are
 * registered as Node timers; the lifecycle does not perform `await`.
 */
export class ConnectionLifecycle {
    private _state: ConnectionState = 'disconnected';
    private _generation = 0;
    private _reconnectAttempts = 0;
    private _wasConnectedOnce = false;
    private _connectDeferred?: Deferred<void>;
    private _safetyTimeout?: ReturnType<typeof setTimeout>;
    private _debounceTimer?: ReturnType<typeof setTimeout>;
    private _disconnectCountedThisAttempt = false;
    private _gaveUpEventFired = false;

    constructor(private readonly _deps: ConnectionLifecycleDeps) {}

    public get state(): ConnectionState { return this._state; }
    public get generation(): number { return this._generation; }
    public get reconnectAttempts(): number { return this._reconnectAttempts; }
    public get wasConnectedOnce(): boolean { return this._wasConnectedOnce; }

    /**
     * Top of `connect()`. Handles all state-based gates FIRST, then falls
     * through to `clientInflight` reuse, then to a fresh attempt.
     */
    public beginConnect(opts: BeginConnectOptions): BeginConnectResult {
        if (this._state === 'connecting') {
            if (this._connectDeferred) { return { kind: 'reuse', promise: this._connectDeferred.promise }; }
            throw new Error('Connection attempt already timed out');
        }
        if (this._state === 'disconnecting') { throw new Error('Disconnect in progress'); }
        if (this._state === 'gave-up') { throw new Error('Max attempts reached. Call resetConnectionState() to retry.'); }

        if (opts.clientInflight) {
            // STOMP client is mid-handshake while we are 'disconnected'. Join
            // the existing attempt without re-entering 'connecting' or bumping
            // the generation.
            if (!this._connectDeferred) {
                this._connectDeferred = createDeferred<void>();
                this._startSafetyTimeout();
            }
            return { kind: 'reuse', promise: this._connectDeferred.promise };
        }

        this._state = 'connecting';
        this._generation++;
        this._gaveUpEventFired = false;
        this._connectDeferred = createDeferred<void>();
        this._startSafetyTimeout();
        return { kind: 'fresh', generation: this._generation, promise: this._connectDeferred.promise };
    }

    /** Called by the orchestrator when STOMP fires onConnect. */
    public recordConnected(): void {
        this._disconnectCountedThisAttempt = false;

        if (this._state === 'disconnecting') {
            this._deps.log('Ignoring onConnected during disconnect');
            return;
        }

        this._state = 'connected';
        this._reconnectAttempts = 0;
        this._wasConnectedOnce = true;
        this._settleDeferred('resolve');

        if (this._debounceTimer) {
            clearTimeout(this._debounceTimer);
            this._debounceTimer = undefined;
        }

        this._deps.log('✅ Connected to Artemis WebSocket');
        this._deps.onDidChangeConnectionState({ connected: true, wasEverConnected: true });
    }

    /**
     * Called by the orchestrator when the WebSocket factory is about to open a
     * new physical socket, resetting the per-attempt disconnect counter.
     */
    public recordWebSocketReopened(): void {
        this._disconnectCountedThisAttempt = false;
    }

    /** Called by the orchestrator when STOMP fires onDisconnect / onWebSocketClose. */
    public recordDisconnect(opts: RecordDisconnectOptions): RecordDisconnectDirective {
        if (this._state === 'disconnecting') {
            this._deps.log('Ignoring onDisconnected during intentional disconnect');
            return { clearedConnectedState: false, gaveUp: false };
        }

        if (this._state === 'connecting') {
            this._settleDeferred(new Error('WebSocket closed during connection'));
            this._state = 'disconnected';
        }

        if (this._disconnectCountedThisAttempt) {
            return { clearedConnectedState: false, gaveUp: false };
        }
        this._disconnectCountedThisAttempt = true;
        this._reconnectAttempts++;

        let clearedConnectedState = false;
        if (this._state === 'connected') {
            this._state = 'disconnected';
            clearedConnectedState = true;
            this._deps.log('Disconnected from Artemis WebSocket');
        }

        if (!this._debounceTimer) {
            this._debounceTimer = setTimeout(() => {
                this._debounceTimer = undefined;
                if (this._state !== 'connected' && this._state !== 'disconnecting') {
                    this._deps.log('Disconnect grace period elapsed, notifying consumers');
                    this._deps.onDidChangeConnectionState({ connected: false, wasEverConnected: this._wasConnectedOnce });
                }
            }, CONNECTION_STATE_DELAY_MS);
        }

        if (this._reconnectAttempts >= MAX_CONNECTION_ATTEMPTS) {
            if (this._debounceTimer) {
                clearTimeout(this._debounceTimer);
                this._debounceTimer = undefined;
            }
            this._state = 'gave-up';
            this._deps.log(`MAX RECONNECTION ATTEMPTS (${MAX_CONNECTION_ATTEMPTS}) REACHED`);
            if (opts.hasClient) {
                // Bump only when a client exists to be force-deactivated: the
                // bump invalidates STOMP callbacks before the orchestrator
                // calls `client.deactivate({ force: true })`.
                this._generation++;
            }
            if (!this._gaveUpEventFired) {
                this._gaveUpEventFired = true;
                this._deps.onDidChangeConnectionState({ connected: false, wasEverConnected: this._wasConnectedOnce });
            }
            return { clearedConnectedState, gaveUp: true };
        }

        this._deps.log(`STOMP will attempt reconnection (attempt ${this._reconnectAttempts}/${MAX_CONNECTION_ATTEMPTS})`);
        return { clearedConnectedState, gaveUp: false };
    }

    /** Called by the orchestrator when STOMP fires onStompError or onWebSocketError. */
    public recordError(message: string): void {
        this._deps.log(`❌ ${message}`);
        this._settleDeferred(new Error(message));
        this._state = 'disconnected';
    }

    /** Called by the orchestrator from the connect() catch path (deactivate throws, auth missing, etc.). */
    public recordConnectError(error: Error): void {
        this._state = 'disconnected';
        this._settleDeferred(error);
    }

    /**
     * Called by the orchestrator when the post-client-creation generation
     * check fails (a concurrent disconnect bumped generation). Transitions
     * to disconnected without firing events. The deferred has already been
     * settled by whatever bumped the generation; calling this is a no-op
     * for the deferred but tightens state.
     */
    public abortSupersededConnect(): void {
        this._state = 'disconnected';
    }

    /** Called by the orchestrator at the start of disconnect(). */
    public beginDisconnect(): void {
        this._generation++;
        this._state = 'disconnecting';
        this._settleDeferred(new Error('Disconnected'));
        if (this._debounceTimer) {
            clearTimeout(this._debounceTimer);
            this._debounceTimer = undefined;
        }
    }

    /**
     * Called by the orchestrator after STOMP deactivation completes AND a
     * client was present at disconnect start. Fires the
     * `(false, prior wasEverConnected)` event then resets counters.
     */
    public completeDisconnectWithClient(): void {
        const priorWasEverConnected = this._wasConnectedOnce;
        this._deps.onDidChangeConnectionState({ connected: false, wasEverConnected: priorWasEverConnected });
        this._wasConnectedOnce = false;
        this._reconnectAttempts = 0;
        this._state = 'disconnected';
    }

    /**
     * Called by the orchestrator when `disconnect()` runs but no client
     * existed. Fires no event and touches no counters (they are already at
     * zero by definition).
     */
    public completeDisconnectNoClient(): void {
        this._state = 'disconnected';
    }

    public reset(): void {
        this._deps.log('Resetting connection state');
        this._reconnectAttempts = 0;
        this._state = 'disconnected';
        this._gaveUpEventFired = false;
    }

    public dispose(): void {
        if (this._debounceTimer) {
            clearTimeout(this._debounceTimer);
            this._debounceTimer = undefined;
        }
        if (this._safetyTimeout) {
            clearTimeout(this._safetyTimeout);
            this._safetyTimeout = undefined;
        }
    }

    private _startSafetyTimeout(): void {
        this._safetyTimeout = setTimeout(() => {
            this._safetyTimeout = undefined;
            if (!this._connectDeferred) { return; }
            this._connectDeferred.reject(new Error('Connection timed out'));
            this._connectDeferred = undefined;
            this._state = 'disconnected';
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
            deferred.promise.catch(() => { /* defensive no-op for orphan awaiters */ });
            deferred.reject(outcome);
        }
    }
}
