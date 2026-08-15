import { vi } from 'vitest';

import type { ExtensionToWebviewMessage, VsCodeApi } from '@shared/messageContracts';

/** A mock VS Code API whose members are Vitest spies. */
export function createMockVsCodeApi(overrides?: Partial<VsCodeApi>): VsCodeApi {
	return {
		postMessage: vi.fn(),
		getState: vi.fn(() => undefined),
		setState: vi.fn(),
		...overrides,
	};
}

/** Dispatches a window message event, the way the extension host reaches the webview. */
export function dispatchExtensionMessage(message: ExtensionToWebviewMessage | Record<string, unknown>): void {
	const messageEvent = new MessageEvent('message', { data: message });
	window.dispatchEvent(messageEvent);
}

/** Convenience accessor for the postMessage spy's calls. */
export function getPostMessageCalls(vscodeApi: VsCodeApi): unknown[][] {
	return (vscodeApi.postMessage as ReturnType<typeof vi.fn>).mock.calls;
}
