import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

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
                payload: { username: 'teststudent' },
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
});
