import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { fireEvent } from '@testing-library/react';
import { LoginView } from '../../../src/views/webview/react/views/Login/LoginView';
import { createMockVsCodeApi, dispatchExtensionMessage } from '../__helpers__/vscodeApi';

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

	it('completes full auth lifecycle: login -> loading -> logged-in -> logout -> re-auth', async () => {
		const user = userEvent.setup();
		const mockApi = createMockVsCodeApi();
		render(<LoginView vscodeApi={mockApi} />);

		// Step 1: Verify login form displayed
		expect(screen.getByTestId('login-form')).toBeInTheDocument();
		expect(screen.getByTestId('login-username')).toBeInTheDocument();
		expect(screen.getByTestId('login-password')).toBeInTheDocument();

		// Step 2: Enter credentials
		await user.type(screen.getByTestId('login-username'), 'testuser');
		await user.type(screen.getByTestId('login-password'), 'testpass');

		// Step 3: Submit login form
		await user.click(screen.getByTestId('login-submit'));

		// Step 4: OUTBOUND — verify login postMessage sent with correct payload
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

		// Step 5: INBOUND — simulate extension loading response
		dispatchExtensionMessage({
			type: 'showLoading',
			payload: { message: 'Authenticating...' },
		});

		// Step 6: Verify loading state displayed
		await waitFor(() => {
			expect(screen.getByText('Authenticating...')).toBeInTheDocument();
		});
		expect(screen.queryByTestId('login-form')).not.toBeInTheDocument();

		// Step 7: INBOUND — simulate successful login
		dispatchExtensionMessage({
			type: 'showLoggedIn',
			payload: {
				userInfo: {
					username: 'testuser',
					serverUrl: 'https://artemis.example.com',
				},
			},
		});

		// Step 8: INBOUND — verify logged-in state displayed
		await waitFor(() => {
			expect(screen.getByText('testuser')).toBeInTheDocument();
			expect(screen.getByText('https://artemis.example.com')).toBeInTheDocument();
		});
		expect(screen.queryByTestId('login-form')).not.toBeInTheDocument();

		// Step 9: Click logout button
		const logoutButton = screen.getByText('Logout from Artemis');
		await user.click(logoutButton);

		// Step 10: OUTBOUND — verify logout postMessage sent
		expect(mockApi.postMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				type: 'command',
				command: 'logout',
			})
		);

		// Step 11: INBOUND — simulate logout response
		dispatchExtensionMessage({
			type: 'logoutSuccess',
		});

		// Step 12: Verify login form re-displayed (re-authentication ready)
		await waitFor(() => {
			expect(screen.getByTestId('login-form')).toBeInTheDocument();
		});
		expect(screen.queryByText('testuser')).not.toBeInTheDocument();
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
			payload: { message: 'Checking credentials...' },
		});

		await waitFor(() => {
			expect(screen.getByText('Checking credentials...')).toBeInTheDocument();
		});

		// Simulate login error response
		dispatchExtensionMessage({
			type: 'loginError',
			payload: { error: 'Invalid username or password' },
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
			payload: { message: 'Checking authentication...' },
		});

		await waitFor(() => {
			expect(screen.getByText('Checking authentication...')).toBeInTheDocument();
		});
		expect(screen.queryByTestId('login-form')).not.toBeInTheDocument();
	});

	it('restores form state when session is already authenticated on mount', async () => {
		const mockApi = createMockVsCodeApi();
		render(<LoginView vscodeApi={mockApi} />);

		// Simulate extension sending existing session data immediately on mount
		dispatchExtensionMessage({
			type: 'showLoggedIn',
			payload: {
				userInfo: {
					username: 'existinguser',
					serverUrl: 'https://artemis.tum.de',
				},
			},
		});

		// Verify logged-in state shown without requiring any form interaction
		await waitFor(() => {
			expect(screen.getByText('existinguser')).toBeInTheDocument();
			expect(screen.getByText('https://artemis.tum.de')).toBeInTheDocument();
		});
		expect(screen.queryByTestId('login-form')).not.toBeInTheDocument();
	});

	it('restores persisted form state from getState on mount', () => {
		const mockApi = createMockVsCodeApi({
			getState: <T = unknown>() =>
				({
					username: 'persisted-user',
					password: 'persisted-pass',
					rememberMe: true,
				}) as T | undefined,
		});

		render(<LoginView vscodeApi={mockApi} />);

		const usernameInput = screen.getByTestId('login-username') as HTMLInputElement;
		const passwordInput = screen.getByTestId('login-password') as HTMLInputElement;

		expect(usernameInput.value).toBe('persisted-user');
		expect(passwordInput.value).toBe('persisted-pass');
	});

	it('re-authentication works after logout', async () => {
		const user = userEvent.setup();
		const mockApi = createMockVsCodeApi();
		render(<LoginView vscodeApi={mockApi} />);

		// Start in logged-in state
		dispatchExtensionMessage({
			type: 'showLoggedIn',
			payload: { userInfo: { username: 'user1', serverUrl: 'https://artemis.example.com' } },
		});
		await waitFor(() => expect(screen.getByText('user1')).toBeInTheDocument());

		// Logout
		await user.click(screen.getByText('Logout from Artemis'));
		dispatchExtensionMessage({ type: 'logoutSuccess' });
		await waitFor(() => expect(screen.getByTestId('login-form')).toBeInTheDocument());

		// Now re-authenticate as different user
		await user.clear(screen.getByTestId('login-username'));
		await user.type(screen.getByTestId('login-username'), 'user2');
		await user.type(screen.getByTestId('login-password'), 'newpass');
		await user.click(screen.getByTestId('login-submit'));

		// Verify second login postMessage sent
		await waitFor(() => {
			const calls = (mockApi.postMessage as ReturnType<typeof import('vitest').vi.fn>).mock.calls;
			const loginCalls = calls.filter(
				(call) =>
					typeof call[0] === 'object' &&
					call[0] !== null &&
					(call[0] as Record<string, unknown>).command === 'login'
			);
			expect(loginCalls.length).toBeGreaterThanOrEqual(1);
			const lastLoginCall = loginCalls[loginCalls.length - 1][0] as Record<string, unknown>;
			const payload = lastLoginCall.payload as Record<string, unknown>;
			expect(payload.username).toBe('user2');
		});
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
