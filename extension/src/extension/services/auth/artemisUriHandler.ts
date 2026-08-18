import * as vscode from 'vscode';

/** The path the Artemis server redirects to: `vscode://<publisher>.<extension>/auth-callback`. */
const AUTH_CALLBACK_PATH = '/auth-callback';

/** The failures the server reports back through the redirect. */
function describeCallbackError(error: string): string {
    switch (error) {
        case 'deactivated':
            return 'Your account is deactivated in Artemis.';
        case 'invalid_request':
            return 'Artemis could not verify this sign-in. Please try logging in again.';
        case 'server_error':
            return 'Artemis could not complete the sign-in. Please try again later.';
        default:
            return 'Authentication failed in browser.';
    }
}

/**
 * Turns the `vscode://` callback into either a code or an error.
 *
 * Deliberately silent: it reports through the two callbacks and never shows a notification itself, so a
 * single failure cannot produce one message from here and a second from the handler that receives it.
 */
export class ArtemisUriHandler implements vscode.UriHandler {
    constructor(
        private readonly onCode: (code: string) => Promise<void>,
        private readonly onError: (message: string) => Promise<void>,
    ) {}

    async handleUri(uri: vscode.Uri): Promise<void> {
        // A callback built with `asExternalUri` carries a `?windowId=N` marker so it comes back to the
        // window that started the sign-in. Depending on how it round-trips through the server's redirect,
        // that marker can end up folded into `uri.path` ("/auth-callback?windowId=3") instead of staying
        // in `uri.query`. This codebase has already paid for that once: a strict path comparison then
        // rejects every real callback and the code is never redeemed. Today's server hardcodes the URI
        // and appends nothing, so this only guards the day someone adopts `asExternalUri`, which is also
        // the way to give a callback back to the right window.
        const pathQueryIndex = uri.path.indexOf('?');
        const path = pathQueryIndex === -1 ? uri.path : uri.path.slice(0, pathQueryIndex);
        const pathQuery = pathQueryIndex === -1 ? '' : uri.path.slice(pathQueryIndex + 1);

        if (path !== AUTH_CALLBACK_PATH) {
            // Some other feature's deep link, or a malformed one. Not ours to interpret.
            return;
        }

        const queryParams = new URLSearchParams([uri.query, pathQuery].filter(Boolean).join('&'));
        const code = queryParams.get('code');
        const error = queryParams.get('error');

        if (error) {
            await this.onError(describeCallbackError(error));
            return;
        }
        if (code) {
            await this.onCode(code);
            return;
        }
        await this.onError('No sign-in code was received from the server.');
    }
}
