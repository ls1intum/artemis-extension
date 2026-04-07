/**
 * Represents the WebSocket connection lifecycle.
 *
 * Valid transitions:
 *   disconnected → connecting | gave-up | disconnecting
 *   connecting → connected | disconnected | gave-up | disconnecting
 *   connected → disconnecting | disconnected (unexpected)
 *   disconnecting → disconnected | connecting
 *   gave-up → disconnected | disconnecting
 */
export type ConnectionState =
    | 'disconnected'
    | 'connecting'
    | 'connected'
    | 'disconnecting'
    | 'gave-up';
