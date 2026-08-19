import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
