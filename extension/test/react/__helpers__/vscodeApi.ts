import { vi } from 'vitest';
import type { VsCodeApi, ExtensionToWebviewMessage } from '../../../src/shared/messageContracts';

/**
 * Creates a mock VS Code API object for testing.
 * @param overrides - Optional partial overrides for the mock API
 * @returns A mock VsCodeApi object with Vitest spy functions
 */
export function createMockVsCodeApi(overrides?: Partial<VsCodeApi>): VsCodeApi {
	return {
		postMessage: vi.fn(),
		getState: vi.fn(() => undefined),
		setState: vi.fn(),
		...overrides,
	};
}

/**
 * Dispatches a message event to simulate extension-to-webview communication.
 * @param message - The message payload to dispatch
 */
export function dispatchExtensionMessage(message: ExtensionToWebviewMessage | Record<string, unknown>): void {
	const messageEvent = new MessageEvent('message', { data: message });
	window.dispatchEvent(messageEvent);
}

/**
 * Convenience accessor for postMessage spy calls.
 * @param vscodeApi - The mock VS Code API object
 * @returns The mock.calls array from the postMessage spy
 */
export function getPostMessageCalls(vscodeApi: VsCodeApi): unknown[][] {
	return (vscodeApi.postMessage as ReturnType<typeof vi.fn>).mock.calls;
}
