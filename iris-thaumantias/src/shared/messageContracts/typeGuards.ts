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

// Manual set matching WebviewToExtensionMessage's non-command type variants
// (ready, error, updatePanelTitle) plus the 'command' wrapper type.
const webviewMsgTypes = new Set<string>(['ready', 'command', 'error', 'updatePanelTitle']);

export function isWebviewMessage(msg: unknown): msg is WebviewToExtensionMessage {
    return typeof msg === 'object' && msg !== null && 'type' in msg
        && webviewMsgTypes.has((msg as { type: string }).type);
}
