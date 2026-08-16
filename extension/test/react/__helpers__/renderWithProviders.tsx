import { render, RenderOptions } from '@testing-library/react';
import { ReactElement } from 'react';

import { VsCodeApi } from '@shared/messageContracts';

import { createMockVsCodeApi } from './vscodeApi';

export interface CustomRenderOptions extends Omit<RenderOptions, 'wrapper'> {
	/** Custom VS Code API mock (defaults to createMockVsCodeApi()) */
	vscodeApi?: VsCodeApi;
}

/**
 * Wraps React Testing Library's render with VS Code webview API support.
 * The returned result carries the `vscodeApi` that was used.
 */
export function renderWithProviders(
	ui: ReactElement,
	options?: CustomRenderOptions
) {
	const { vscodeApi = createMockVsCodeApi(), ...renderOptions } = options || {};

	const renderResult = render(ui, renderOptions);

	return {
		...renderResult,
		vscodeApi,
	};
}

export * from '@testing-library/react';

// Re-exported as a named export so tests can `import { userEvent }` from here.
export { default as userEvent } from '@testing-library/user-event';
