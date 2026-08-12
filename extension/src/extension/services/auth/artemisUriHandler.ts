import * as vscode from 'vscode';

export class ArtemisUriHandler implements vscode.UriHandler {
    constructor(private readonly handleCode: (token: string) => Promise<void>) {}

    async handleUri(uri: vscode.Uri): Promise<void> {
        // We expect the following Uri: vscode://<publisher>.<extension-name>/auth-callback?code=EXCHANGE-CODE
        const queryParams = new URLSearchParams(uri.query);
        const code = queryParams.get('code');
        const error = queryParams.get('error');

        if (error) {
            const message = error === 'deactivated'
                ? 'Your account is deactivated in Artemis.'
                : 'Authentication failed in browser.';
            vscode.window.showErrorMessage(`Artemis Login failed: ${message}`);
            return;
        }
        if (code) {
            await this.handleCode(code);
        } else {
            vscode.window.showErrorMessage('Artemis Login failed: No auth code received from server.');
        }
    }
}
