import * as vscode from 'vscode';
import type { CommandContext, CommandMap } from './types';

export class AuthCommandModule {
    constructor(private readonly context: CommandContext) {}

    public getHandlers(): CommandMap {
        return {
            login: this.handleLogin,
            logout: this.handleLogout,
        };
    }

    private handleLogin = async (message: any): Promise<void> => {
        const username: string = message.username;
        const password: string = message.password;
        const rememberMe: boolean = message.rememberMe || false;

        const config = vscode.workspace.getConfiguration('artemis');
        const serverUrl = config.get<string>('serverUrl', 'https://artemis.tum.de');

        try {
            await this.context.artemisApi.authenticate(username, password, rememberMe);
            const user = await this.context.artemisApi.getCurrentUser();

            await this.context.updateAuthContext(true);

            vscode.window.showInformationMessage(`Successfully logged in to Artemis as ${user.login || username}`);

            await this.context.actionHandler.showDashboard({
                username: user.login || username,
                serverUrl: serverUrl,
                user: user
            });
        } catch (error) {
            console.error('Login error:', error);
            const friendlyError = this.formatLoginError(error);
            vscode.window.showErrorMessage(friendlyError);

            this.context.sendMessage({
                command: 'loginError',
                error: friendlyError
            });
        }
    };

    private handleLogout = async (): Promise<void> => {
        try {
            await this.context.authManager.clear();
            await this.context.updateAuthContext(false);

            vscode.window.showInformationMessage('Successfully logged out of Artemis');

            this.context.appStateManager.showLogin();
            this.context.actionHandler.render();
        } catch (error) {
            console.error('Logout error:', error);
            vscode.window.showErrorMessage('Error during logout');
        }
    };

    private formatLoginError(error: unknown): string {
        const defaultMessage = 'Login failed: An unexpected error occurred. Please try again.';

        if (!(error instanceof Error)) {
            return defaultMessage;
        }

        const rawMessage = (error.message || '').trim();
        if (!rawMessage) {
            return defaultMessage;
        }

        const normalized = rawMessage.replace(/^login failed[:]?\s*/i, '').trim();
        if (!normalized) {
            return defaultMessage;
        }

        if (/invalid username or password/i.test(normalized)
            || /method argument not valid/i.test(normalized)
            || /\b400\b/.test(normalized)
            || /\b401\b/.test(normalized)) {
            return 'Login failed: Invalid username or password. Please verify your credentials and try again.';
        }

        if (/not activated/i.test(normalized) || /forbidden/i.test(normalized) || /\b403\b/.test(normalized)) {
            return 'Login failed: Your account is not activated or access is forbidden.';
        }

        if (/failed to fetch/i.test(normalized) || /enotfound/i.test(normalized) || /econnrefused/i.test(normalized)) {
            return 'Login failed: Could not reach the Artemis server. Check your network connection or server URL.';
        }

        return `Login failed: ${normalized}`;
    }
}
