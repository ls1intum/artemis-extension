import { afterEach, describe, expect, it, vi } from 'vitest';

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
    subscribeToIrisSession?: (id: number, onMessage: (m: unknown) => void) => () => void;
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
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('fires the sessionId exactly once after a real successful subscribe', async () => {
        const { service: websocketService } = createWebsocketServiceStub({ isConnected: () => true });
        const client = new IrisWebSocketSessionClient(noopApiService, websocketService);

        const fired: number[] = [];
        client.onDidResubscribe((sessionId) => fired.push(sessionId));

        await client.subscribeToSession(42);

        expect(fired).toEqual([42]);
    });

    it('does not fire when the WebSocket is not connected', async () => {
        const { service: websocketService } = createWebsocketServiceStub({ isConnected: () => false });
        const client = new IrisWebSocketSessionClient(noopApiService, websocketService);

        const fired: number[] = [];
        client.onDidResubscribe((sessionId) => fired.push(sessionId));

        await client.subscribeToSession(42);

        expect(fired).toEqual([]);
    });

    it('does not fire on a rate-limited second call within MIN_RESUBSCRIBE_INTERVAL_MS', async () => {
        const { service: websocketService } = createWebsocketServiceStub({ isConnected: () => true });
        const client = new IrisWebSocketSessionClient(noopApiService, websocketService);

        const fired: number[] = [];
        client.onDidResubscribe((sessionId) => fired.push(sessionId));

        const nowSpy = vi.spyOn(Date, 'now');

        nowSpy.mockReturnValue(1_000_000);
        await client.subscribeToSession(42);

        // Well within the rate-limit window: the second attempt must be
        // suppressed entirely, so no second fire should reach the listener.
        nowSpy.mockReturnValue(1_000_000 + MIN_RESUBSCRIBE_INTERVAL_MS - 1);
        await client.subscribeToSession(43);

        expect(fired).toEqual([42]);
    });

    it('does not fire when subscribeToIrisSession throws', async () => {
        const { service: websocketService } = createWebsocketServiceStub({
            isConnected: () => true,
            subscribeToIrisSession: () => {
                throw new Error('subscribe failed');
            },
        });
        const client = new IrisWebSocketSessionClient(noopApiService, websocketService);

        const fired: number[] = [];
        client.onDidResubscribe((sessionId) => fired.push(sessionId));

        await expect(client.subscribeToSession(42)).resolves.toBeUndefined();
        expect(fired).toEqual([]);
    });

    it('forces a resubscribe via the connection-state monitor even within MIN_RESUBSCRIBE_INTERVAL_MS', async () => {
        const { service: websocketService, fireConnectionState } = createWebsocketServiceStub({ isConnected: () => true });
        const client = new IrisWebSocketSessionClient(noopApiService, websocketService);

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
