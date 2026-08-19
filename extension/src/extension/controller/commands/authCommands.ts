import * as vscode from 'vscode';

import type { WebCmd, WebviewToExtensionMessage } from '@shared/messageContracts';
import { ExtensionMsg, getPayload, WebviewCmd } from '@shared/messageContracts';

import { LoginCancelledError } from '@extension/services/auth';
import { LogCategory, logger } from '@extension/services/loggingService';
import { normalizeServerUrl } from '@extension/services/session/identityKeys';
import { resolveServerUrl } from '@extension/utils';

import type { CommandContext, CommandMap } from './types';

export class AuthCommandModule {
    constructor(private readonly context: CommandContext) { }

    public getHandlers(): CommandMap {
        return {
            [WebviewCmd.Login]: this.handleLogin,
            [WebviewCmd.Logout]: this.handleLogout,
            [WebviewCmd.CheckLoginOptions]: this.handleCheckLoginOptions,
            [WebviewCmd.StartOidcLogin]: this.handleStartOidcLogin,
            [WebviewCmd.CancelLogin]: this.handleCancelLogin,
        };
    }

    private handleCheckLoginOptions = async (message: WebviewToExtensionMessage): Promise<void> => {
        const payload = getPayload<WebCmd<'checkLoginOptions'>>(message);
        const attemptId = payload.attemptId;

        const controller = new AbortController();
        this.context.authCancellation.register(controller);

        try {
            const options = await this.context.artemisApi.getLoginOptions(payload.username, controller.signal);
            if (controller.signal.aborted) {
                // Answering now would move the user to a stage they have already left.
                return;
            }

            this.context.sendMessage({
                type: ExtensionMsg.LoginOptionsResult,
                loginMethod: options.loginMethod,
                idpName: options.idpName,
                attemptId,
            });
        } catch (error: unknown) {
            if (controller.signal.aborted) {
                logger.info('Login options lookup cancelled by the user', LogCategory.AUTH);
                return;
            }

            logger.error('Failed to check login options:', LogCategory.AUTH, error);

            this.context.sendMessage({
                type: ExtensionMsg.LoginOptionsError,
                error: error instanceof Error ? error.message : 'Failed to determine login method',
                attemptId,
            });
        } finally {
            this.context.authCancellation.release(controller);
        }
    };

    // Hands the user to the browser for OIDC; OidcLoginService owns the attempt from here on.
    private handleStartOidcLogin = async (message: WebviewToExtensionMessage): Promise<void> => {
        try {
            const payload = getPayload<WebCmd<'startOidcLogin'>>(message);
            const rememberMe = payload.rememberMe ?? true;

            await this.context.oidcLoginService.start(rememberMe);
        } catch (error: unknown) {
            if (error instanceof LoginCancelledError) {
                logger.info('OIDC login cancelled before the browser was opened', LogCategory.AUTH);
                return;
            }

            logger.error('Failed to start OIDC login:', LogCategory.AUTH, error);
            vscode.window.showErrorMessage('Failed to open login page in browser.');

            this.context.sendMessage({
                type: ExtensionMsg.LoginError,
                error: 'Failed to open browser for TUM Login.',
            });
        }
    };

    // The user backed out. Whatever is in flight, password or OIDC, has to stop being able to sign them in.
    private handleCancelLogin = async (_message: WebviewToExtensionMessage): Promise<void> => {
        await this.context.authCancellation.cancelAll();
    };

    private handleLogin = async (message: WebviewToExtensionMessage): Promise<void> => {
        const payload = getPayload<WebCmd<'login'>>(message);
        const attemptId = payload.attemptId;

        const controller = new AbortController();
        this.context.authCancellation.register(controller);

        // The server this attempt belongs to. Both API calls resolve the server when they run, so
        // without this a token from the previous server could become the credential for the new one.
        const startServerUrl = normalizeServerUrl(resolveServerUrl()) ?? resolveServerUrl();
        const stillWanted = (): boolean => {
            if (controller.signal.aborted) {
                return false;
            }
            const current = normalizeServerUrl(resolveServerUrl()) ?? resolveServerUrl();
            return current === startServerUrl;
        };

        let user;
        let username: string;
        try {
            username = payload.username;
            const rememberMe = payload.rememberMe || false;

            const result = await this.context.artemisApi.authenticate(
                username, payload.password, rememberMe, controller.signal,
            );
            // Checked after every await, not only in the catch. An abort normally makes the request
            // reject, but nothing guarantees it: the response may already have been in the buffer when
            // the user pressed Cancel, and reporting progress for a retracted attempt would reopen the
            // indicator the view has just taken down.
            if (controller.signal.aborted) {
                return;
            }

            // The server hands back a cookie string. Bearer mode stores the bare JWT, so without this
            // the header would come out as `Authorization: Bearer jwt=<token>`.
            const token = this.context.authManager.formatToken(result.token);

            this.context.sendMessage({
                type: ExtensionMsg.UpdateLoading,
                message: 'Loading your profile',
                subtext: 'Fetching your account details',
                attemptId,
            });

            // Check the candidate before it becomes the stored credential. Until this succeeds nothing
            // has been committed, so a failure here cannot disturb a session the user already had.
            user = await this.context.artemisApi.getCurrentUserWithToken(token, controller.signal);
            if (controller.signal.aborted) {
                return;
            }

            const committed = await this.context.authManager.storeArtemisCredentials(
                token, rememberMe, stillWanted,
            );
            if (!committed) {
                // Cancelled, logged out, or the server changed. All three are the user's own doing.
                return;
            }
        } catch (error: unknown) {
            if (controller.signal.aborted) {
                logger.info('Login cancelled by the user', LogCategory.AUTH);
                return;
            }

            logger.error('Login error:', LogCategory.AUTH, error);
            const friendlyError = this.formatLoginError(error);
            vscode.window.showErrorMessage(friendlyError);
            this.context.sendMessage({ type: ExtensionMsg.LoginError, error: friendlyError, attemptId });
            return;
        } finally {
            this.context.authCancellation.release(controller);
        }

        // Past this point the credential is committed and the user is signed in. A failure while wiring
        // up the UI is worth logging, but reporting it as a login error would contradict that.
        // Sent first: everything below can fail, and the view clears its pending state only on a success
        // or an error. Announcing afterwards would leave it spinning on a login that actually worked.
        this.context.sendMessage({
            type: ExtensionMsg.LoginSuccess,
            username: user.login || username,
            attemptId,
        });

        try {
            await this.context.updateAuthContext(true);
            vscode.window.showInformationMessage(`Successfully logged in to Artemis as ${user.login || username}`);
            await this.context.actionHandler.navigateToStartPage({
                username: user.login || username,
                serverUrl: resolveServerUrl(),
                user: user,
            });
        } catch (error: unknown) {
            logger.error('Login succeeded but the UI could not be updated', LogCategory.AUTH, error);
        }
    };

    private handleLogout = async (_message: WebviewToExtensionMessage): Promise<void> => {
        // Both captured before the first await. A sign-in racing this logout must be stopped now, and
        // the credential this logout is entitled to remove is the one that exists at this moment.
        const revision = this.context.authManager.currentCredentialRevision();
        const cancelled = this.context.authCancellation.cancelAll();

        try {
            await cancelled;
            // Best-effort server-side logout before clearing local state. It never throws, so local
            // cleanup proceeds regardless.
            await this.context.artemisApi.logoutFromServer();
            const cleared = await this.context.authManager.clearIfUnchanged(revision);
            if (!cleared) {
                // The user signed in again while the server was being told about the logout. The new
                // session survives in storage, so tearing down its UI here would strand them: signed in,
                // looking at a login form.
                logger.info('Logout superseded by a newer sign-in', LogCategory.AUTH);
                return;
            }
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

        if (/timed out/i.test(normalized)) {
            return 'Login failed: The Artemis server did not respond in time. Please try again.';
        }

        return `Login failed: ${normalized}`;
    }
}
