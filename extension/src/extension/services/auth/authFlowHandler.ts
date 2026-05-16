import * as vscode from 'vscode';

import type { ExtensionToWebviewMessage } from '@shared/messageContracts';
import { ExtensionMsg } from '@shared/messageContracts';

import { ArtemisApiService } from '@extension/api';
import type { UserInfo } from '@extension/controller/appStateManager';
import { getTheiaEnvironment } from '@extension/theia';
import { CONFIG, resolveServerUrl, VSCODE_CONFIG } from '@extension/utils';

import { LogCategory, logger } from '../loggingService';
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
            const hasAuth = await this._authManager.hasAuthToken();
            if (hasAuth) {
                this._postMessage({ type: ExtensionMsg.ShowLoading, message: 'Checking stored credentials...' });
                this._postMessage({ type: ExtensionMsg.UpdateLoading, message: 'Loading user information...' });

                try {
                    const user = await this._artemisApi.getCurrentUser();
                    const serverUrl = this._getServerUrl();
                    logger.info(`Auto-authenticated user: ${user.login}`, LogCategory.AUTH);
                    await this._callbacks.onAuthenticated({
                        username: user.login || 'User',
                        serverUrl: serverUrl,
                        user: user
                    });
                } catch (userError) {
                    logger.info('Stored credentials are invalid, clearing...', LogCategory.AUTH);
                    await this._authManager.clear();

                    const updater = this._getAuthContextUpdater();
                    if (updater) {
                        await updater(false);
                    }

                    this._callbacks.hideLoadingAndSendServerUrl();
                }
            } else {
                this._callbacks.hideLoadingAndSendServerUrl();
            }
        } catch (error) {
            logger.error('Error checking existing authentication', LogCategory.AUTH, error);
            await this._authManager.clear();

            const updater = this._getAuthContextUpdater();
            if (updater) {
                await updater(false);
            }

            this._callbacks.hideLoadingAndSendServerUrl();
        }
    }

    private _getServerUrl(): string {
        return resolveServerUrl();
    }
}
