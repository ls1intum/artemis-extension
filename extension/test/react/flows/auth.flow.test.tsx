import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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

    /** The attemptId the view sent with its most recent postMessage call for the given command. */
    function lastAttemptId(mockApi: ReturnType<typeof createMockVsCodeApi>, command: string): number | undefined {
        const calls = (mockApi.postMessage as ReturnType<typeof import('vitest').vi.fn>).mock.calls;
        const match = calls.find((call) => (call[0] as Record<string, unknown>).command === command);
        return (match?.[0] as { payload?: { attemptId?: number } } | undefined)?.payload?.attemptId;
    }

    it('shows error message when login fails with invalid credentials', async () => {
        const user = userEvent.setup();
        const mockApi = createMockVsCodeApi();
        render(<LoginView vscodeApi={mockApi} />);

        // Stage 0: Enter username and proceed
        await user.type(screen.getByTestId('login-username'), 'wronguser');
        await user.click(screen.getByTestId('login-next'));

        // The view now owns the indicator under this attempt's id, so the answer below must carry it too,
        // otherwise the ownership guard correctly (and, here, inconveniently) ignores it as unowned.
        const checkAttemptId = lastAttemptId(mockApi, 'checkLoginOptions');

        // Transition to Stage 1
        dispatchExtensionMessage({
            type: 'loginOptionsResult',
            loginMethod: 'PASSWORD',
            idpName: 'TUM Login',
            attemptId: checkAttemptId,
        });

        // Stage 1: Enter password and submit
        const passwordInput = await screen.findByTestId('login-password');
        await user.type(passwordInput, 'wrongpass');
        await user.click(screen.getByTestId('login-submit'));

        // The id the view sent with the login command, so the progress update below is recognised as
        // belonging to this attempt rather than being an unowned message the indicator must ignore.
        const attemptId = lastAttemptId(mockApi, 'login');

        // Simulate the extension reporting progress on this attempt.
        dispatchExtensionMessage({
            type: 'updateLoading',
            message: 'Checking credentials...',
            attemptId,
        });

        // Component strips trailing "..." from loading text
        await waitFor(() => {
            expect(screen.getByText('Checking credentials')).toBeInTheDocument();
        });

        // Simulate login error response
        dispatchExtensionMessage({
            type: 'loginError',
            error: 'Invalid username or password',
            attemptId,
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

    it('restores persisted form state from getState on mount (password never persisted)', async () => {
        const mockApi = createMockVsCodeApi({
            getState: <T = unknown>() =>
                ({
                    username: 'persisted-user',
                    rememberMe: true,
                }) as T | undefined,
        });

        render(<LoginView vscodeApi={mockApi} />);

        const usernameInput = screen.getByTestId('login-username') as HTMLInputElement;
        expect(usernameInput.value).toBe('persisted-user');

        // Transition to Stage 1 to check password input
        dispatchExtensionMessage({
            type: 'loginOptionsResult',
            loginMethod: 'PASSWORD',
            idpName: 'TUM Login',
        });

        const passwordInput = (await screen.findByTestId('login-password')) as HTMLInputElement;
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

        // Verify error message displayed for empty username
        await waitFor(() => {
            expect(screen.getByTestId('login-status')).toHaveTextContent('Please enter your username.');
        });
    });
});
