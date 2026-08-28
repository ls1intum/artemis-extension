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
                payload: { username: 'teststudent', attemptId: expect.any(String) },
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
    /**
     * Enter the handover and wait for it to actually be on screen.
     *
     * The submit these tests start from already left an indicator up ("Verifying your credentials"),
     * so waiting for the element alone resolves against that one and proves nothing: the next
     * message can land before the view has taken the handover, and is then treated as belonging to
     * a login still in flight. Wait for the text only the handover indicator carries.
     */
    async function awaitHandover(message: Record<string, unknown>): Promise<void> {
        act(() => { dispatchExtensionMessage(message); });
        await waitFor(() => {
            expect(screen.getByTestId('login-progress')).toHaveTextContent('Signed in, opening Artemis');
        });
    }

    /** Reach stage 1 and submit a password login, returning the id the view sent with it. */
    async function submitPasswordLogin(mockApi: ReturnType<typeof createMockVsCodeApi>): Promise<string> {
        // handleSubmit's password branch validates both fields, so the submit below is a no-op without a
        // username too, even though the dispatch under test skips checkLoginOptions to reach stage 1.
        await userEvent.type(screen.getByTestId('login-username'), 'teststudent');
        dispatchExtensionMessage({ type: 'loginOptionsResult', loginMethod: 'PASSWORD', idpName: null });
        await userEvent.type(await screen.findByTestId('login-password'), 'secret');
        await userEvent.click(screen.getByTestId('login-submit'));
        return currentAttemptId(mockApi);
    }

    /** The attemptId the view sent with its most recent interactive command. */
    function currentAttemptId(mockApi: ReturnType<typeof createMockVsCodeApi>): string {
        const calls = (mockApi.postMessage as ReturnType<typeof vi.fn>).mock.calls as Array<[Record<string, never>]>;
        const interactive = calls
            .map(call => call[0] as unknown as { command?: string; payload?: { attemptId?: string } })
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

        await waitFor(() => {
            const indicator = screen.getByTestId('login-progress');
            expect(indicator).toHaveTextContent('Verifying your credentials');
            expect(indicator).toHaveTextContent('Checking your username and password');
            expect(indicator).toHaveAttribute('role', 'status');
            expect(indicator).toHaveAttribute('aria-live', 'polite');
        });
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

        await waitFor(() => {
            expect(screen.getByTestId('login-progress')).toHaveTextContent('Loading your profile');
        });
    });

    it('does not reuse an attempt id after the view is recreated', async () => {
        // `render()` replaces the whole webview document, so LoginView remounts and any counter it kept
        // starts over. An answer still in flight for the previous view must not match a question the new
        // one happens to have numbered the same, which is what a bare counter would allow.
        const firstApi = createMockVsCodeApi();
        const first = render(<LoginView vscodeApi={firstApi} />);
        const firstAttempt = await submitPasswordLogin(firstApi);
        first.unmount();

        const secondApi = createMockVsCodeApi();
        render(<LoginView vscodeApi={secondApi} />);
        const secondAttempt = await submitPasswordLogin(secondApi);

        expect(secondAttempt).not.toBe(firstAttempt);
    });

    it('keeps the indicator up after a successful login, because the app is still opening', async () => {
        // Success is the middle of the flow, not the end: the host still has to wire up the
        // authenticated UI, which takes seconds. Tearing the indicator down here is what left the user
        // looking at a form that claimed nothing was happening.
        const mockApi = createMockVsCodeApi();
        render(<LoginView vscodeApi={mockApi} />);
        const attemptId = await submitPasswordLogin(mockApi);

        await awaitHandover({ type: 'loginSuccess', username: 'student', attemptId });
    });

    it('locks the form during the handover and withdraws the way back', async () => {
        const mockApi = createMockVsCodeApi();
        render(<LoginView vscodeApi={mockApi} />);
        const attemptId = await submitPasswordLogin(mockApi);

        await awaitHandover({ type: 'loginSuccess', username: 'student', attemptId });

        expect(screen.getByTestId('login-submit')).toBeDisabled();
        // Not merely disabled: both meanings this button can carry are false past the commit.
        expect(screen.queryByTestId('login-secondary')).not.toBeInTheDocument();
    });

    it('posts nothing when the form is submitted again during the handover', async () => {
        // The submit button is disabled, which a keyboard submit does not care about.
        const mockApi = createMockVsCodeApi();
        render(<LoginView vscodeApi={mockApi} />);
        const attemptId = await submitPasswordLogin(mockApi);

        await awaitHandover({ type: 'loginSuccess', username: 'student', attemptId });

        const before = (mockApi.postMessage as ReturnType<typeof vi.fn>).mock.calls.length;
        fireEvent.submit(screen.getByTestId('login-form'));

        expect((mockApi.postMessage as ReturnType<typeof vi.fn>).mock.calls.length).toBe(before);
    });

    it('accepts an id-less success as OIDC, since that flow outlives the webview', async () => {
        const mockApi = createMockVsCodeApi();
        render(<LoginView vscodeApi={mockApi} />);
        // No attempt of its own: the browser flow has no counter to send back.
        dispatchExtensionMessage({ type: 'loginOptionsResult', loginMethod: 'OIDC', idpName: 'TUM' });
        await screen.findByTestId('login-oidc-submit');

        dispatchExtensionMessage({ type: 'loginSuccess', username: 'student' });

        await waitFor(() => {
            expect(screen.getByTestId('login-progress')).toHaveTextContent('Signed in, opening Artemis');
        });
    });

    it('ignores an id-less success while a password attempt is in flight', async () => {
        // A stale OIDC callback carries no id, so nothing about it says which attempt it answers. While
        // a password attempt is running it cannot be that one's answer, and acting on it would sign the
        // user in behind a login they are still waiting on.
        const mockApi = createMockVsCodeApi();
        render(<LoginView vscodeApi={mockApi} />);
        await submitPasswordLogin(mockApi);

        dispatchExtensionMessage({ type: 'loginSuccess', username: 'someone-else' });

        await waitFor(() => {
            expect(screen.getByTestId('login-progress')).toHaveTextContent('Verifying your credentials');
        });
        expect(screen.getByTestId('login-secondary')).toBeInTheDocument();
    });

    it('offers a reload rather than the form when the handover fails', async () => {
        // The credential is committed, so anything that reads as "authenticate again" would be false.
        const mockApi = createMockVsCodeApi();
        render(<LoginView vscodeApi={mockApi} />);
        const attemptId = await submitPasswordLogin(mockApi);
        await awaitHandover({ type: 'loginSuccess', username: 'student', attemptId });

        dispatchExtensionMessage({ type: 'loginHandoverFailed', error: 'could not open Artemis', attemptId });

        expect(await screen.findByTestId('login-reload')).toBeInTheDocument();
        expect(screen.getByTestId('login-status')).toHaveTextContent('could not open Artemis');
        expect(screen.queryByTestId('login-submit')).not.toBeInTheDocument();
    });

    it('asks the host to reload the window', async () => {
        const mockApi = createMockVsCodeApi();
        render(<LoginView vscodeApi={mockApi} />);
        const attemptId = await submitPasswordLogin(mockApi);
        await awaitHandover({ type: 'loginSuccess', username: 'student', attemptId });
        dispatchExtensionMessage({ type: 'loginHandoverFailed', error: 'could not open', attemptId });

        await userEvent.click(await screen.findByTestId('login-reload'));

        expect(mockApi.postMessage).toHaveBeenCalledWith({ type: 'command', command: 'reloadWindow' });
    });

    it('ignores a live handover failure it does not own', async () => {
        const mockApi = createMockVsCodeApi();
        render(<LoginView vscodeApi={mockApi} />);
        const attemptId = await submitPasswordLogin(mockApi);
        await awaitHandover({ type: 'loginSuccess', username: 'student', attemptId });

        act(() => { dispatchExtensionMessage({ type: 'loginHandoverFailed', error: 'someone else', attemptId: 'other-1' }); });

        expect(screen.queryByTestId('login-reload')).not.toBeInTheDocument();
    });

    it('accepts an init replay when it has no handover of its own', async () => {
        // The view that started the sign-in is gone: `render()` replaced the document. This one has no
        // owner to match, and that absence is exactly the case the replay exists for.
        const mockApi = createMockVsCodeApi();
        render(<LoginView vscodeApi={mockApi} />);

        dispatchExtensionMessage({ type: 'loginHandoverFailedInit', error: 'could not open', generation: 3 });

        expect(await screen.findByTestId('login-reload')).toBeInTheDocument();
    });

    it('ignores an init replay once this view has started its own sign-in', async () => {
        // Init is resent on every ready and visibility change, so a replay can arrive well after the
        // user moved on. It describes something that happened before this view existed.
        const mockApi = createMockVsCodeApi();
        render(<LoginView vscodeApi={mockApi} />);
        await submitPasswordLogin(mockApi);

        act(() => { dispatchExtensionMessage({ type: 'loginHandoverFailedInit', error: 'stale', generation: 3 }); });

        expect(screen.queryByTestId('login-reload')).not.toBeInTheDocument();
        await waitFor(() => {
            expect(screen.getByTestId('login-progress')).toHaveTextContent('Verifying your credentials');
        });
    });

    it('replaying the same generation changes nothing', async () => {
        const mockApi = createMockVsCodeApi();
        render(<LoginView vscodeApi={mockApi} />);
        dispatchExtensionMessage({ type: 'loginHandoverFailedInit', error: 'first', generation: 3 });
        await screen.findByTestId('login-reload');

        // Wrapped, so the assertion below cannot pass merely because a second update has not committed.
        act(() => { dispatchExtensionMessage({ type: 'loginHandoverFailedInit', error: 'second', generation: 3 }); });

        expect(screen.getByTestId('login-status')).toHaveTextContent('first');
    });

    it('ignores an init replay while it holds a handover of its own', async () => {
        // An OIDC sign-in allocates no attempt id, so the replay cannot be told apart by ownership. It
        // still describes an older failure, and letting it through would drop a view that is signed in
        // and waiting onto a stale error screen.
        const mockApi = createMockVsCodeApi();
        render(<LoginView vscodeApi={mockApi} />);
        dispatchExtensionMessage({ type: 'loginOptionsResult', loginMethod: 'OIDC', idpName: 'TUM' });
        await screen.findByTestId('login-oidc-submit');
        await awaitHandover({ type: 'loginSuccess', username: 'student' });

        act(() => { dispatchExtensionMessage({ type: 'loginHandoverFailedInit', error: 'stale', generation: 3 }); });

        expect(screen.queryByTestId('login-reload')).not.toBeInTheDocument();
        expect(screen.queryByTestId('login-status')).not.toBeInTheDocument();
        await waitFor(() => {
            expect(screen.getByTestId('login-progress')).toHaveTextContent('Signed in, opening Artemis');
        });
    });

    it('ignores an init replay once this view has started a browser sign-in', async () => {
        // The browser flow allocates no attempt id, so the mount marks itself instead. Without that a
        // replay from before this view existed could speak over the sign-in the user just started.
        const mockApi = createMockVsCodeApi();
        render(<LoginView vscodeApi={mockApi} />);
        dispatchExtensionMessage({ type: 'loginOptionsResult', loginMethod: 'OIDC', idpName: 'TUM' });
        await userEvent.click(await screen.findByTestId('login-oidc-submit'));

        act(() => { dispatchExtensionMessage({ type: 'loginHandoverFailedInit', error: 'stale', generation: 3 }); });

        expect(screen.queryByTestId('login-reload')).not.toBeInTheDocument();
    });

    it('disables the way forward from stage 0 during the handover', async () => {
        // A browser sign-in carries no attempt id, so its success can land while the user is back on
        // the username step. Continuing from there would race the sign-in that already succeeded.
        const mockApi = createMockVsCodeApi();
        render(<LoginView vscodeApi={mockApi} />);
        expect(screen.getByTestId('login-next')).toBeEnabled();

        act(() => { dispatchExtensionMessage({ type: 'loginSuccess', username: 'student' }); });

        expect(screen.getByTestId('login-next')).toBeDisabled();
    });

    it('disables the browser sign-in during the handover', async () => {
        const mockApi = createMockVsCodeApi();
        render(<LoginView vscodeApi={mockApi} />);
        dispatchExtensionMessage({ type: 'loginOptionsResult', loginMethod: 'OIDC', idpName: 'TUM' });
        await screen.findByTestId('login-oidc-submit');

        await awaitHandover({ type: 'loginSuccess', username: 'student' });

        expect(screen.getByTestId('login-oidc-submit')).toBeDisabled();
    });

    it('ignores a login error that arrives during the handover', async () => {
        // The credential is committed, so an id-less error can only belong to an older attempt. Acting
        // on it would take the indicator away and leave the phase with no way forward and none back.
        const mockApi = createMockVsCodeApi();
        render(<LoginView vscodeApi={mockApi} />);
        const attemptId = await submitPasswordLogin(mockApi);
        await awaitHandover({ type: 'loginSuccess', username: 'student', attemptId });

        act(() => { dispatchExtensionMessage({ type: 'loginError', error: 'Login failed' }); });

        expect(screen.getByTestId('login-progress')).toHaveTextContent('Signed in, opening Artemis');
        expect(screen.queryByTestId('login-status')).not.toBeInTheDocument();
    });

    it('offers a reload once the handover has run far too long', async () => {
        // Nothing announces a navigation that never settles: it resolves neither way, so no failure
        // message is coming. Elapsed time is the only signal left, and the offer is made alongside the
        // indicator rather than replacing it, because the wait is still legitimate.
        vi.useFakeTimers();
        try {
            const mockApi = createMockVsCodeApi();
            render(<LoginView vscodeApi={mockApi} />);
            dispatchExtensionMessage({ type: 'loginOptionsResult', loginMethod: 'OIDC', idpName: 'TUM' });
            act(() => { dispatchExtensionMessage({ type: 'loginSuccess', username: 'student' }); });

            expect(screen.queryByTestId('login-reload')).not.toBeInTheDocument();
            act(() => { vi.advanceTimersByTime(20_000); });

            expect(screen.getByTestId('login-reload')).toBeInTheDocument();
            expect(screen.getByTestId('login-progress')).toHaveTextContent('Still opening Artemis');
            fireEvent.click(screen.getByTestId('login-reload'));
            expect(mockApi.postMessage).toHaveBeenCalledWith({ type: 'command', command: 'reloadWindow' });
        } finally {
            vi.useRealTimers();
        }
    });

    it('does not carry an old attempt\'s outcome into a recreated view', async () => {
        // `render()` replaces the document and the new view starts its own sign-in. A result still in
        // flight for the old one names an id this mount never issued, so it answers no question here.
        const firstApi = createMockVsCodeApi();
        const first = render(<LoginView vscodeApi={firstApi} />);
        const firstAttempt = await submitPasswordLogin(firstApi);
        first.unmount();

        const secondApi = createMockVsCodeApi();
        render(<LoginView vscodeApi={secondApi} />);
        await submitPasswordLogin(secondApi);

        dispatchExtensionMessage({ type: 'loginSuccess', username: 'student', attemptId: firstAttempt });

        await waitFor(() => {
            expect(screen.getByTestId('login-progress')).toHaveTextContent('Verifying your credentials');
        });
        expect(screen.getByTestId('login-secondary')).toBeInTheDocument();
    });

    it('leaves the handover when the credential it was waiting on goes away', async () => {
        // Nothing else reaches the view for this: the app state is already `login` throughout a
        // handover, so the 401 path's showLogin() returns without a transition and no render replaces
        // the document. Without this the view keeps promising an Artemis that is not coming.
        const mockApi = createMockVsCodeApi();
        render(<LoginView vscodeApi={mockApi} />);
        const attemptId = await submitPasswordLogin(mockApi);
        await awaitHandover({ type: 'loginSuccess', username: 'student', attemptId });

        act(() => { dispatchExtensionMessage({ type: 'loginSessionEnded' }); });

        expect(screen.getByTestId('login-status')).toHaveTextContent('Your session ended');
        // The form, not the reload: there is no credential left for a reload to rebuild anything from.
        expect(screen.getByTestId('login-submit')).toBeEnabled();
        expect(screen.queryByTestId('login-reload')).not.toBeInTheDocument();
    });

    it('takes back the reload offer when the credential goes away behind it', async () => {
        const mockApi = createMockVsCodeApi();
        render(<LoginView vscodeApi={mockApi} />);
        const attemptId = await submitPasswordLogin(mockApi);
        await awaitHandover({ type: 'loginSuccess', username: 'student', attemptId });
        dispatchExtensionMessage({ type: 'loginHandoverFailed', error: 'could not open', attemptId });
        await screen.findByTestId('login-reload');

        act(() => { dispatchExtensionMessage({ type: 'loginSessionEnded' }); });

        expect(screen.queryByTestId('login-reload')).not.toBeInTheDocument();
        expect(screen.getByTestId('login-status')).toHaveTextContent('Your session ended');
    });

    it('says nothing about a session ending while the user is just filling in the form', async () => {
        // A logout from elsewhere reaches every view. On the form it is not news: that is already the
        // right thing to be looking at.
        const mockApi = createMockVsCodeApi();
        render(<LoginView vscodeApi={mockApi} />);

        act(() => { dispatchExtensionMessage({ type: 'loginSessionEnded' }); });

        expect(screen.queryByTestId('login-status')).not.toBeInTheDocument();
    });

    it('ignores unowned startup loading messages while an interactive attempt owns the indicator', async () => {
        const mockApi = createMockVsCodeApi();
        render(<LoginView vscodeApi={mockApi} />);
        await submitPasswordLogin(mockApi);

        dispatchExtensionMessage({ type: 'hideLoading' });
        dispatchExtensionMessage({ type: 'updateLoading', message: 'Loading user information...' });

        await waitFor(() => {
            expect(screen.getByTestId('login-progress')).toHaveTextContent('Verifying your credentials');
        });
    });

    it('a stale login-options answer cannot touch a different attempt already in progress', async () => {
        const mockApi = createMockVsCodeApi();
        render(<LoginView vscodeApi={mockApi} />);
        const attemptId = await submitPasswordLogin(mockApi);

        // A mismatched id, standing in for an answer to an earlier, already-superseded attempt. Given a
        // different login method too, a leak would show up both in the indicator and in the form.
        act(() => {
            dispatchExtensionMessage({
                type: 'loginOptionsResult',
                loginMethod: 'OIDC',
                idpName: 'Some Other IdP',
                attemptId: attemptId + 1000,
            });
        });

        expect(screen.getByTestId('login-progress')).toHaveTextContent('Verifying your credentials');
        expect(screen.getByTestId('login-submit')).toBeInTheDocument();
        expect(screen.queryByTestId('login-oidc-submit')).not.toBeInTheDocument();
    });

    it('keeps ownership through the teardown, so a late startup updateLoading cannot touch it', async () => {
        const mockApi = createMockVsCodeApi();
        render(<LoginView vscodeApi={mockApi} />);
        const attemptId = await submitPasswordLogin(mockApi);

        // Only now: the interaction above needed real timers for `findBy*`/`userEvent` to resolve at all.
        vi.useFakeTimers();
        try {
            dispatchExtensionMessage({ type: 'loginError', error: 'nope', attemptId });

            // Still inside the 300ms teardown: the indicator is on screen and must still be owned.
            act(() => { vi.advanceTimersByTime(100); });
            act(() => { dispatchExtensionMessage({ type: 'updateLoading', message: 'Loading user information...' }); });

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
            act(() => { dispatchExtensionMessage({ type: 'hideLoading' }); });

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
        act(() => { dispatchExtensionMessage({ type: 'loginOptionsResult', loginMethod: 'PASSWORD', idpName: null, attemptId }); });

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

            // The extension had already answered the attempt the user has since retracted. A loginError
            // (not loginSuccess) is used deliberately: cancelAttempt() already clears everything a
            // loginSuccess would set, so only a message type that touches state cancelAttempt leaves
            // alone (statusMessage, the health-check panel) can actually prove the guard is doing anything.
            act(() => { dispatchExtensionMessage({ type: 'loginError', error: 'stale attempt error', attemptId }); });

            expect(screen.queryByTestId('login-progress')).not.toBeInTheDocument();
            expect(screen.getByTestId('login-password')).toBeEnabled();
            expect(screen.queryByTestId('login-status')).not.toBeInTheDocument();
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
