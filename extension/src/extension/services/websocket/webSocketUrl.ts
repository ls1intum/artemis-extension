/**
 * Convert an Artemis HTTP(S) server URL into the direct STOMP WebSocket URL.
 *
 * Artemis exposes STOMP at `/websocket/websocket` (bypassing SockJS). We
 * preserve host + port and only translate the scheme.
 */
export function buildWebSocketUrl(serverUrl: string): string {
    const url = new URL(serverUrl);
    const protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${url.host}/websocket/websocket`;
}
