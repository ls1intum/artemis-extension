import * as vscode from 'vscode';

/**
 * Generate a cryptographically random nonce for Content Security Policy.
 * Returns a 32-character alphanumeric string.
 *
 * This uses the standard VS Code pattern with Math.random() which is sufficient
 * for CSP nonces since the webview runs in a local, trusted context.
 */
export function getNonce(): string {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}

/**
 * Generate CSP-compliant HTML for React webview.
 *
 * Creates a secure HTML shell with:
 * - Nonce-based Content Security Policy (no unsafe-inline or unsafe-eval)
 * - Default-src 'none' (deny all by default)
 * - Proper webview URI resolution for scripts and styles
 * - React mount point (#root)
 *
 * @param webview - The VS Code webview instance (provides cspSource and asWebviewUri)
 * @param extensionUri - The extension's base URI for resolving bundle paths
 * @param viewName - Optional view name to set as data-view attribute on root element
 * @returns HTML string ready to be assigned to webview.html
 */
export function getReactWebviewHtml(webview: vscode.Webview, extensionUri: vscode.Uri, viewName?: string): string {
    const nonce = getNonce();

    // Build URIs for React bundle and base CSS
    const scriptUri = webview.asWebviewUri(
        vscode.Uri.joinPath(extensionUri, 'dist', 'webview-react.js')
    );
    const styleUri = webview.asWebviewUri(
        vscode.Uri.joinPath(extensionUri, 'dist', 'base.css')
    );

    const dataViewAttr = viewName ? ` data-view="${viewName}"` : '';

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https:; font-src ${webview.cspSource}; style-src ${webview.cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
    <title>Artemis</title>
    <link rel="stylesheet" type="text/css" href="${styleUri}" nonce="${nonce}">
</head>
<body>
    <div id="root"${dataViewAttr}></div>
    <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}
