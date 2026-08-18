import * as vscode from 'vscode';

import type { ExtensionToWebviewMessage } from '@shared/messageContracts';
import { ExtensionMsg } from '@shared/messageContracts';

import type { ArtemisUser } from '@extension/domain';
import { LogCategory, logger } from '@extension/services/loggingService';

import type { OidcLoginService } from './oidcLoginService';

interface OidcLoginCallbackDeps {
    oidcLoginService: OidcLoginService;
    updateAuthContext: (isAuthenticated: boolean) => Promise<void>;
    postMessage: (message: ExtensionToWebviewMessage) => void;
    navigateToStartPage: (user: ArtemisUser) => Promise<void>;
}

/**
 * Adapts a browser callback to the rest of the extension, and owns the user-facing messaging for it.
 *
 * Extracted from `activate()` so its two rules can actually be tested:
 *
 * - A failure is never allowed to clear credentials. Everything that can fail before the commit happens
 *   inside `complete()`, which leaves an existing session untouched, so there is nothing to undo.
 * - A failure after the commit is not a login failure. The user is signed in at that point; reporting an
 *   error would contradict the credential that was just stored, and would land after the success message.
 */
export function createOidcLoginCallback(deps: OidcLoginCallbackDeps): {
    onCode: (code: string) => Promise<void>;
    onError: (message: string) => Promise<void>;
} {
    const onError = async (message: string): Promise<void> => {
        // The attempt may still be pending if the browser reported the failure rather than the exchange.
        await deps.oidcLoginService.cancel();

        vscode.window.showErrorMessage(`Artemis Login failed: ${message}`);
        deps.postMessage({ type: ExtensionMsg.LoginError, error: message });
    };

    const onCode = async (code: string): Promise<void> => {
        let user: ArtemisUser;
        try {
            user = await deps.oidcLoginService.complete(code);
        } catch (error) {
            logger.error('Failed to complete OIDC login from URI callback', LogCategory.AUTH, error);

            const message = error instanceof Error ? error.message : 'Authentication failed. Please try again.';
            vscode.window.showErrorMessage(`Artemis Login failed: ${message}`);
            deps.postMessage({ type: ExtensionMsg.LoginError, error: message });
            return;
        }

        // Sent first, for the same reason as the password path: the view clears its pending state only on
        // a success or an error, so a failure in the wiring below must not leave it waiting.
        deps.postMessage({ type: ExtensionMsg.LoginSuccess, username: user.login || 'User' });

        try {
            await deps.updateAuthContext(true);
            await deps.navigateToStartPage(user);
            vscode.window.showInformationMessage(`Successfully logged in to Artemis as ${user.login || 'User'}`);
        } catch (error) {
            logger.error('OIDC login succeeded but the UI could not be updated', LogCategory.AUTH, error);
        }
    };

    return { onCode, onError };
}
