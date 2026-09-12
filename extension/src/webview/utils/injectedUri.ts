/**
 * The URLs the extension host injects onto the webview's root element.
 *
 * `webviewHtml.ts` writes these attributes from `webview.asWebviewUri(...)`, so their values are
 * minted by the extension itself and were never attacker-controlled. Reading one back out of the
 * DOM and handing it to an `src` is nevertheless an unchecked hop between two layers: whoever
 * reads the call site has to go and confirm the guarantee in another file. Checking the scheme
 * here costs nothing and makes it local.
 *
 * Both readers went through it unchecked before, and only one of them was ever reported, because
 * the analysis models `getAttribute()` as a source of DOM text but not `dataset`. The two call
 * sites were equally safe and equally unverified; this is the shared answer for both.
 */

/** The schemes the webview's own `img-src` policy accepts. See `webviewHtml.ts`. */
const ALLOWED_SCHEMES = ['https', 'data', 'vscode-resource', 'vscode-webview-resource'];

/**
 * The injected URL under `data-*`, or an empty string when it names a scheme we will not render.
 *
 * A value with no scheme is relative and resolves against the webview's own document, which cannot
 * introduce one, so it passes. An empty `src` renders nothing, which is the right outcome for a
 * decorative image whose source cannot be trusted.
 *
 * Read through `dataset`, which is the accessor the Dashboard already used and the idiomatic one
 * for a data attribute. Worth stating plainly, because it also decides what the code scanner says:
 * it models `getAttribute()` as a source of DOM text and does not model `dataset`, which is why
 * only one of the two identical call sites was ever reported. The accessor is not the safety here.
 * The scheme check below is.
 *
 * @param key the data attribute to read, in its `dataset` spelling
 */
export function readInjectedUri(key: string): string {
    const raw = document.getElementById('root')?.dataset[key] ?? '';
    const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(raw)?.[1].toLowerCase();
    return scheme === undefined || ALLOWED_SCHEMES.includes(scheme) ? raw : '';
}
