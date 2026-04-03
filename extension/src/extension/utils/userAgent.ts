import * as vscode from 'vscode';
import { getTheiaEnvironment } from '../theia';

let _userAgent: string | undefined;

/**
 * Returns a platform-aware User-Agent string for HTTP/WS requests.
 * Cached after first call since the values are immutable per session.
 */
export function getUserAgent(): string {
    if (!_userAgent) {
        const ext = vscode.extensions.getExtension('aet-tum.iris-thaumantias');
        const version = (ext?.packageJSON as { version?: string })?.version ?? 'unknown';
        const platform = getTheiaEnvironment().isTheia ? 'Theia' : 'Desktop';
        _userAgent = `IrisThaumantias/${version} (${platform}; ${process.platform})`;
    }
    return _userAgent;
}
