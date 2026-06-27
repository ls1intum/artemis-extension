import type * as vscode from 'vscode';

import type { ILiveEngineFeed, IStruggleCoordinator, StruggleEngineDeps, StruggleEngineHandle } from './contract';
import { NoopStruggleCoordinator } from './noopStruggleCoordinator';

/**
 * No-op struggle seam for the Open VSX (clean / Theia-cloud / EduIDE) build.
 * Imports NOTHING from services/struggle|intervention, so esbuild keeps those
 * subtrees out of the clean bundle. The cloud artifact therefore contains no
 * behavioural-tracking engine at all (verified fail-closed by
 * scripts/verify-clean-bundle.js, run in scripts/package-openvsx.js).
 */
export function createStruggleEngine(_deps: StruggleEngineDeps): StruggleEngineHandle {
    return {
        coordinator: new NoopStruggleCoordinator(),
        // No engine in the clean build, so there is nothing to consent to.
        promptConsentIfAsk: async () => { /* no proactive egress in the clean build */ },
        recordProactiveDismiss: () => { /* no backoff in the clean build */ },
        // isProactivePaused / setStudentProactive / resumeProactive are intentionally OMITTED: the clean build has no
        // proactive engine, so extension.ts builds no proactiveControl capability and the AskIris switch never renders.
    };
}

/** No-op live feed in the clean build: no engine, so nothing ever streams. */
export function createLiveEngineFeed(
    _coordinator: IStruggleCoordinator,
    _post: (msg: unknown) => void,
    _isDeveloperMode: () => boolean,
): ILiveEngineFeed {
    return {
        subscribe() { /* no engine in the clean build */ },
        unsubscribe() { /* no engine in the clean build */ },
        setSessionActive(_active: boolean) { /* no engine in the clean build */ },
        dispose() { /* nothing to dispose */ },
    };
}

/** No-op in the clean build: the struggle-score command is never registered. */
export function registerDebugCommands(_coordinator: IStruggleCoordinator): vscode.Disposable {
    return { dispose() { /* no command registered in the clean build */ } };
}
