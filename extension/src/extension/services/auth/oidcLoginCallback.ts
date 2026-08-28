import * as vscode from 'vscode';

import type { ExtensionToWebviewMessage } from '@shared/messageContracts';
import { ExtensionMsg } from '@shared/messageContracts';

import type { ArtemisUser } from '@extension/domain';
import { LogCategory, logger } from '@extension/services/loggingService';

import type { HandoverFailureStore } from './handoverFailureStore';
import { LoginCancelledError } from './loginCancelledError';
import type { OidcLoginService } from './oidcLoginService';

interface OidcLoginCallbackDeps {
    oidcLoginService: OidcLoginService;
    handoverFailures: HandoverFailureStore;
    updateAuthContext: (isAuthenticated: boolean) => Promise<void>;
    postMessage: (message: ExtensionToWebviewMessage) => void;
    navigateToStartPage: (user: ArtemisUser) => Promise<void>;
}

/**
 * Adapts a browser callback to the rest of the extension, and owns the user-facing messaging for it.
 *
 * Extracted from `activate()` so its rules can actually be tested:
 *
 * - A failure is never allowed to clear credentials. Everything that can fail before the commit happens
 *   inside `complete()`, which leaves an existing session untouched, so there is nothing to undo.
 * - A failure after the commit is not a login failure. The user is signed in at that point; reporting an
 *   error would contradict the credential that was just stored, and would land after the success message.
 * - A cancellation is never reported as a failure. The user caused it; an error toast would contradict
 *   their own action.
 * - A callback for an attempt nothing here still considers live is not reported either. The browser
 *   echoes no id, so a stray one cannot be told apart from a real failure except by asking whether
 *   anything is still waiting on an answer.
 */
export function createOidcLoginCallback(deps: OidcLoginCallbackDeps): {
    onCode: (code: string) => Promise<void>;
    onError: (message: string) => Promise<void>;
} {
    const onError = async (message: string): Promise<void> => {
        // The browser echoes no id, so this cannot be attributed to a particular attempt. The best this
        // can do is refuse to act when nothing is live at all: otherwise a browser tab left open from an
        // attempt the user already retracted could cancel a newer one just by reporting late.
        if (!deps.oidcLoginService.hasLiveAttempt()) {
            logger.info('Ignoring an OIDC error for an attempt that is no longer live', LogCategory.AUTH);
            return;
        }

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
            if (error instanceof LoginCancelledError) {
                logger.info('OIDC login cancelled by the user', LogCategory.AUTH);
                return;
            }

            logger.error('Failed to complete OIDC login from URI callback', LogCategory.AUTH, error);

            const message = error instanceof Error ? error.message : 'Authentication failed. Please try again.';
            vscode.window.showErrorMessage(`Artemis Login failed: ${message}`);
            deps.postMessage({ type: ExtensionMsg.LoginError, error: message });
            return;
        }

        // Still sent before the wiring below, for the same reason as the password path: a failure there
        // must not leave the view waiting on a login that actually worked. What it announces is the
        // START of the handover, not the end of the flow.
        const generation = deps.handoverFailures.begin();
        deps.postMessage({ type: ExtensionMsg.LoginSuccess, username: user.login || 'User' });

        try {
            await deps.updateAuthContext(true);
            await deps.navigateToStartPage(user);
            vscode.window.showInformationMessage(`Successfully logged in to Artemis as ${user.login || 'User'}`);
            deps.handoverFailures.clearFor(generation);
        } catch (error) {
            logger.error('OIDC login succeeded but the UI could not be updated', LogCategory.AUTH, error);
            // Not a login error: the credential is committed and valid. Saying otherwise would send the
            // user back to authenticate against a session they already have.
            const message = 'Signed in, but Artemis could not be opened. Reload the window to continue.';
            if (deps.handoverFailures.record(generation, message)) {
                deps.postMessage({ type: ExtensionMsg.LoginHandoverFailed, error: message });
            }
        }
    };

    return { onCode, onError };
}
