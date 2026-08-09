import * as vscode from 'vscode';

import { type IrisWebSocketMessage, isIrisWebSocketMessage } from '@extension/services/iris/parseIrisWs';
import { logger } from '@extension/services/loggingService';
import { ArtemisWebsocketService } from '@extension/services/websocket/artemisWebsocketService';

/**
 * Minimum interval between resubscription attempts (milliseconds).
 * Prevents rapid resubscription loops.
 */
const MIN_RESUBSCRIBE_INTERVAL_MS = 3000;

/**
 * Manages Iris chat sessions and WebSocket subscriptions.
 *
 * SAFETY FEATURES to prevent connection flooding:
 * 1. Stores unsubscribe function for connection state callback
 * 2. Converges towards the desired session (`_converge`): a deliberate
 *    `subscribeToSession` call is never rate-limited, only reconnect storms
 *    are damped by MIN_RESUBSCRIBE_INTERVAL_MS
 * 3. Does NOT call connect() - only subscribes if already connected
 */
export class IrisWebSocketSessionClient implements vscode.Disposable {
    /**
     * The conversation this client currently speaks for. Set by
     * `subscribeToSession`, cleared by `leaveSession` and by `dispose`.
     * `IrisConversationService` is the only thing that decides what it should
     * be, so there is no second copy to keep in sync.
     */
    private _currentArtemisSessionId?: number;
    private _irisUnsubscribe?: () => void;
    private _connectionStateSubscription?: vscode.Disposable;
    private _lastResubscribeAttempt: number = 0;

    /** The conversation we WANT. Set synchronously, converged towards after. */
    private _desiredSessionId?: number;
    /** The conversation the CURRENT STOMP connection is actually subscribed to. */
    private _subscribedSessionId?: number;
    private _convergeTimer?: ReturnType<typeof setTimeout>;

    private readonly _onDidReceiveMessage = new vscode.EventEmitter<{ frame: IrisWebSocketMessage; sourceSessionId: number }>();
    public readonly onDidReceiveMessage = this._onDidReceiveMessage.event;
    private readonly _onDidConnectionStateChange = new vscode.EventEmitter<boolean>();
    public readonly onDidConnectionStateChange = this._onDidConnectionStateChange.event;
    private readonly _onDidResubscribe = new vscode.EventEmitter<number>();
    public readonly onDidResubscribe = this._onDidResubscribe.event;

    constructor(
        private readonly _websocketService: ArtemisWebsocketService
    ) {
        this._startWebSocketMonitoring();
    }

    public dispose(): void {
        logger.session('Disposing...');

        // Unsubscribe from connection state changes FIRST
        if (this._connectionStateSubscription) {
            this._connectionStateSubscription.dispose();
            this._connectionStateSubscription = undefined;
        }

        if (this._convergeTimer) {
            clearTimeout(this._convergeTimer);
            this._convergeTimer = undefined;
        }
        this.unsubscribe();
        this._onDidReceiveMessage.dispose();
        this._onDidConnectionStateChange.dispose();
        this._onDidResubscribe.dispose();
    }

    public get currentSessionId(): number | undefined {
        return this._currentArtemisSessionId;
    }

    public unsubscribe(): void {
        if (this._irisUnsubscribe) {
            logger.session('Unsubscribing from Iris session');
            try {
                this._irisUnsubscribe();
            } catch (e) {
                logger.sessionError('Error during unsubscribe:', e);
            }
            this._irisUnsubscribe = undefined;
        }
        // Leaving this set means a later subscribeToSession for the SAME id sees
        // subscribed === desired and returns without resubscribing.
        this._subscribedSessionId = undefined;
    }

    /**
     * Stops following a conversation WITHOUT intending another one. Distinct
     * from `unsubscribe()`, which only tears down the protocol subscription and
     * leaves the desired id in place, so the next reconnect resubscribes to a
     * conversation the client has left. The one caller is entering a course
     * that has no conversation to follow.
     */
    public leaveSession(): void {
        this._desiredSessionId = undefined;
        this._currentArtemisSessionId = undefined;
        this.unsubscribe();
    }

    public subscribeToSession(sessionId: number): void {
        // Synchronous, so a caller can rely on the intent being recorded even
        // when the STOMP subscribe is deferred.
        this._desiredSessionId = sessionId;
        this._currentArtemisSessionId = sessionId;
        // A deliberate navigation is NOT rate-limited. The 3 s window exists to
        // damp reconnect storms, not to throttle a student switching
        // conversations; delaying it leaves the newly opened conversation
        // subscription-less for up to three seconds, during which its answer is
        // dropped by the source check and simply never appears.
        this._converge({ immediate: true });
    }

    /**
     * Every (re)connect creates a FRESH STOMP session, so every prior protocol
     * subscription is gone whether or not we were told about the disconnect.
     * The baseline resubscribes unconditionally on `connected: true` for exactly
     * this reason: the disconnect notification is debounced by 5 s and a fast
     * reconnect may arrive first, so keying the invalidation on `connected:
     * false` misses it, `_converge` sees subscribed === desired, returns, and
     * the client is permanently deaf on the new connection with no error.
     */
    private _onConnectionStateChanged(connected: boolean): void {
        this._subscribedSessionId = undefined;
        this._irisUnsubscribe = undefined;
        if (connected) { this._converge({ immediate: true }); }
    }

    private _converge(options: { immediate?: boolean } = {}): void {
        const desired = this._desiredSessionId;
        if (desired === undefined) { return; }
        if (this._subscribedSessionId === desired) { return; }
        if (!this._websocketService.isConnected()) { return; }   // the monitor re-converges

        const waited = Date.now() - this._lastResubscribeAttempt;
        if (!options.immediate && waited < MIN_RESUBSCRIBE_INTERVAL_MS) {
            // SCHEDULE, never drop. Dropping is what left a conversation
            // permanently unsubscribed after a fast second switch.
            if (!this._convergeTimer) {
                this._convergeTimer = setTimeout(() => {
                    this._convergeTimer = undefined;
                    this._converge();
                }, MIN_RESUBSCRIBE_INTERVAL_MS - waited);
            }
            return;
        }

        this.unsubscribe();
        this._subscribedSessionId = undefined;
        this._lastResubscribeAttempt = Date.now();
        try {
            this._irisUnsubscribe = this._websocketService.subscribeToIrisSession(
                desired,
                (data, sourceSessionId) => this._handleWebSocketMessage(data, sourceSessionId),
            );
        } catch (error) {
            // We already tore the old subscription down, so a throw here leaves
            // ZERO subscriptions. Retry rather than leaving the conversation
            // silently deaf.
            logger.sessionError('Subscribe failed, retrying', error);
            this._scheduleConverge();
            return;
        }
        this._subscribedSessionId = desired;
        // The desire may have moved while we were subscribing.
        if (this._desiredSessionId !== desired) { this._converge({ immediate: true }); }
        else { this._onDidResubscribe.fire(desired); }
    }

    private _scheduleConverge(): void {
        if (this._convergeTimer) { return; }
        this._convergeTimer = setTimeout(() => {
            this._convergeTimer = undefined;
            this._converge();
        }, MIN_RESUBSCRIBE_INTERVAL_MS);
    }

    private _handleWebSocketMessage(data: unknown, sourceSessionId: number): void {
        // Light-touch guard: reject primitives / null / arrays before the
        // listeners assume the IrisWebSocketMessage object shape. Per-message
        // narrowing (e.g. type === 'MESSAGE' && has-message) happens
        // downstream in IrisWebSocketMessageHandler.
        if (!isIrisWebSocketMessage(data)) {
            logger.session(`Discarded non-object WebSocket payload: ${typeof data}`);
            return;
        }
        this._onDidReceiveMessage.fire({ frame: data, sourceSessionId });
    }

    /**
     * Monitor WebSocket connection state and converge the subscription when
     * reconnected.
     *
     * SAFETY: Does NOT call connect() - only subscribes if already connected.
     */
    private _startWebSocketMonitoring(): void {
        // Store subscription disposable for cleanup in dispose()
        this._connectionStateSubscription = this._websocketService.onDidChangeConnectionState(({ connected: isConnected }) => {
            logger.session(`WebSocket connection state changed: ${isConnected}`);
            this._onDidConnectionStateChange.fire(isConnected);
            this._onConnectionStateChanged(isConnected);
        });
    }
}
