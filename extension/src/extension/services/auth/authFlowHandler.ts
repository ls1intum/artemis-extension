import type { ExtensionToWebviewMessage } from '@shared/messageContracts';
import { ExtensionMsg } from '@shared/messageContracts';

import { ArtemisApiService } from '@extension/api';
import type { UserInfo } from '@extension/controller/appStateManager';
import { LogCategory, logger } from '@extension/services/loggingService';
import { ApiError } from '@extension/types';
import { resolveServerUrl } from '@extension/utils';

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
        },
    ) {}

    public async checkExistingAuthentication(): Promise<void> {
        try {
            let hasAuth = false;
            try {
                hasAuth = await this._authManager.hasAuthToken();
            } catch (error) {
                // Reading the stored token failed. Clearing it would be
                // pointless and destructive, so fall back to the login UI.
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

            const revision = this._authManager.currentCredentialRevision();

            let user;
            try {
                user = await this._artemisApi.getCurrentUser();
            } catch (userError) {
                // Only a 401 means the stored token is actually invalid. A
                // timeout, network error or 5xx is a transient reachability
                // problem, so keep the credentials: a blip (e.g. slow network
                // at startup) must not log the user out.
                if (userError instanceof ApiError && userError.status === 401) {
                    // The request layer (ArtemisApiService.makeRequest) also reacts to a 401 and may
                    // already have cleared this exact credential itself, which moves the revision and
                    // makes this clearIfUnchanged() report false even though nothing here is stale. Either
                    // that clear landed or a newer sign-in superseded it; either way the credential this
                    // check started with is gone, so only the update below is conditional on which one
                    // happened - releasing the loading view below is not.
                    const cleared = await this._authManager.clearIfUnchanged(revision);
                    if (cleared) {
                        logger.info('Stored credentials are invalid, clearing...', LogCategory.AUTH);
                        const updater = this._getAuthContextUpdater();
                        if (updater) {
                            await updater(false);
                        }
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
            // Safety net: never strand the startup loading UI. Crucially this
            // does NOT clear credentials, because a transient or post-auth
            // failure must not log the user out. The only credential-clearing
            // path is the inline 401 branch above.
            logger.error('Startup authentication did not complete (credentials kept)', LogCategory.AUTH, error);
            this._callbacks.hideLoadingAndSendServerUrl();
        }
    }

    private _getServerUrl(): string {
        return resolveServerUrl();
    }
}
