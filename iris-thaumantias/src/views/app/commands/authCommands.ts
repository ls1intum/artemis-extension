import * as vscode from 'vscode';
import type { CommandContext, CommandMap } from './types';
import { getPayload, ExtensionMsg, WebviewCmd } from '../../../shared/messageContracts';
import type { WebviewToExtensionMessage, WebCmd } from '../../../shared/messageContracts';
import { CONFIG, VSCODE_CONFIG } from '../../../utils/constants';
import { logger, LogCategory } from '../../../services/loggingService';

export class AuthCommandModule {
    constructor(private readonly context: CommandContext) { }

    public getHandlers(): CommandMap {
        return {
            [WebviewCmd.Login]: this.handleLogin,
            [WebviewCmd.Logout]: this.handleLogout,
        };
    }

    private handleLogin = async (message: WebviewToExtensionMessage): Promise<void> => {
        try {
            const payload = getPayload<WebCmd<'login'>>(message);
            const username = payload.username;
            const password = payload.password;
            const rememberMe = payload.rememberMe || false;

            const config = vscode.workspace.getConfiguration(VSCODE_CONFIG.ARTEMIS_SECTION);
            const serverUrl = config.get<string>(VSCODE_CONFIG.SERVER_URL_KEY, CONFIG.ARTEMIS_SERVER_URL_DEFAULT);
            await this.context.artemisApi.authenticate(username, password, rememberMe);
            const user = await this.context.artemisApi.getCurrentUser();

            await this.context.updateAuthContext(true);

            this.context.sendMessage({
                type: ExtensionMsg.LoginSuccess,
                username: user.login || username,
            });

            vscode.window.showInformationMessage(`Successfully logged in to Artemis as ${user.login || username}`);

            await this.context.actionHandler.navigateToStartPage({
                username: user.login || username,
                serverUrl: serverUrl,
                user: user
            });
        } catch (error: unknown) {
            logger.error('Login error:', LogCategory.AUTH, error);
            const friendlyError = this.formatLoginError(error);
            vscode.window.showErrorMessage(friendlyError);

            this.context.sendMessage({
                type: ExtensionMsg.LoginError,
                error: friendlyError
            });
        }
    };

    private handleLogout = async (_message: WebviewToExtensionMessage): Promise<void> => {
        try {
            await this.context.authManager.clear();
            await this.context.updateAuthContext(false);

            vscode.window.showInformationMessage('Successfully logged out of Artemis');

            this.context.appStateManager.showLogin();
            this.context.actionHandler.render();
        } catch (error: unknown) {
            logger.error('Logout error:', LogCategory.AUTH, error);
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
