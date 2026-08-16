import * as vscode from 'vscode';
import * as crypto from 'crypto';

/**
 * Generate a Content Security Policy nonce: 16 CSPRNG bytes, i.e. the 128 bits
 * of entropy the W3C CSP Level 2 spec requires, hex-encoded.
 *
 * The spec's other requirements bind the callers: a nonce must be unique per
 * HTML response (never reused or cached) and must never reach a log or a
 * postMessage payload.
 */
function getNonce(): string {
    return crypto.randomBytes(16).toString('hex');
}

/**
 * Generate the CSP-compliant HTML shell for a React webview: `default-src
 * 'none'` plus a per-response nonce, with no relaxed script directives.
 * `viewName` becomes the `data-view` attribute on the React mount point.
 */
export function getReactWebviewHtml(webview: vscode.Webview, extensionUri: vscode.Uri, viewName?: string): string {
    const nonce = getNonce();

    // base.css is bundled into webview-react.css via the index.tsx import.
    const scriptUri = webview.asWebviewUri(
        vscode.Uri.joinPath(extensionUri, 'dist', 'webview-react.js')
    );
    const reactStyleUri = webview.asWebviewUri(
        vscode.Uri.joinPath(extensionUri, 'dist', 'webview-react.css')
    );
    const logoUri = webview.asWebviewUri(
        vscode.Uri.joinPath(extensionUri, 'media', 'artemis-blue.png')
    );
    const irisLogoUri = webview.asWebviewUri(
        vscode.Uri.joinPath(extensionUri, 'media', 'iris-logo-big-left.png')
    );
    const dataViewAttr = viewName ? ` data-view="${viewName}"` : '';

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https: data:; font-src ${webview.cspSource}; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">

    <title>Artemis</title>
    <link rel="stylesheet" type="text/css" href="${reactStyleUri}">
</head>
<body>
    <div id="root"${dataViewAttr} data-logo-uri="${logoUri}" data-iris-logo-uri="${irisLogoUri}"></div>
    <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}
