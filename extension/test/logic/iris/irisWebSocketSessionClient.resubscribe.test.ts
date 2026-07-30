import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// IrisWebSocketSessionClient allocates two `new vscode.EventEmitter()` fields
// in the constructor path (_onDidReceiveMessage, _onDidConnectionStateChange,
// and the one under test, _onDidResubscribe). The shared vitest vscode stub
// has no EventEmitter, so mirror it here with a REAL emitter (stores and
// invokes listeners) rather than the no-op emitter used by handler-only
// tests, because these assertions depend on whether a fire actually reaches
// a subscribed listener.
vi.mock('vscode', () => {
    class EventEmitter<T> {
        private _listeners: Array<(e: T) => void> = [];
        event = (listener: (e: T) => void): { dispose(): void } => {
            this._listeners.push(listener);
            return {
                dispose: () => {
                    this._listeners = this._listeners.filter((l) => l !== listener);
                },
            };
        };
        fire(value: T): void {
            for (const listener of [...this._listeners]) {
                listener(value);
            }
        }
        dispose(): void {
            this._listeners = [];
        }
    }
    return { EventEmitter };
});

import type { ArtemisApiService } from '@extension/api';
import { IrisWebSocketSessionClient } from '@extension/services/iris/transport/irisWebSocketSessionClient';
import type { ArtemisWebsocketService } from '@extension/services/websocket/artemisWebsocketService';
import type { ActiveContext } from '@extension/types';

/** Minimum interval between resubscription attempts, mirrored from the client. */
const MIN_RESUBSCRIBE_INTERVAL_MS = 3000;

const noopApiService = {} as unknown as ArtemisApiService;

function createWebsocketServiceStub(options: {
    isConnected?: () => boolean;
    subscribeToIrisSession?: (id: number, onMessage: (m: unknown, sourceSessionId: number) => void) => () => void;
}): { service: ArtemisWebsocketService; fireConnectionState: (connected: boolean) => void } {
    const connectionStateListeners: Array<(e: { connected: boolean }) => void> = [];

    const service = {
        isConnected: options.isConnected ?? (() => true),
        subscribeToIrisSession: options.subscribeToIrisSession ?? (() => () => { /* unsubscribe no-op */ }),
        onDidChangeConnectionState: (listener: (e: { connected: boolean }) => void) => {
            connectionStateListeners.push(listener);
            return { dispose: () => { /* no-op */ } };
        },
    } as unknown as ArtemisWebsocketService;

    return {
        service,
        fireConnectionState: (connected: boolean) => {
            for (const listener of [...connectionStateListeners]) {
                listener({ connected });
            }
        },
    };
}

describe('IrisWebSocketSessionClient: onDidResubscribe', () => {
    // 'does not fire when subscribeToIrisSession throws' schedules a
    // self-rescheduling real setTimeout retry chain (via _scheduleConverge)
    // that would otherwise keep running after the test ends. Track every
    // client this describe block creates and dispose them all, which clears
    // any pending converge timer.
    const createdClients: IrisWebSocketSessionClient[] = [];

    function trackedClient(...args: ConstructorParameters<typeof IrisWebSocketSessionClient>): IrisWebSocketSessionClient {
        const client = new IrisWebSocketSessionClient(...args);
        createdClients.push(client);
        return client;
    }

    afterEach(() => {
        for (const client of createdClients) { client.dispose(); }
        createdClients.length = 0;
        vi.restoreAllMocks();
    });

    it('fires the sessionId exactly once after a real successful subscribe', async () => {
        const { service: websocketService } = createWebsocketServiceStub({ isConnected: () => true });
        const client = trackedClient(noopApiService, websocketService);

        const fired: number[] = [];
        client.onDidResubscribe((sessionId) => fired.push(sessionId));

        await client.subscribeToSession(42);

        expect(fired).toEqual([42]);
    });

    it('does not fire when the WebSocket is not connected', async () => {
        const { service: websocketService } = createWebsocketServiceStub({ isConnected: () => false });
        const client = trackedClient(noopApiService, websocketService);

        const fired: number[] = [];
        client.onDidResubscribe((sessionId) => fired.push(sessionId));

        await client.subscribeToSession(42);

        expect(fired).toEqual([]);
    });

    it('does not fire when subscribeToIrisSession throws', () => {
        const { service: websocketService } = createWebsocketServiceStub({
            isConnected: () => true,
            subscribeToIrisSession: () => {
                throw new Error('subscribe failed');
            },
        });
        const client = trackedClient(noopApiService, websocketService);

        const fired: number[] = [];
        client.onDidResubscribe((sessionId) => fired.push(sessionId));

        // subscribeToSession is synchronous (void); the throw is swallowed and
        // logged inside _converge, which schedules a retry instead of firing.
        // That retry is a real setTimeout; the afterEach above disposes the
        // client so it does not keep firing after this test ends.
        client.subscribeToSession(42);
        expect(fired).toEqual([]);
    });

    it('forces a resubscribe via the connection-state monitor even within MIN_RESUBSCRIBE_INTERVAL_MS', async () => {
        const { service: websocketService, fireConnectionState } = createWebsocketServiceStub({ isConnected: () => true });
        const client = trackedClient(noopApiService, websocketService);

        const fired: number[] = [];
        client.onDidResubscribe((sessionId) => fired.push(sessionId));

        const activeContext: ActiveContext = {
            type: 'exercise',
            id: 1,
            title: 'test exercise',
            source: 'system-default',
            locked: false,
            selectedAt: 0,
        };

        const nowSpy = vi.spyOn(Date, 'now');

        nowSpy.mockReturnValue(1_000_000);
        await client.initializeSession(activeContext, 999, 42);

        // Simulate a rapid reconnect flap well within the rate-limit window
        // (STOMP's own reconnectDelay is 500ms, so this is the common case).
        // Every reconnect is a fresh STOMP session, so the connection-state
        // monitor must force the resubscribe through the throttle instead of
        // silently dropping it.
        nowSpy.mockReturnValue(1_000_000 + MIN_RESUBSCRIBE_INTERVAL_MS - 1);
        fireConnectionState(true);
        // Let the void-returning async call inside the monitor callback settle.
        await Promise.resolve();
        await Promise.resolve();

        expect(fired).toEqual([42, 42]);
    });
});

/**
 * `_converge` replaces the old "attempt or drop" `_subscribeIfConnected` with
 * "record the desired session, converge towards it". These tests exercise
 * the new transport-level semantics: latest-wins on a fast switch, forced
 * reconvergence on any connection-state event (not only a preceding
 * `false`), retry-on-throw instead of leaving zero subscriptions, and that
 * the `onDidResubscribe` feedback edge into `IrisConversationService`
 * (onSubscriptionActive -> reconcileCurrent -> subscribeToSession ->
 * onDidResubscribe) terminates rather than looping.
 */
describe('IrisWebSocketSessionClient: _converge (latest-wins subscription)', () => {
    let ws: {
        service: ArtemisWebsocketService;
        readonly activeSubscriptionCount: number;
        readonly subscribedIds: number[];
        dropConnection: () => void;
        restoreConnection: () => void;
        emitConnectionState: (connected: boolean) => void;
    };

    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    /**
     * A STOMP (re)connect creates a fresh protocol session, so every
     * subscription made on the PREVIOUS connection is gone at the transport
     * level whether or not the app explicitly unsubscribed it. `dropConnection`
     * models that by clearing the tracked active set, not merely flipping
     * `isConnected()`.
     */
    function makeWsStub(options: { connected?: boolean; subscribeThrowsOnce?: boolean } = {}) {
        let connected = options.connected ?? true;
        let throwOnceRemaining = options.subscribeThrowsOnce ? 1 : 0;
        const active = new Set<{ id: number }>();
        const subscribedIds: number[] = [];
        const listeners: Array<(e: { connected: boolean }) => void> = [];

        const service = {
            isConnected: () => connected,
            subscribeToIrisSession: (id: number, _onMessage: (m: unknown, sourceSessionId: number) => void) => {
                if (throwOnceRemaining > 0) {
                    throwOnceRemaining--;
                    throw new Error('subscribe failed');
                }
                subscribedIds.push(id);
                const handle = { id };
                active.add(handle);
                return () => { active.delete(handle); };
            },
            onDidChangeConnectionState: (listener: (e: { connected: boolean }) => void) => {
                listeners.push(listener);
                return { dispose: () => { /* no-op */ } };
            },
        } as unknown as ArtemisWebsocketService;

        return {
            service,
            get activeSubscriptionCount(): number { return active.size; },
            get subscribedIds(): number[] { return subscribedIds; },
            dropConnection: () => {
                connected = false;
                active.clear();
                for (const l of [...listeners]) { l({ connected: false }); }
            },
            restoreConnection: () => {
                connected = true;
                for (const l of [...listeners]) { l({ connected: true }); }
            },
            emitConnectionState: (c: boolean) => {
                connected = c;
                for (const l of [...listeners]) { l({ connected: c }); }
            },
        };
    }

    function makeClient(options: { connected?: boolean; subscribeThrowsOnce?: boolean } = {}): IrisWebSocketSessionClient {
        ws = makeWsStub(options);
        return new IrisWebSocketSessionClient(noopApiService, ws.service);
    }

    async function advanceTimersBy(ms: number): Promise<void> {
        await vi.advanceTimersByTimeAsync(ms);
    }

    it('never leaves a conversation unsubscribed after a fast switch', async () => {
        const client = makeClient({ connected: true });
        client.subscribeToSession(3);
        client.subscribeToSession(4);
        await advanceTimersBy(MIN_RESUBSCRIBE_INTERVAL_MS);
        expect(ws.activeSubscriptionCount).toBe(1);
    });

    it('resubscribes on the new connection after a reconnect', () => {
        const client = makeClient({ connected: true });
        client.subscribeToSession(7);
        ws.dropConnection();
        ws.restoreConnection();
        expect(ws.activeSubscriptionCount).toBe(1);
        expect(ws.subscribedIds.at(-1)).toBe(7);
    });

    it('resubscribes on a connected:true that was never preceded by connected:false', () => {
        // The disconnect notification is debounced by 5 s, so a fast reconnect
        // reports `true` first. Keying invalidation on `false` leaves the client
        // permanently deaf on the new connection, silently.
        const client = makeClient({ connected: true });
        client.subscribeToSession(7);
        ws.emitConnectionState(true);          // no preceding false
        expect(ws.subscribedIds.filter((id) => id === 7)).toHaveLength(2);
    });

    it('retries when the subscribe call throws, instead of leaving zero subscriptions', async () => {
        const client = makeClient({ connected: true, subscribeThrowsOnce: true });
        client.subscribeToSession(7);
        expect(ws.activeSubscriptionCount).toBe(0);
        await advanceTimersBy(MIN_RESUBSCRIBE_INTERVAL_MS);
        expect(ws.activeSubscriptionCount).toBe(1);
    });

    it('a deliberate navigation is not delayed by the rate limit', () => {
        // The window damps reconnect storms; throttling a student's switch would
        // leave the new conversation deaf for up to three seconds.
        const client = makeClient({ connected: true });
        client.subscribeToSession(3);
        client.subscribeToSession(4);
        expect(ws.subscribedIds.at(-1)).toBe(4);
    });

    it('resetSession stops a later reconnect from resurrecting the session', () => {
        const client = makeClient({ connected: true });
        client.subscribeToSession(7);
        client.resetSession();
        ws.dropConnection();
        ws.restoreConnection();
        expect(ws.activeSubscriptionCount).toBe(0);
    });

    it('a listener that re-enters subscribeToSession from inside onDidResubscribe does not recurse', () => {
        // Task 5's real wiring is onDidResubscribe -> onSubscriptionActive ->
        // reconcileCurrent -> subscribeToSession, called SYNCHRONOUSLY from
        // inside the fire, for the SAME session id that just resubscribed.
        // Two sequential top-level `subscribeToSession(7)` calls do not
        // reproduce this: by the second call `_subscribedSessionId` is
        // already 7 regardless of where that assignment sits relative to the
        // fire. The re-entrant case only terminates if `_subscribedSessionId`
        // is set BEFORE `_onDidResubscribe.fire(...)`, so that the listener's
        // own re-entrant call sees subscribed === desired and returns
        // immediately instead of recursing (which would stack-overflow).
        const client = makeClient({ connected: true });
        const fired: number[] = [];
        client.onDidResubscribe((sessionId) => {
            fired.push(sessionId);
            client.subscribeToSession(sessionId);
        });

        client.subscribeToSession(7);

        expect(fired).toEqual([7]);
    });
});
