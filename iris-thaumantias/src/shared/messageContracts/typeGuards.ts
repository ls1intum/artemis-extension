/**
 * Runtime type guards for message discrimination.
 */

import { ExtensionMsg } from './extensionMessages';
import type { ExtensionToWebviewMessage } from './extensionMessages';
import type { WebviewToExtensionMessage } from './webviewCommands';

const extensionMsgValues = new Set<string>(Object.values(ExtensionMsg));

export function isExtensionMessage(msg: unknown): msg is ExtensionToWebviewMessage {
    return typeof msg === 'object' && msg !== null && 'type' in msg
        && extensionMsgValues.has((msg as { type: string }).type);
}

/** Non-command message types from WebviewToExtensionMessage union.
 *  Must match non-command variants in WebviewToExtensionMessage (webviewCommands.ts) */
const WEBVIEW_MSG_TYPES = new Set<string>(['ready', 'command', 'error', 'updatePanelTitle'] as const);

export function isWebviewMessage(msg: unknown): msg is WebviewToExtensionMessage {
    return typeof msg === 'object' && msg !== null && 'type' in msg
        && WEBVIEW_MSG_TYPES.has((msg as { type: string }).type);
}
