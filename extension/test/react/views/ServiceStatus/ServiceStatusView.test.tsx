import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { createMockVsCodeApi, dispatchExtensionMessage } from '@test/react/__helpers__/vscodeApi';
import { ServiceStatusView } from '@webview/views/ServiceStatus/ServiceStatusView';

/** Dispatch serviceStatusInit so the view transitions past the loading skeleton. */
function initView(serverUrl = '') {
	dispatchExtensionMessage({
		type: 'serviceStatusInit',
		serverUrl,
	});
}

describe('ServiceStatusView', () => {
	it('renders the Service Status header', async () => {
		const mockApi = createMockVsCodeApi();
		render(<ServiceStatusView vscodeApi={mockApi} />);
		initView();
		await waitFor(() => {
			expect(screen.getByText('Service Status')).toBeInTheDocument();
		});
	});

	it('renders back link to Dashboard', () => {
		const mockApi = createMockVsCodeApi();
		render(<ServiceStatusView vscodeApi={mockApi} />);
		expect(screen.getByText('Back to Dashboard')).toBeInTheDocument();
	});

	it('clicking back link sends backToDashboard postMessage', async () => {
		const mockApi = createMockVsCodeApi();
		render(<ServiceStatusView vscodeApi={mockApi} />);

		const backLink = screen.getByText('Back to Dashboard');
		await userEvent.click(backLink);

		expect(mockApi.postMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				type: 'command',
				command: 'backToDashboard',
			})
		);
	});

	it('shows "No health check results available" when no results', async () => {
		const mockApi = createMockVsCodeApi();
		render(<ServiceStatusView vscodeApi={mockApi} />);
		initView();
		await waitFor(() => {
			expect(screen.getByText('No health check results available')).toBeInTheDocument();
		});
	});

	it('shows server URL when serviceStatusInit message received', async () => {
		const mockApi = createMockVsCodeApi();
		render(<ServiceStatusView vscodeApi={mockApi} />);

		initView('https://artemis.example.com');

		await waitFor(() => {
			const serverInput = screen.getByDisplayValue('https://artemis.example.com');
			expect(serverInput).toBeInTheDocument();
		});
	});

	it('triggers health check postMessage when serviceStatusInit has serverUrl', async () => {
		const mockApi = createMockVsCodeApi();
		render(<ServiceStatusView vscodeApi={mockApi} />);

		initView('https://artemis.example.com');

		await waitFor(() => {
			expect(mockApi.postMessage).toHaveBeenCalledWith(
				expect.objectContaining({
					type: 'command',
					command: 'performHealthChecks',
					payload: expect.objectContaining({ serverUrl: 'https://artemis.example.com' }),
				})
			);
		});
	});

	it('shows health check results after healthCheckResults message', async () => {
		const mockApi = createMockVsCodeApi();
		render(<ServiceStatusView vscodeApi={mockApi} />);
		initView();

		dispatchExtensionMessage({
			type: 'healthCheckResults',
			results: {
				serverReachability: { status: 'online', message: 'OK', endpoint: '/health', httpStatus: 200, response: null },
			},
		});

		await waitFor(() => {
			expect(screen.getByText('Server Reachability')).toBeInTheDocument();
		});
	});

	it('persists server URL in vscode state', async () => {
		const mockApi = createMockVsCodeApi();
		render(<ServiceStatusView vscodeApi={mockApi} />);

		initView('https://artemis.test.com');

		await waitFor(() => {
			expect(mockApi.setState).toHaveBeenCalledWith(
				expect.objectContaining({ serverUrl: 'https://artemis.test.com' })
			);
		});
	});

	it('restores persisted serverUrl from getState', async () => {
		const mockApi = createMockVsCodeApi({
			getState: <T = unknown>() => ({ serverUrl: 'https://saved-server.com' }) as T | undefined,
		});
		render(<ServiceStatusView vscodeApi={mockApi} />);
		initView('https://saved-server.com');
		await waitFor(() => {
			const serverInput = screen.getByDisplayValue('https://saved-server.com');
			expect(serverInput).toBeInTheDocument();
		});
	});
});
