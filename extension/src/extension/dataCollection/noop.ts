import type * as vscode from 'vscode';

import type { CommandMap } from '@extension/controller/commands/types';

import type { DataCollectionDeps, DataCollectionHandle } from './types';

/**
 * No-op data-collection seam for the Open VSX (clean) variant. Imports nothing
 * from consent/recording, so esbuild keeps that subtree out of the bundle.
 */
export function wireDataCollection(_deps: DataCollectionDeps): DataCollectionHandle {
    return {
        async dispose(): Promise<void> { /* nothing to tear down */ },
    };
}

/** No recording webview handlers in the clean build. */
export function createRecordingWebviewHandlers(_globalStorageUri: vscode.Uri): CommandMap {
    return {};
}
