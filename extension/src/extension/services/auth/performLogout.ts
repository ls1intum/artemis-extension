import * as vscode from 'vscode';

import type { ArtemisApiService } from '@extension/api';
import { LogCategory, logger } from '@extension/services/loggingService';

import type { AuthCancellationService } from './authCancellationService';
import type { AuthManager } from './authManager';

export interface LogoutDeps {
    authManager: AuthManager;
    artemisApi: ArtemisApiService;
    authCancellation: AuthCancellationService;
    updateAuthContext(isAuthenticated: boolean): Promise<void>;
    /**
     * Show the login surface once the credential is gone. Injected because the
     * two entry points own different halves of the UI: the `artemis.logout`
     * command holds the Artemis webview provider, the webview's own logout
     * command holds the app state manager and its render loop.
     */
    showLogin(): void;
}

/**
 * Log out of Artemis: cancel any in-flight sign-in, tell the server, drop the
 * local credential, and hand the user back to the login surface.
 *
 * Shared by the `artemis.logout` command and the webview's logout command.
 * Keeping one implementation is not cosmetic: the revision/cancellation
 * handshake below is easy to get subtly wrong, and a second copy would drift
 * out of step with the first the next time it is corrected.
 */
export async function performLogout(deps: LogoutDeps): Promise<void> {
    // Both captured before the first await. A sign-in racing this logout must be stopped now, and
    // the credential this logout is entitled to remove is the one that exists at this moment.
    const revision = deps.authManager.currentCredentialRevision();
    const cancelled = deps.authCancellation.cancelAll();

    try {
        await cancelled;
        // Best-effort server-side logout before clearing local state. It never throws, so local
        // cleanup proceeds regardless.
        await deps.artemisApi.logoutFromServer();

        const cleared = await deps.authManager.clearIfUnchanged(revision);
        if (!cleared) {
            // The user signed in again while the server was being told about the logout. The new
            // session survives in storage, so tearing down its UI here would strand them: signed in,
            // looking at a login form.
            logger.info('Logout superseded by a newer sign-in', LogCategory.AUTH);
            return;
        }

        await deps.updateAuthContext(false);
        vscode.window.showInformationMessage('Successfully logged out of Artemis');
        deps.showLogin();
    } catch (error: unknown) {
        logger.error('Logout error', LogCategory.AUTH, error);
        vscode.window.showErrorMessage('Error during logout');
    }
}
