import { act } from '@testing-library/react';
import { dispatchExtensionMessage } from './vscodeApi';
import type { ExtensionToWebviewMessage } from '../../../src/shared/messageContracts';

/**
 * Simulates the extension→webview direction of the bridge handshake.
 *
 * Wraps the dispatch in `await act(async () => {...})` so React processes
 * all resulting state updates before control returns to the caller. This
 * prevents race conditions in tests that assert on post-handshake state.
 *
 * The optional `initPayload` dispatches the view-init message after the
 * ready signal. If omitted, the function is a no-op — useful for asserting
 * on the loading state before the init message arrives.
 *
 * @param initPayload - Optional typed ExtensionToWebviewMessage to dispatch
 */
export async function simulateHandshake(initPayload?: ExtensionToWebviewMessage): Promise<void> {
    await act(async () => {
        if (initPayload !== undefined) {
            dispatchExtensionMessage(initPayload as Record<string, unknown>);
        }
    });
}
