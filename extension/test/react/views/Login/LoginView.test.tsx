import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { createMockVsCodeApi, dispatchExtensionMessage } from '@test/react/__helpers__/vscodeApi';
import { LoginView } from '@webview/views/Login/LoginView';

describe('LoginView - Two-Stage & OIDC Flow', () => {
    it('starts on Stage 0 with username field and Continue button', () => {
        const mockApi = createMockVsCodeApi();
        render(<LoginView vscodeApi={mockApi} />);

        expect(screen.getByTestId('login-username')).toBeInTheDocument();
        expect(screen.getByTestId('login-next')).toBeInTheDocument();
        expect(screen.queryByTestId('login-password')).not.toBeInTheDocument();
    });

    it('sends checkLoginOptions command on Stage 0 submit', async () => {
        const mockApi = createMockVsCodeApi();
        render(<LoginView vscodeApi={mockApi} />);

        const usernameInput = screen.getByTestId('login-username');
        await userEvent.type(usernameInput, 'teststudent');
        await userEvent.click(screen.getByTestId('login-next'));

        await waitFor(() => {
            expect(mockApi.postMessage).toHaveBeenCalledWith({
                type: 'command',
                command: 'checkLoginOptions',
                payload: { username: 'teststudent', attemptId: expect.any(Number) },
            });
        });
    });

    it('transitions to Stage 1 with password input when loginMethod is PASSWORD', async () => {
        const mockApi = createMockVsCodeApi();
        render(<LoginView vscodeApi={mockApi} />);

        dispatchExtensionMessage({
            type: 'loginOptionsResult',
            loginMethod: 'PASSWORD',
            idpName: 'TUM Login',
        });

        await waitFor(() => {
            expect(screen.getByTestId('login-password')).toBeInTheDocument();
            expect(screen.getByTestId('login-submit')).toHaveTextContent('Login to Artemis');
        });
    });

    it('transitions to Stage 1 with OIDC button and text when loginMethod is OIDC', async () => {
        const mockApi = createMockVsCodeApi();
        render(<LoginView vscodeApi={mockApi} />);

        dispatchExtensionMessage({
            type: 'loginOptionsResult',
            loginMethod: 'OIDC',
            idpName: 'TUM Login',
        });

        await waitFor(() => {
            expect(screen.queryByTestId('login-password')).not.toBeInTheDocument();
            expect(screen.getByTestId('login-oidc-submit')).toHaveTextContent('Sign in with TUM Login');
            expect(screen.getByText(/You will be redirected to complete authentication via TUM Login/i)).toBeInTheDocument();
        });
    });

    it('sends startOidcLogin command with rememberMe flag on OIDC button click', async () => {
        const mockApi = createMockVsCodeApi();
        render(<LoginView vscodeApi={mockApi} />);

        const usernameInput = screen.getByTestId('login-username');
        await userEvent.type(usernameInput, 'teststudent');

        dispatchExtensionMessage({
            type: 'loginOptionsResult',
            loginMethod: 'OIDC',
            idpName: 'TUM Login',
        });

        await waitFor(() => {
            expect(screen.getByTestId('login-oidc-submit')).toBeInTheDocument();
        });

        await userEvent.click(screen.getByTestId('login-oidc-submit'));

        await waitFor(() => {
            expect(mockApi.postMessage).toHaveBeenCalledWith({
                type: 'command',
                command: 'startOidcLogin',
                payload: {
                    rememberMe: true,
                },
            });
            expect(screen.getByTestId('login-status')).toHaveTextContent(/Redirecting to TUM Login/i);
        });
    });
    it('offers no sign-in for SAML2 and does not start OIDC on submit', async () => {
        const mockApi = createMockVsCodeApi();
        render(<LoginView vscodeApi={mockApi} />);

        dispatchExtensionMessage({
            type: 'loginOptionsResult',
            loginMethod: 'SAML2',
            idpName: 'TUM Login',
        });

        await waitFor(() => {
            expect(screen.getByText(/cannot\s+complete yet/i)).toBeInTheDocument();
        });
        expect(screen.queryByTestId('login-oidc-submit')).not.toBeInTheDocument();
        expect(screen.queryByTestId('login-submit')).not.toBeInTheDocument();

        fireEvent.submit(screen.getByTestId('login-form'));

        const started = (mockApi.postMessage as ReturnType<typeof vi.fn>).mock.calls.filter(
            call => (call[0] as Record<string, unknown>).command === 'startOidcLogin'
        );
        expect(started).toHaveLength(0);
    });

    it('sends startOidcLogin only once however often the button is clicked', async () => {
        const mockApi = createMockVsCodeApi();
        render(<LoginView vscodeApi={mockApi} />);

        dispatchExtensionMessage({
            type: 'loginOptionsResult',
            loginMethod: 'OIDC',
            idpName: 'TUM Login',
        });

        const button = await screen.findByTestId('login-oidc-submit');
        await userEvent.click(button);

        // The button is out of reach once an attempt is in flight, so a real second click is impossible.
        expect(button).toBeDisabled();
        // Belt and braces: the handler refuses a re-entrant call too, since every start replaces the
        // pending attempt on the extension side and would strand the browser tab already open.
        fireEvent.click(button);
        fireEvent.submit(screen.getByTestId('login-form'));

        const started = (mockApi.postMessage as ReturnType<typeof vi.fn>).mock.calls.filter(
            call => (call[0] as Record<string, unknown>).command === 'startOidcLogin'
        );
        expect(started).toHaveLength(1);
    });

    it('Back stays usable during a browser sign-in and retracts the attempt', async () => {
        const mockApi = createMockVsCodeApi();
        render(<LoginView vscodeApi={mockApi} />);

        dispatchExtensionMessage({
            type: 'loginOptionsResult',
            loginMethod: 'OIDC',
            idpName: 'TUM Login',
        });

        await userEvent.click(await screen.findByTestId('login-oidc-submit'));
        await userEvent.click(screen.getByRole('button', { name: /Back/i }));

        await waitFor(() => {
            expect(screen.getByTestId('login-username')).toBeInTheDocument();
        });
        const cancelled = (mockApi.postMessage as ReturnType<typeof vi.fn>).mock.calls.filter(
            call => (call[0] as Record<string, unknown>).command === 'cancelLogin'
        );
        expect(cancelled).toHaveLength(1);

        // The next account may well be a password one, so the previous method must not linger.
        dispatchExtensionMessage({ type: 'loginOptionsResult', loginMethod: 'PASSWORD', idpName: null });
        await waitFor(() => {
            expect(screen.getByTestId('login-password')).toBeInTheDocument();
        });
    });
});

// RTL's `findBy*`/`waitFor` poll on a real setTimeout/setInterval; under `vi.useFakeTimers()` nothing
// ever advances that clock, so they hang until the test itself times out (vitest-dev/vitest#3184, the
// same gap already worked around elsewhere in this suite). The two tests below that need to control the
// indicator's 300ms teardown therefore do their interaction with `userEvent`/`findBy*` first, under the
// default real timers, and only switch to fake timers afterwards, for the single `setTimeout` the
// dispatch under test schedules; every assertion once fake timers are active uses the synchronous
// `getByTestId`/`queryByTestId` rather than the polling `findByTestId`.
describe('LoginView - progress indicator and ownership', () => {
    /** Reach stage 1 and submit a password login, returning the id the view sent with it. */
    async function submitPasswordLogin(mockApi: ReturnType<typeof createMockVsCodeApi>): Promise<number> {
        // handleSubmit's password branch validates both fields, so the submit below is a no-op without a
        // username too, even though the dispatch under test skips checkLoginOptions to reach stage 1.
        await userEvent.type(screen.getByTestId('login-username'), 'teststudent');
        dispatchExtensionMessage({ type: 'loginOptionsResult', loginMethod: 'PASSWORD', idpName: null });
        await userEvent.type(await screen.findByTestId('login-password'), 'secret');
        await userEvent.click(screen.getByTestId('login-submit'));
        return currentAttemptId(mockApi);
    }

    /** The attemptId the view sent with its most recent interactive command. */
    function currentAttemptId(mockApi: ReturnType<typeof createMockVsCodeApi>): number {
        const calls = (mockApi.postMessage as ReturnType<typeof vi.fn>).mock.calls as Array<[Record<string, never>]>;
        const interactive = calls
            .map(call => call[0] as unknown as { command?: string; payload?: { attemptId?: number } })
            .filter(msg => msg.command === 'login' || msg.command === 'checkLoginOptions');
        const last = interactive[interactive.length - 1];
        if (!last?.payload?.attemptId) {
            throw new Error('the view has not started an interactive attempt yet');
        }
        return last.payload.attemptId;
    }

    it('shows a named step as soon as the password login is submitted', async () => {
        const mockApi = createMockVsCodeApi();
        render(<LoginView vscodeApi={mockApi} />);
        await userEvent.type(screen.getByTestId('login-username'), 'teststudent');
        dispatchExtensionMessage({ type: 'loginOptionsResult', loginMethod: 'PASSWORD', idpName: null });
        await userEvent.type(await screen.findByTestId('login-password'), 'secret');

        await userEvent.click(screen.getByTestId('login-submit'));

        const indicator = await screen.findByTestId('login-progress');
        expect(indicator).toHaveTextContent('Verifying your credentials');
        expect(indicator).toHaveTextContent('Checking your username and password');
        expect(indicator).toHaveAttribute('role', 'status');
        expect(indicator).toHaveAttribute('aria-live', 'polite');
    });

    it('renames the step when the extension moves on', async () => {
        const mockApi = createMockVsCodeApi();
        render(<LoginView vscodeApi={mockApi} />);
        const attemptId = await submitPasswordLogin(mockApi);

        dispatchExtensionMessage({
            type: 'updateLoading',
            message: 'Loading your profile',
            subtext: 'Fetching your account details',
            attemptId,
        });

        expect(await screen.findByTestId('login-progress')).toHaveTextContent('Loading your profile');
    });

    it('removes the indicator when the login succeeds', async () => {
        const mockApi = createMockVsCodeApi();
        render(<LoginView vscodeApi={mockApi} />);
        const attemptId = await submitPasswordLogin(mockApi);

        // Only now: the interaction above needed real timers for `findBy*`/`userEvent` to resolve at all.
        vi.useFakeTimers();
        try {
            dispatchExtensionMessage({ type: 'loginSuccess', username: 'student', attemptId });
            act(() => { vi.advanceTimersByTime(300); });

            expect(screen.queryByTestId('login-progress')).not.toBeInTheDocument();
        } finally {
            vi.useRealTimers();
        }
    });

    it('removes the indicator unconditionally for an OIDC result, which carries no attemptId', async () => {
        const mockApi = createMockVsCodeApi();
        render(<LoginView vscodeApi={mockApi} />);
        await submitPasswordLogin(mockApi);

        // Only now: the interaction above needed real timers for `findBy*`/`userEvent` to resolve at all.
        vi.useFakeTimers();
        try {
            // No attemptId: this is how a real OIDC loginSuccess/loginError arrives, since that browser
            // flow outlives the webview and there is no counter to send back. `ownsProgress(undefined)`
            // would say no here (the indicator's owner is a real attempt id), so this proves the
            // unconditional call, not the ownership guard, is what clears it.
            dispatchExtensionMessage({ type: 'loginSuccess', username: 'student' });
            act(() => { vi.advanceTimersByTime(300); });

            expect(screen.queryByTestId('login-progress')).not.toBeInTheDocument();
        } finally {
            vi.useRealTimers();
        }
    });

    it('ignores unowned startup loading messages while an interactive attempt owns the indicator', async () => {
        const mockApi = createMockVsCodeApi();
        render(<LoginView vscodeApi={mockApi} />);
        await submitPasswordLogin(mockApi);

        dispatchExtensionMessage({ type: 'hideLoading' });
        dispatchExtensionMessage({ type: 'updateLoading', message: 'Loading user information...' });

        const indicator = await screen.findByTestId('login-progress');
        expect(indicator).toHaveTextContent('Verifying your credentials');
    });

    it('a stale login-options answer cannot touch a different attempt already in progress', async () => {
        const mockApi = createMockVsCodeApi();
        render(<LoginView vscodeApi={mockApi} />);
        const attemptId = await submitPasswordLogin(mockApi);

        // A mismatched id, standing in for an answer to an earlier, already-superseded attempt. Given a
        // different login method too, a leak would show up both in the indicator and in the form.
        dispatchExtensionMessage({
            type: 'loginOptionsResult',
            loginMethod: 'OIDC',
            idpName: 'Some Other IdP',
            attemptId: attemptId + 1000,
        });

        expect(screen.getByTestId('login-progress')).toHaveTextContent('Verifying your credentials');
        expect(screen.getByTestId('login-submit')).toBeInTheDocument();
        expect(screen.queryByTestId('login-oidc-submit')).not.toBeInTheDocument();
    });

    it('keeps ownership through the teardown, so a late startup hide cannot touch it', async () => {
        const mockApi = createMockVsCodeApi();
        render(<LoginView vscodeApi={mockApi} />);
        const attemptId = await submitPasswordLogin(mockApi);

        // Only now: the interaction above needed real timers for `findBy*`/`userEvent` to resolve at all.
        vi.useFakeTimers();
        try {
            dispatchExtensionMessage({ type: 'loginError', error: 'nope', attemptId });

            // Still inside the 300ms teardown: the indicator is on screen and must still be owned.
            act(() => { vi.advanceTimersByTime(100); });
            dispatchExtensionMessage({ type: 'updateLoading', message: 'Loading user information...' });

            expect(screen.getByTestId('login-progress')).toHaveTextContent('Verifying your credentials');
        } finally {
            vi.useRealTimers();
        }
    });

    it('a late unowned hideLoading cannot cut the teardown short either', async () => {
        const mockApi = createMockVsCodeApi();
        render(<LoginView vscodeApi={mockApi} />);
        const attemptId = await submitPasswordLogin(mockApi);

        // Only now: the interaction above needed real timers for `findBy*`/`userEvent` to resolve at all.
        vi.useFakeTimers();
        try {
            dispatchExtensionMessage({ type: 'loginError', error: 'nope', attemptId });

            act(() => { vi.advanceTimersByTime(100); });
            dispatchExtensionMessage({ type: 'hideLoading' });

            // Still fading under its own owner: an unowned startup hideLoading must not disturb it.
            expect(screen.getByTestId('login-progress')).toHaveTextContent('Verifying your credentials');

            act(() => { vi.advanceTimersByTime(200); });
            // The genuine attempt's own teardown still completes on its original schedule.
            expect(screen.queryByTestId('login-progress')).not.toBeInTheDocument();
        } finally {
            vi.useRealTimers();
        }
    });

    it('offers Cancel while a password login is in flight and Back otherwise', async () => {
        const mockApi = createMockVsCodeApi();
        render(<LoginView vscodeApi={mockApi} />);
        // handleSubmit's password branch validates both fields, so a username is needed for the submit
        // below to actually go anywhere, even though the dispatch skips checkLoginOptions to reach stage 1.
        await userEvent.type(screen.getByTestId('login-username'), 'teststudent');
        dispatchExtensionMessage({ type: 'loginOptionsResult', loginMethod: 'PASSWORD', idpName: null });
        await userEvent.type(await screen.findByTestId('login-password'), 'secret');
        expect(screen.getByTestId('login-secondary')).toHaveTextContent('← Back');

        await userEvent.click(screen.getByTestId('login-submit'));

        expect(screen.getByTestId('login-secondary')).toHaveTextContent('Cancel');
        expect(screen.getByTestId('login-secondary')).toBeEnabled();
    });

    it('cancelling unlocks the form and stays on the password step', async () => {
        const mockApi = createMockVsCodeApi();
        render(<LoginView vscodeApi={mockApi} />);
        await submitPasswordLogin(mockApi);

        // Only now: the interaction above needed real timers for `findBy*`/`userEvent` to resolve at all.
        // The click itself uses `fireEvent`, not `userEvent`, so the `setTimeout` it schedules (inside
        // `hideProgress`) is the one fake timers below actually control.
        vi.useFakeTimers();
        try {
            fireEvent.click(screen.getByTestId('login-secondary'));

            expect(mockApi.postMessage).toHaveBeenCalledWith({ type: 'command', command: 'cancelLogin' });
            act(() => { vi.advanceTimersByTime(300); });
            expect(screen.queryByTestId('login-progress')).not.toBeInTheDocument();
            expect(screen.getByTestId('login-password')).toBeEnabled();
            expect(screen.getByTestId('login-password')).toHaveValue('secret');
        } finally {
            vi.useRealTimers();
        }
    });

    it('offers Cancel while the username step is checking', async () => {
        const mockApi = createMockVsCodeApi();
        render(<LoginView vscodeApi={mockApi} />);
        await userEvent.type(screen.getByTestId('login-username'), 'ab12cde');
        await userEvent.click(screen.getByTestId('login-next'));

        await userEvent.click(await screen.findByTestId('login-secondary'));

        expect(mockApi.postMessage).toHaveBeenCalledWith({ type: 'command', command: 'cancelLogin' });
        expect(screen.getByTestId('login-username')).toBeEnabled();
    });

    it('ignores a loginOptionsResult belonging to a stage 0 lookup the user has since retracted', async () => {
        const mockApi = createMockVsCodeApi();
        render(<LoginView vscodeApi={mockApi} />);
        await userEvent.type(screen.getByTestId('login-username'), 'teststudent');
        await userEvent.click(screen.getByTestId('login-next'));
        const attemptId = currentAttemptId(mockApi);

        await userEvent.click(await screen.findByTestId('login-secondary'));

        // The extension had already answered the lookup the user has since retracted.
        dispatchExtensionMessage({ type: 'loginOptionsResult', loginMethod: 'PASSWORD', idpName: null, attemptId });

        expect(screen.queryByTestId('login-password')).not.toBeInTheDocument();
        expect(screen.getByTestId('login-username')).toBeInTheDocument();
    });

    it('ignores a result belonging to an attempt that was retracted', async () => {
        const mockApi = createMockVsCodeApi();
        render(<LoginView vscodeApi={mockApi} />);
        const attemptId = await submitPasswordLogin(mockApi);

        // Only now, for the same reason as the test above: the click below uses `fireEvent` so its
        // `setTimeout` is the one fake timers control.
        vi.useFakeTimers();
        try {
            fireEvent.click(screen.getByTestId('login-secondary'));
            act(() => { vi.advanceTimersByTime(300); });

            // The extension had already answered the attempt the user has since retracted.
            dispatchExtensionMessage({ type: 'loginSuccess', username: 'student', attemptId });

            expect(screen.queryByTestId('login-progress')).not.toBeInTheDocument();
            expect(screen.getByTestId('login-password')).toBeEnabled();
        } finally {
            vi.useRealTimers();
        }
    });

    it('a second submit while one is in flight posts nothing', async () => {
        const mockApi = createMockVsCodeApi();
        render(<LoginView vscodeApi={mockApi} />);
        await submitPasswordLogin(mockApi);

        const postMessage = mockApi.postMessage as ReturnType<typeof vi.fn>;
        const before = postMessage.mock.calls.length;
        fireEvent.submit(screen.getByTestId('login-form'));

        expect(postMessage.mock.calls.length).toBe(before);
    });
});
