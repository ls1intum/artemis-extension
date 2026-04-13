import * as vscode from 'vscode';
import * as crypto from 'crypto';

/**
 * Generate a cryptographically secure nonce for Content Security Policy.
 *
 * Uses Node.js crypto.randomBytes() (CSPRNG) to produce 16 bytes (128 bits)
 * of entropy, encoded as a 32-character lowercase hex string.
 *
 * Per W3C CSP Level 2 spec, nonces must:
 * - Come from a cryptographically secure source
 * - Be at least 128 bits of entropy
 * - Be unique per HTML response (never reused or cached)
 * - Not appear in server logs or be sent back via postMessage
 */
function getNonce(): string {
    return crypto.randomBytes(16).toString('hex');
}

/**
 * Generate CSP-compliant HTML for React webview.
 *
 * Creates a secure HTML shell with:
 * - Nonce-based Content Security Policy (no relaxed directives, nonces only)
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

    // Build URIs for React bundle and CSS
    // Note: base.css is bundled into webview-react.css via index.tsx import
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
    <!-- CSP directives:
         default-src 'none'          - deny everything not explicitly allowed
         script-src 'nonce-...'      - only scripts with matching nonce attribute
         style-src unsafe-inline     - allow server-rendered <style> + inline style= attrs
         img-src cspSource https: data: - webview images + HTTPS + data URIs (task icons)
         font-src cspSource          - webview-origin fonts (KaTeX fonts in dist/)
    -->
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https: data:; font-src ${webview.cspSource}; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">

    <title>Artemis</title>
    <link rel="stylesheet" type="text/css" href="${reactStyleUri}">
</head>
<body>
    <div id="root"${dataViewAttr} data-logo-uri="${logoUri}" data-iris-logo-uri="${irisLogoUri}" data-csp-nonce="${nonce}"></div>
    <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}
