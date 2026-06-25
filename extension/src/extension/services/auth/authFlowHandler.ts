import * as vscode from 'vscode';

import type { ExtensionToWebviewMessage } from '@shared/messageContracts';
import { ExtensionMsg } from '@shared/messageContracts';

import { ArtemisApiService } from '@extension/api';
import type { UserInfo } from '@extension/controller/appStateManager';
import { LogCategory, logger } from '@extension/services/loggingService';
import { getTheiaEnvironment } from '@extension/theia';
import { ApiError } from '@extension/types';
import { CONFIG, resolveServerUrl, VSCODE_CONFIG } from '@extension/utils';

import { AuthManager } from './authManager';
import { EXTERNAL_LOGIN_CALLBACK_PATH } from './externalLoginStarter';
import { PendingExternalLoginStore } from './pendingExternalLogin';

export class AuthFlowHandler {
    constructor(
        private readonly _authManager: AuthManager,
        private readonly _artemisApi: ArtemisApiService,
        private readonly _getAuthContextUpdater: () => ((isAuthenticated: boolean) => Promise<void>) | undefined,
        private readonly _postMessage: (msg: ExtensionToWebviewMessage) => void,
        private readonly _callbacks: {
            onAuthenticated: (userInfo: UserInfo) => Promise<void>;
            hideLoadingAndSendServerUrl: () => void;
            showLogin: () => void;
        },
        private readonly _pendingStore: PendingExternalLoginStore,
    ) {}

    public async checkServerUrlChange(): Promise<void> {
        // In Theia, the server URL is environment-managed — skip change detection
        if (getTheiaEnvironment().isTheia) { return; }

        try {
            const hasAuth = await this._authManager.hasAuthToken();
            if (hasAuth) {
                const isServerUrlChanged = await this._authManager.isServerUrlChanged(resolveServerUrl());
                if (isServerUrlChanged) {
                    const config = vscode.workspace.getConfiguration(VSCODE_CONFIG.ARTEMIS_SECTION);
                    const currentServerUrl = config.get<string>(VSCODE_CONFIG.SERVER_URL_KEY, CONFIG.ARTEMIS_SERVER_URL_DEFAULT);

                    vscode.window.showWarningMessage(
                        `The Artemis server URL has changed to ${currentServerUrl}. Your stored credentials may no longer be valid.`,
                        'Clear Credentials',
                        'Keep Credentials'
                    ).then(selection => {
                        if (selection === 'Clear Credentials') {
                            this._callbacks.showLogin();
                        }
                    });
                }
            }
        } catch (error) {
            logger.error('Error checking server URL change', LogCategory.AUTH, error);
        }
    }

    public async checkExistingAuthentication(): Promise<void> {
        try {
            let hasAuth = false;
            try {
                hasAuth = await this._authManager.hasAuthToken();
            } catch (error) {
                // Reading the stored token failed — clearing it would be pointless
                // and destructive, so just fall back to the login UI.
                logger.error('Error reading stored authentication state', LogCategory.AUTH, error);
                this._callbacks.hideLoadingAndSendServerUrl();
                return;
            }

            if (!hasAuth) {
                this._callbacks.hideLoadingAndSendServerUrl();
                return;
            }

            this._postMessage({ type: ExtensionMsg.ShowLoading, message: 'Checking stored credentials...' });
            this._postMessage({ type: ExtensionMsg.UpdateLoading, message: 'Loading user information...' });

            let user;
            try {
                user = await this._artemisApi.getCurrentUser();
            } catch (userError) {
                // Only a 401 means the stored token is actually invalid. A timeout,
                // network error, or 5xx is a transient reachability problem — keep
                // the credentials so a blip (e.g. slow network at startup) does not
                // log the user out.
                if (userError instanceof ApiError && userError.status === 401) {
                    logger.info('Stored credentials are invalid, clearing...', LogCategory.AUTH);
                    await this._authManager.clear();

                    const updater = this._getAuthContextUpdater();
                    if (updater) {
                        await updater(false);
                    }
                } else {
                    logger.warn('Could not verify stored credentials (server unreachable?); keeping them', LogCategory.AUTH, userError);
                }
                this._callbacks.hideLoadingAndSendServerUrl();
                return;
            }

            // Credentials are valid. A failure in post-auth wiring must NOT be
            // mistaken for invalid credentials, so it is handled by the
            // non-clearing outer catch below and never clears a valid token.
            const serverUrl = this._getServerUrl();
            logger.info(`Auto-authenticated user: ${user.login}`, LogCategory.AUTH);
            await this._callbacks.onAuthenticated({
                username: user.login || 'User',
                serverUrl: serverUrl,
                user: user
            });
        } catch (error) {
            // Safety net: never strand the startup loading UI. Crucially this does
            // NOT clear credentials — a transient or post-auth failure must not log
            // the user out (the only credential-clearing path is the inline 401
            // branch above, which runs before reaching here).
            logger.error('Startup authentication did not complete (credentials kept)', LogCategory.AUTH, error);
            this._callbacks.hideLoadingAndSendServerUrl();
        }
    }

    /**
     * Completes a browser-delegated login from the custom-scheme callback. Validates the anti-forgery
     * state and the pending flow, exchanges the one-time code for a JWT, and wires up the authenticated UI.
     *
     * @param uri the callback URI, e.g. {@code vscode://<extension-id>/external-login-callback?code=..&state=..}
     */
    public async completeExternalLogin(uri: vscode.Uri): Promise<void> {
        if (uri.path !== EXTERNAL_LOGIN_CALLBACK_PATH) {
            logger.warn(`Ignoring URI with unexpected path: ${uri.path}`, LogCategory.AUTH);
            return;
        }

        const params = new URLSearchParams(uri.query);
        const code = params.get('code') ?? undefined;
        const state = params.get('state') ?? undefined;

        const pending = await this._pendingStore.load();

        if (!code || !state || !pending || pending.state !== state || this._pendingStore.isExpired(pending) || pending.serverUrl !== resolveServerUrl()) {
            // Do NOT consume the pending record here: a stray/bogus callback must not cancel a legitimate
            // in-flight login. The real callback can still arrive; abandoned flows expire via their TTL.
            logger.warn('Rejected external-login callback (missing/expired/mismatched pending state)', LogCategory.AUTH);
            vscode.window.showErrorMessage('Browser sign-in could not be completed. Please try again.');
            this._callbacks.showLogin();
            return;
        }

        // Valid callback: consume the pending record (single-use) before exchanging.
        await this._pendingStore.clear();

        try {
            await this._artemisApi.exchangeExternalLoginCode(code, pending.verifier);
        } catch (error) {
            logger.error('External-login code exchange failed', LogCategory.AUTH, error);
            vscode.window.showErrorMessage('Browser sign-in could not be completed. Please try again.');
            this._callbacks.showLogin();
            return;
        }

        // The token is now stored and valid. A failure past this point is post-auth wiring only and must
        // not discard a valid token — mirror checkExistingAuthentication's no-logout-on-transient policy.
        try {
            const user = await this._artemisApi.getCurrentUser();
            const updater = this._getAuthContextUpdater();
            if (updater) {
                await updater(true);
            }
            await this._callbacks.onAuthenticated({
                username: user.login || 'User',
                serverUrl: resolveServerUrl(),
                user,
            });
            vscode.window.showInformationMessage(`Successfully signed in to Artemis as ${user.login ?? 'your account'}`);
        } catch (error) {
            if (error instanceof ApiError && error.status === 401) {
                await this._authManager.clear();
                const updater = this._getAuthContextUpdater();
                if (updater) {
                    await updater(false);
                }
                this._callbacks.showLogin();
            } else {
                // The token is valid (exchange succeeded); mark the session authenticated so it is usable.
                // The dashboard renders on the next view resolution even though immediate navigation failed.
                logger.warn('Signed in but post-login setup did not complete (credentials kept)', LogCategory.AUTH, error);
                const updater = this._getAuthContextUpdater();
                if (updater) {
                    await updater(true);
                }
                vscode.window.showInformationMessage('Signed in to Artemis. Reopen the Artemis panel if it does not refresh automatically.');
            }
        }
    }

    private _getServerUrl(): string {
        return resolveServerUrl();
    }
}
