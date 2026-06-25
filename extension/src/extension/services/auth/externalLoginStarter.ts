import * as vscode from 'vscode';

import { LogCategory, logger } from '@extension/services/loggingService';
import { getTheiaEnvironment } from '@extension/theia';
import { CONFIG, resolveServerUrl } from '@extension/utils';

import { PendingExternalLoginStore } from './pendingExternalLogin';
import { deriveS256Challenge, generateCodeVerifier, generateState } from './pkce';

/** The path (on the extension's URI namespace) that the web app redirects back to after login. */
export const EXTERNAL_LOGIN_CALLBACK_PATH = '/external-login-callback';

/**
 * Starts the browser-delegated login: generates a PKCE verifier + anti-forgery state, persists them,
 * and opens the system browser at the Artemis web app's external-login page. The web app authenticates
 * the user (passkey, SAML2 SSO, or password) and redirects back to this extension via a custom-scheme
 * callback, which {@link AuthFlowHandler#completeExternalLogin} then completes.
 *
 * @param context the extension context (used for SecretStorage and the extension id)
 */
export async function startBrowserLogin(context: vscode.ExtensionContext): Promise<void> {
    if (getTheiaEnvironment().isTheia) {
        // Browser-delegated login has no callback handler in Theia/EduIDE (which authenticates from the
        // environment). Guard execution, not just the UI, so a manual command invocation is a safe no-op.
        vscode.window.showInformationMessage('Browser sign-in is not available in this environment.');
        return;
    }

    const verifier = generateCodeVerifier();
    const challenge = deriveS256Challenge(verifier);
    const state = generateState();
    const serverUrl = resolveServerUrl();

    await new PendingExternalLoginStore(context).save({ verifier, state, createdAt: Date.now(), serverUrl });

    // The callback authority is the extension id (matches the server's optional authority allowlist).
    // asExternalUri keeps the callback resolvable in remote/UI scenarios.
    const callbackUri = await vscode.env.asExternalUri(vscode.Uri.parse(`${vscode.env.uriScheme}://${context.extension.id}${EXTERNAL_LOGIN_CALLBACK_PATH}`));

    // toString(true) = skipEncoding. asExternalUri may append a ?windowId=N marker; with default
    // encoding that inner query gets pre-encoded and then double-encoded by URLSearchParams, which makes
    // the marker fold into the callback's path on the way back (breaking the path match). Skipping the
    // inner encoding keeps windowId a proper query param so the callback round-trips cleanly.
    const params = new URLSearchParams({
        code_challenge: challenge,
        callback: callbackUri.toString(true),
        state,
    });
    const webUrl = `${serverUrl}${CONFIG.EXTERNAL_LOGIN_PATH}?${params.toString()}`;

    logger.info('Starting browser-delegated login', LogCategory.AUTH);
    await vscode.env.openExternal(vscode.Uri.parse(webUrl));
}
