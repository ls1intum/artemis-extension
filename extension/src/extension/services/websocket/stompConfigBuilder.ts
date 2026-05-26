import { IFrame, ReconnectionTimeMode, StompConfig } from '@stomp/stompjs';
import WebSocket from 'ws';

import { getUserAgent } from '@extension/utils';

const INITIAL_RECONNECT_DELAY_MS = 500;
const MAX_RECONNECT_DELAY_MS = 10000;
const CONNECTION_TIMEOUT_MS = 10000;
const HEARTBEAT_INTERVAL_MS = 10000;

interface BuildStompConfigDeps {
    /** Generation captured at build time. Compared with currentGeneration() before every callback. */
    generation: number;
    authHeaders: Record<string, string>;
    wsUrl: string;
    /** Read at callback time, so the orchestrator can invalidate this attempt. */
    currentGeneration(): number;
    /** Called when STOMP successfully connects. */
    onConnected(): void;
    /** Called when STOMP reports a broker error frame. Receives a formatted message. */
    onStompError(message: string): void;
    /** Called on lower-level WebSocket errors. Receives a formatted message. */
    onWebSocketError(message: string): void;
    /** Called when STOMP or the underlying WebSocket disconnects. */
    onDisconnected(): void;
    /** Called immediately before each WebSocket constructor invocation (used to reset per-attempt counters). */
    onWebSocketBeforeOpen(): void;
    log(message: string): void;
}

/**
 * Construct the STOMP `Client` configuration for a single connect attempt.
 *
 * Each lifecycle callback is gated on the captured `generation` matching
 * `currentGeneration()` at fire time. This is how the orchestrator
 * invalidates an in-flight attempt during reconnect/disconnect without
 * tearing down the STOMP client mid-callback.
 */
export function buildStompConfig(deps: BuildStompConfigDeps): StompConfig {
    const { generation, authHeaders, wsUrl, currentGeneration, log } = deps;

    log(`Reconnect config: delay=${INITIAL_RECONNECT_DELAY_MS}ms, timeout=${CONNECTION_TIMEOUT_MS}ms, heartbeat=${HEARTBEAT_INTERVAL_MS}ms`);

    return {
        brokerURL: wsUrl,
        connectHeaders: {},
        reconnectDelay: INITIAL_RECONNECT_DELAY_MS,
        reconnectTimeMode: ReconnectionTimeMode.EXPONENTIAL,
        maxReconnectDelay: MAX_RECONNECT_DELAY_MS,
        connectionTimeout: CONNECTION_TIMEOUT_MS,
        heartbeatIncoming: HEARTBEAT_INTERVAL_MS,
        heartbeatOutgoing: HEARTBEAT_INTERVAL_MS,
        discardWebsocketOnCommFailure: true,

        webSocketFactory: () => {
            deps.onWebSocketBeforeOpen();
            const ws = new WebSocket(wsUrl, {
                headers: {
                    ...authHeaders,
                    'User-Agent': getUserAgent(),
                },
            });
            ws.on('error', (err) => log(`WebSocket error: ${err.message}`));
            // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-return -- STOMP library expects generic WebSocket type
            return ws as any;
        },

        onConnect: () => {
            if (currentGeneration() !== generation) { return; }
            deps.onConnected();
        },

        onStompError: (frame: IFrame) => {
            if (currentGeneration() !== generation) { return; }
            const body = frame.body ? ` body=${frame.body.substring(0, 500)}` : '';
            deps.onStompError(`STOMP error: ${frame.headers['message']}${body}`);
        },

        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- STOMP library onWebSocketError uses generic event type
        onWebSocketError: (event: any) => {
            if (currentGeneration() !== generation) { return; }
            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment -- event shape is untyped
            const detail = event?.message || event?.type || 'unknown';
            deps.onWebSocketError(`WebSocket error: ${detail}`);
        },

        onDisconnect: () => {
            if (currentGeneration() !== generation) { return; }
            deps.onDisconnected();
        },

        onWebSocketClose: () => {
            if (currentGeneration() !== generation) { return; }
            deps.onDisconnected();
        },
    };
}
