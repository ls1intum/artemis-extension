import * as vscode from 'vscode';

import type { CommandMap } from '@extension/controller/commands/types';

import type { DataCollectionDeps, DataCollectionHandle } from './types';

const RECORDER_ACTIVE_KEY = 'iris.recorder.active';

/**
 * No-op data-collection seam for the shipped builds (Desktop `full` + Open VSX).
 * Imports nothing from consent/recording, so esbuild keeps that subtree out of the
 * bundle, and explicitly marks the recorder inactive so recorder commands stay hidden.
 */
export function wireDataCollection(_deps: DataCollectionDeps): DataCollectionHandle {
    void vscode.commands.executeCommand('setContext', RECORDER_ACTIVE_KEY, false);
    return {
        async dispose(): Promise<void> {
            void vscode.commands.executeCommand('setContext', RECORDER_ACTIVE_KEY, false);
        },
    };
}

/** No recording webview handlers in the shipped builds. */
export function createRecordingWebviewHandlers(_globalStorageUri: vscode.Uri): CommandMap {
    return {};
}
