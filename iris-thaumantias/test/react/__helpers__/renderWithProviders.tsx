import { render, RenderOptions } from '@testing-library/react';
import { ReactElement } from 'react';
import { VsCodeApi } from '../../../src/shared/messageContracts';
import { createMockVsCodeApi } from './vscodeApi';

/**
 * Custom render options that extend React Testing Library's RenderOptions.
 */
export interface CustomRenderOptions extends Omit<RenderOptions, 'wrapper'> {
	/** Custom VS Code API mock (defaults to createMockVsCodeApi()) */
	vscodeApi?: VsCodeApi;
}

/**
 * Custom render function that wraps React Testing Library's render
 * with VS Code webview API support.
 *
 * @param ui - The React element to render
 * @param options - Optional render options including custom vscodeApi
 * @returns Render result with vscodeApi attached
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

// Re-export everything from React Testing Library
export * from '@testing-library/react';

// Re-export userEvent from @testing-library/user-event
export { default as userEvent } from '@testing-library/user-event';
