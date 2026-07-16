import * as vscode from 'vscode';

import type { CommandMap } from '@extension/controller/commands/types';

import { createRecordingWebviewHandlers as createRealHandlers, wireDataCollection as wireReal } from './index';
import type { DataCollectionDeps, DataCollectionHandle } from './types';

const RECORDER_ACTIVE_KEY = 'iris.recorder.active';

/**
 * Real data-collection seam for the local-recording build variant. Wraps the
 * untouched index.ts wiring and publishes the `iris.recorder.active` context key so
 * the manifest shows recorder commands only when the recorder is actually present.
 */
export function wireDataCollection(deps: DataCollectionDeps): DataCollectionHandle {
    const handle = wireReal(deps);
    void vscode.commands.executeCommand('setContext', RECORDER_ACTIVE_KEY, true);
    let disposed = false;
    return {
        async dispose(): Promise<void> {
            if (disposed) { return; }
            disposed = true;
            try {
                await handle.dispose();
            } finally {
                void vscode.commands.executeCommand('setContext', RECORDER_ACTIVE_KEY, false);
            }
        },
    };
}

export const createRecordingWebviewHandlers: (globalStorageUri: vscode.Uri) => CommandMap = createRealHandlers;
