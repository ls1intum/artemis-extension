import * as vscode from 'vscode';

import type { WebCmd, WebviewToExtensionMessage } from '@shared/messageContracts';
import { ExtensionMsg, getPayload, WebviewCmd } from '@shared/messageContracts';

import { LogCategory, logger } from '@extension/services/loggingService';
import { CONFIG, VSCODE_CONFIG } from '@extension/utils/constants';

import type { CommandContext, CommandMap } from './types';

export class AuthCommandModule {
    constructor(private readonly context: CommandContext) { }

    public getHandlers(): CommandMap {
        return {
            [WebviewCmd.Login]: this.handleLogin,
            [WebviewCmd.Logout]: this.handleLogout,
            [WebviewCmd.CheckLoginOptions]: this.handleCheckLoginOptions,
            [WebviewCmd.StartOidcLogin]: this.handleStartOidcLogin,
            [WebviewCmd.CancelOidcLogin]: this.handleCancelOidcLogin,
        };
    }

    private handleCheckLoginOptions = async (message: WebviewToExtensionMessage): Promise<void> => {
        try {
            const payload = getPayload<WebCmd<'checkLoginOptions'>>(message);
            const username = payload.username;

            const options = await this.context.artemisApi.getLoginOptions(username);

            this.context.sendMessage({
                type: ExtensionMsg.LoginOptionsResult,
                loginMethod: options.loginMethod,
                idpName: options.idpName,
            });
        } catch (error: unknown) {
            logger.error('Failed to check login options:', LogCategory.AUTH, error);

            this.context.sendMessage({
                type: ExtensionMsg.LoginOptionsError,
                error: error instanceof Error ? error.message : 'Failed to determine login method',
            });
        }
    };

    // Hands the user to the browser for OIDC; OidcLoginService owns the attempt from here on.
    private handleStartOidcLogin = async (message: WebviewToExtensionMessage): Promise<void> => {
        try {
            const payload = getPayload<WebCmd<'startOidcLogin'>>(message);
            const rememberMe = payload.rememberMe ?? true;

            await this.context.oidcLoginService.start(rememberMe);
        } catch (error: unknown) {
            logger.error('Failed to start OIDC login:', LogCategory.AUTH, error);
            vscode.window.showErrorMessage('Failed to open login page in browser.');

            this.context.sendMessage({
                type: ExtensionMsg.LoginError,
                error: 'Failed to open browser for TUM Login.',
            });
        }
    };

    // The user backed out of the browser sign-in, so the attempt must not stay redeemable.
    private handleCancelOidcLogin = async (_message: WebviewToExtensionMessage): Promise<void> => {
        await this.context.oidcLoginService.cancel();
    };

    private handleLogin = async (message: WebviewToExtensionMessage): Promise<void> => {
        const config = vscode.workspace.getConfiguration(VSCODE_CONFIG.ARTEMIS_SECTION);
        const serverUrl = config.get<string>(VSCODE_CONFIG.SERVER_URL_KEY, CONFIG.ARTEMIS_SERVER_URL_DEFAULT);

        let username: string;
        let user;
        try {
            const payload = getPayload<WebCmd<'login'>>(message);
            username = payload.username;
            const password = payload.password;
            const rememberMe = payload.rememberMe || false;

            const result = await this.context.artemisApi.authenticate(username, password, rememberMe);
            // The server hands back a cookie string. Bearer mode stores the bare JWT, so without this the
            // header would come out as `Authorization: Bearer jwt=<token>`.
            const token = this.context.authManager.formatToken(result.token);

            // Check the candidate before it becomes the stored credential. Until this succeeds nothing has
            // been committed, so a failure here cannot disturb a session the user already had.
            user = await this.context.artemisApi.getCurrentUserWithToken(token);
            await this.context.authManager.storeArtemisCredentials(token, rememberMe);
        } catch (error: unknown) {
            logger.error('Login error:', LogCategory.AUTH, error);
            const friendlyError = this.formatLoginError(error);
            vscode.window.showErrorMessage(friendlyError);

            this.context.sendMessage({
                type: ExtensionMsg.LoginError,
                error: friendlyError
            });
            return;
        }

        // Past this point the credential is committed and the user is signed in. A failure while wiring up
        // the UI is worth logging, but reporting it as a login error would contradict that.
        // Sent first: everything below can fail, and the view clears its pending state only on a success
        // or an error. Announcing afterwards would leave it spinning on a login that actually worked.
        this.context.sendMessage({
            type: ExtensionMsg.LoginSuccess,
            username: user.login || username,
        });

        try {
            await this.context.updateAuthContext(true);

            vscode.window.showInformationMessage(`Successfully logged in to Artemis as ${user.login || username}`);

            await this.context.actionHandler.navigateToStartPage({
                username: user.login || username,
                serverUrl: serverUrl,
                user: user
            });
        } catch (error: unknown) {
            logger.error('Login succeeded but the UI could not be updated', LogCategory.AUTH, error);
        }
    };

    private handleLogout = async (_message: WebviewToExtensionMessage): Promise<void> => {
        try {
            // Best-effort server-side logout before clearing local state. It
            // never throws, so local cleanup proceeds regardless.
            // A pending OIDC attempt has to go first: a callback arriving after the logout would
            // otherwise redeem its code and sign the user straight back in.
            await this.context.oidcLoginService.cancel();
            await this.context.artemisApi.logoutFromServer();
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
