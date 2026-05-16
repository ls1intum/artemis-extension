import type { WebSocketDisplayStatus } from '@shared/messageContracts';

import type { ConnectionState } from './connectionState';

/**
 * Maps the websocket service's domain state to a UI-facing display status that
 * both the status bar and the chat webview consume. Centralised here so the
 * two consumers cannot drift apart on what counts as "reconnecting" vs.
 * "disconnected".
 */
export function deriveDisplayStatus(
    state: ConnectionState,
    wasConnectedOnce: boolean,
): WebSocketDisplayStatus {
    switch (state) {
        case 'connected':
            return 'connected';
        case 'connecting':
            return wasConnectedOnce ? 'reconnecting' : 'connecting';
        case 'disconnected':
            // Between retry attempts when we have a previous successful connection
            // counts as reconnecting from the user's perspective. A first-ever
            // disconnected state (no prior connection) is the brief idle window
            // before connect() is invoked — show it as connecting.
            return wasConnectedOnce ? 'reconnecting' : 'connecting';
        case 'gave-up':
            return 'disconnected';
        case 'disconnecting':
            // Transient state during teardown; treat as disconnected for UI.
            return 'disconnected';
    }
}
