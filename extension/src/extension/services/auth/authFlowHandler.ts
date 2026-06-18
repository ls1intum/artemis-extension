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

    private _getServerUrl(): string {
        return resolveServerUrl();
    }
}
