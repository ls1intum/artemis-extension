import * as vscode from 'vscode';

export class ArtemisUriHandler implements vscode.UriHandler {
    constructor(private readonly handleToken: (token: string) => Promise<void>) {}

    async handleUri(uri: vscode.Uri): Promise<void> {
        // We expect the following Uri: vscode://<publisher>.<extension-name>/auth-callback?token=EYJ...
        const queryParams = new URLSearchParams(uri.query);
        const token = queryParams.get('token');
        const error = queryParams.get('error');
        if (error) {
            const message = error === 'deactivated'
                ? 'Your account is deactivated in Artemis.'
                : 'Authentication failed in browser.';
            vscode.window.showErrorMessage(`Artemis Login failed: ${message}`);
            return;
        }
        if (token) {
            await this.handleToken(token);
        } else {
            vscode.window.showErrorMessage('Artemis Login failed: No auth token received from server.');
        }
    }
}
