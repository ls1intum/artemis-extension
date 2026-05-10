import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LoginView } from '../../../../src/webview/views/Login/LoginView';
import { createMockVsCodeApi, dispatchExtensionMessage } from '../../__helpers__/vscodeApi';

describe('LoginView', () => {
	it('renders login form by default', () => {
		const mockApi = createMockVsCodeApi();
		render(<LoginView vscodeApi={mockApi} />);

		expect(screen.getByTestId('login-username')).toBeInTheDocument();
		expect(screen.getByTestId('login-password')).toBeInTheDocument();
		expect(screen.getByTestId('login-submit')).toBeInTheDocument();
	});

	it('persists form state via setState', async () => {
		const mockApi = createMockVsCodeApi();
		render(<LoginView vscodeApi={mockApi} />);

		const usernameInput = screen.getByTestId('login-username');
		await userEvent.type(usernameInput, 'testuser');

		// Wait for the useEffect that calls setState to fire
		await waitFor(() => {
			expect(mockApi.setState).toHaveBeenCalled();
		});

		// Check that setState was called with an object containing the username
		const calls = (mockApi.setState as ReturnType<typeof vi.fn>).mock.calls;
		const lastCall = calls[calls.length - 1][0];
		expect(lastCall).toMatchObject({ username: 'testuser' });
	});

	it('sends login command on form submit', async () => {
		const mockApi = createMockVsCodeApi();
		render(<LoginView vscodeApi={mockApi} />);

		const usernameInput = screen.getByTestId('login-username');
		const passwordInput = screen.getByTestId('login-password');
		const submitButton = screen.getByTestId('login-submit');

		await userEvent.type(usernameInput, 'testuser');
		await userEvent.type(passwordInput, 'testpass');
		await userEvent.click(submitButton);

		// Verify postMessage was called with login command
		await waitFor(() => {
			expect(mockApi.postMessage).toHaveBeenCalledWith(
				expect.objectContaining({
					type: 'command',
					command: 'login',
					payload: expect.objectContaining({
						username: 'testuser',
						password: 'testpass',
					}),
				})
			);
		});
	});

	it('shows loading state when receiving showLoading message', async () => {
		const mockApi = createMockVsCodeApi();
		render(<LoginView vscodeApi={mockApi} />);

		// Initially form should be visible
		expect(screen.getByTestId('login-form')).toBeInTheDocument();

		// Dispatch showLoading message
		dispatchExtensionMessage({
			type: 'showLoading',
			message: 'Checking credentials...',
		});

		// Wait for loading UI to appear (component strips trailing "..." from loading text)
		await waitFor(() => {
			expect(screen.getByText('Checking credentials')).toBeInTheDocument();
		});
	});

	it('returns to form on hideLoading message', async () => {
		const mockApi = createMockVsCodeApi();
		render(<LoginView vscodeApi={mockApi} />);

		// Show loading (component strips trailing "..." from loading text)
		dispatchExtensionMessage({
			type: 'showLoading',
			message: 'Processing...',
		});

		await waitFor(() => {
			expect(screen.getByText('Processing')).toBeInTheDocument();
		});

		// Hide loading
		dispatchExtensionMessage({
			type: 'hideLoading',
		});

		// Wait for loading indicator to disappear (300ms animation delay)
		await waitFor(() => {
			expect(screen.queryByText('Processing')).not.toBeInTheDocument();
		});
	});

	it('restores persisted state from getState', () => {
		const mockApi = createMockVsCodeApi({
			getState: <T = unknown>() => ({
				username: 'saved-user',
				rememberMe: true,
			}) as T | undefined,
		});

		render(<LoginView vscodeApi={mockApi} />);

		const usernameInput = screen.getByTestId('login-username') as HTMLInputElement;
		const passwordInput = screen.getByTestId('login-password') as HTMLInputElement;

		expect(usernameInput.value).toBe('saved-user');
		expect(passwordInput.value).toBe('');
	});

	it('displays error message on loginError', async () => {
		const mockApi = createMockVsCodeApi();
		render(<LoginView vscodeApi={mockApi} />);

		dispatchExtensionMessage({
			type: 'loginError',
			error: 'Invalid credentials',
		});

		await waitFor(() => {
			expect(screen.getByTestId('login-status')).toHaveTextContent('Invalid credentials');
		});
	});

});
