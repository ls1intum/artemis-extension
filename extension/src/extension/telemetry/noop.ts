import type * as vscode from 'vscode';

import type { IStruggleCoordinator, StruggleEngineDeps } from './contract';
import { NoopStruggleCoordinator } from './noopStruggleCoordinator';

/**
 * No-op struggle seam for the Open VSX (clean / Theia-cloud / EduIDE) build.
 * Imports NOTHING from services/struggle|intervention, so esbuild keeps those
 * subtrees out of the clean bundle. The cloud artifact therefore contains no
 * behavioural-tracking engine at all (verified fail-closed by
 * scripts/verify-clean-bundle.js, run in scripts/package-openvsx.js).
 */
export function createStruggleEngine(_deps: StruggleEngineDeps): IStruggleCoordinator {
    return new NoopStruggleCoordinator();
}

/** No-op in the clean build: the struggle-score command is never registered. */
export function registerDebugCommands(_coordinator: IStruggleCoordinator): vscode.Disposable {
    return { dispose() { /* no command registered in the clean build */ } };
}
