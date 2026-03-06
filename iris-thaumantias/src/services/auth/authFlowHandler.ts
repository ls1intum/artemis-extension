import * as vscode from 'vscode';
import { AuthManager } from '../../auth';
import { ArtemisApiService } from '../../api';
import { ExtensionMsg } from '../../shared/messageContracts';
import type { ExtensionToWebviewMessage } from '../../shared/messageContracts';
import type { UserInfo } from '../../views/app/appStateManager';
import { logger, LogCategory } from '../loggingService';
import { CONFIG, VSCODE_CONFIG } from '../../utils';

export class AuthFlowHandler {
    constructor(
        private readonly _authManager: AuthManager,
        private readonly _artemisApi: ArtemisApiService,
        private readonly _getAuthContextUpdater: () => ((isAuthenticated: boolean) => Promise<void>) | undefined,
        private readonly _postMessage: (msg: ExtensionToWebviewMessage) => void,
        private readonly _callbacks: {
            showDashboard: (userInfo: UserInfo) => Promise<void>;
            hideLoadingAndSendServerUrl: () => void;
            showLogin: () => void;
        },
    ) {}

    public async checkServerUrlChange(): Promise<void> {
        try {
            const hasAuth = await this._authManager.hasAuthCookie();
            if (hasAuth) {
                const isServerUrlChanged = await this._artemisApi.isServerUrlChanged();
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
            const hasAuth = await this._authManager.hasAuthCookie();
            if (hasAuth) {
                this._postMessage({ type: ExtensionMsg.ShowLoading, message: 'Checking stored credentials...' });
                this._postMessage({ type: ExtensionMsg.UpdateLoading, message: 'Loading user information...' });

                try {
                    const user = await this._artemisApi.getCurrentUser();
                    const serverUrl = this._getServerUrl();
                    logger.info(`Auto-authenticated user: ${user.login}`, LogCategory.AUTH);
                    await this._callbacks.showDashboard({
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
        const config = vscode.workspace.getConfiguration(VSCODE_CONFIG.ARTEMIS_SECTION);
        return config.get<string>(VSCODE_CONFIG.SERVER_URL_KEY, CONFIG.ARTEMIS_SERVER_URL_DEFAULT);
    }
}
