/**
 * Message contracts for typed extension-webview communication.
 *
 * This file defines discriminated union types for bidirectional messaging
 * between the extension host (Node.js) and webview (browser) contexts.
 * It's importable from both contexts (no vscode imports).
 *
 * The contracts are scaffolds for Phase 3 - actual view-specific payloads
 * will be tightened when implementing individual views.
 */

/**
 * WebviewState placeholder.
 * Will be defined per-view in Phase 3 with specific state shapes.
 */
export interface WebviewState {
    [key: string]: unknown;
}

/**
 * Messages sent FROM extension host TO webview.
 * Discriminated by 'type' property.
 */
export type ExtensionToWebviewMessage =
    | { type: 'init'; payload: { /* TBD: defined per view in Phase 3 */ } }
    | { type: 'stateUpdate'; payload: Partial<WebviewState> }
    | { type: 'error'; payload: { message: string } };

/**
 * Messages sent FROM webview TO extension host.
 * Discriminated by 'type' property.
 */
export type WebviewToExtensionMessage =
    | { type: 'ready' }
    | { type: 'command'; payload: { command: string; args?: unknown } }
    | { type: 'error'; payload: { message: string; stack?: string; componentStack?: string } };

/**
 * VS Code API interface available in webview context.
 * Acquired via window.acquireVsCodeApi() in webview code.
 */
export interface VsCodeApi {
    postMessage(message: WebviewToExtensionMessage): void;
    getState(): WebviewState | undefined;
    setState(state: WebviewState): void;
}

/**
 * Type guard for extension-to-webview messages.
 * Validates message structure and narrows type.
 *
 * @param msg - Unknown message to validate
 * @returns true if message conforms to ExtensionToWebviewMessage contract
 */
export function isExtensionMessage(msg: unknown): msg is ExtensionToWebviewMessage {
    return typeof msg === 'object' && msg !== null && 'type' in msg
        && typeof (msg as { type: unknown }).type === 'string'
        && ['init', 'stateUpdate', 'error'].includes((msg as { type: string }).type);
}

/**
 * Type guard for webview-to-extension messages.
 * Validates message structure and narrows type.
 *
 * @param msg - Unknown message to validate
 * @returns true if message conforms to WebviewToExtensionMessage contract
 */
export function isWebviewMessage(msg: unknown): msg is WebviewToExtensionMessage {
    return typeof msg === 'object' && msg !== null && 'type' in msg
        && typeof (msg as { type: unknown }).type === 'string'
        && ['ready', 'command', 'error'].includes((msg as { type: string }).type);
}
