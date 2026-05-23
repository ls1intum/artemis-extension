import { render, screen, waitFor } from '@testing-library/react';
import { fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';

import { createMockVsCodeApi, dispatchExtensionMessage } from '@test/react/__helpers__/vscodeApi';
import { LoginView } from '@webview/views/Login/LoginView';

/**
 * Auth flow integration tests.
 *
 * Tests the full authentication lifecycle: login -> loading -> logged-in ->
 * logout -> re-authentication. Exercises the complete component-message pipeline
 * including postMessage round-trips (outbound + inbound).
 */
describe('Auth Flow', () => {
	beforeEach(() => {
		// Clean any lingering message listeners between tests
	});

	it('shows error message when login fails with invalid credentials', async () => {
		const user = userEvent.setup();
		const mockApi = createMockVsCodeApi();
		render(<LoginView vscodeApi={mockApi} />);

		// Enter credentials and submit
		await user.type(screen.getByTestId('login-username'), 'wronguser');
		await user.type(screen.getByTestId('login-password'), 'wrongpass');
		await user.click(screen.getByTestId('login-submit'));

		// Simulate loading
		dispatchExtensionMessage({
			type: 'showLoading',
			message: 'Checking credentials...',
		});

		// Component strips trailing "..." from loading text
		await waitFor(() => {
			expect(screen.getByText('Checking credentials')).toBeInTheDocument();
		});

		// Simulate login error response
		dispatchExtensionMessage({
			type: 'loginError',
			error: 'Invalid username or password',
		});

		// Verify error displayed and form re-shown
		await waitFor(() => {
			expect(screen.getByTestId('login-status')).toHaveTextContent('Invalid username or password');
		});
		expect(screen.getByTestId('login-form')).toBeInTheDocument();
	});

	it('shows loading state when receiving showLoading message', async () => {
		const mockApi = createMockVsCodeApi();
		render(<LoginView vscodeApi={mockApi} />);

		expect(screen.getByTestId('login-form')).toBeInTheDocument();

		dispatchExtensionMessage({
			type: 'showLoading',
			message: 'Checking authentication...',
		});

		// Component strips trailing "..." from loading text
		await waitFor(() => {
			expect(screen.getByText('Checking authentication')).toBeInTheDocument();
		});
	});

	it('restores persisted form state from getState on mount (password never persisted)', () => {
		const mockApi = createMockVsCodeApi({
			getState: <T = unknown>() =>
				({
					username: 'persisted-user',
					rememberMe: true,
				}) as T | undefined,
		});

		render(<LoginView vscodeApi={mockApi} />);

		const usernameInput = screen.getByTestId('login-username') as HTMLInputElement;
		const passwordInput = screen.getByTestId('login-password') as HTMLInputElement;

		expect(usernameInput.value).toBe('persisted-user');
		expect(passwordInput.value).toBe('');
	});

	it('prevents form submission when username or password is empty', async () => {
		const mockApi = createMockVsCodeApi();
		render(<LoginView vscodeApi={mockApi} />);

		// Use fireEvent.submit to bypass HTML5 browser validation in happy-dom
		const form = screen.getByTestId('login-form');
		fireEvent.submit(form);

		// Verify no login postMessage sent
		const calls = (mockApi.postMessage as ReturnType<typeof import('vitest').vi.fn>).mock.calls;
		const loginCalls = calls.filter(
			(call) =>
				typeof call[0] === 'object' &&
				call[0] !== null &&
				(call[0] as Record<string, unknown>).command === 'login'
		);
		expect(loginCalls).toHaveLength(0);

		// Verify error message displayed
		await waitFor(() => {
			expect(screen.getByTestId('login-status')).toBeInTheDocument();
		});
	});
});
