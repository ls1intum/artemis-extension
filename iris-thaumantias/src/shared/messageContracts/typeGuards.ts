/**
 * Runtime type guards for message discrimination.
 */

import { ExtensionMsg } from './extensionMessages';
import type { ExtensionToWebviewMessage } from './extensionMessages';
import { WebviewMsgType, WebviewCmd, COMMANDS_REQUIRING_PAYLOAD } from './webviewCommands';
import type { WebviewToExtensionMessage } from './webviewCommands';

const extensionMsgValues = new Set<string>(Object.values(ExtensionMsg));
const webviewCmdValues = new Set<string>(Object.values(WebviewCmd));

export function isExtensionMessage(msg: unknown): msg is ExtensionToWebviewMessage {
    return typeof msg === 'object' && msg !== null && 'type' in msg
        && extensionMsgValues.has((msg as { type: string }).type);
}

/** Non-command message types from WebviewToExtensionMessage union.
 *  Derived from WebviewMsgType const + the 'command' discriminator */
const WEBVIEW_MSG_TYPES = new Set<string>([...Object.values(WebviewMsgType), 'command']);

export function isWebviewMessage(msg: unknown): msg is WebviewToExtensionMessage {
    if (typeof msg !== 'object' || msg === null || !('type' in msg)) {
        return false;
    }
    const type = (msg as { type: string }).type;
    if (!WEBVIEW_MSG_TYPES.has(type)) {
        return false;
    }
    // Field validation for specific message types
    switch (type) {
        case WebviewMsgType.Error: {
            const payload = (msg as { payload?: unknown }).payload;
            return typeof payload === 'object' && payload !== null
                && typeof (payload as { message?: unknown }).message === 'string';
        }
        case 'command': {
            const command = (msg as { command?: unknown }).command;
            if (typeof command !== 'string' || !webviewCmdValues.has(command)) {
                return false;
            }
            // Reject commands that require a payload but are missing one
            if (COMMANDS_REQUIRING_PAYLOAD.has(command)) {
                const payload = (msg as { payload?: unknown }).payload;
                if (typeof payload !== 'object' || payload === null) {
                    return false;
                }
            }
            return true;
        }
        case WebviewMsgType.UpdatePanelTitle:
            return typeof (msg as { title?: unknown }).title === 'string';
        default:
            return true;
    }
}
