import * as vscode from 'vscode';

import { wireSessionRecorder } from '@extension/activation/sessionRecorderWiring';
import type { CommandMap } from '@extension/controller/commands/types';
import { ConsentService } from '@extension/services/auth/consentService';
import { LogCategory, logger } from '@extension/services/loggingService';
import type { SessionRecorder } from '@extension/services/recording';

import type { DataCollectionDeps, DataCollectionHandle } from './types';

/** Webview command handlers for opening recordings (recording build only). */
export function createRecordingWebviewHandlers(globalStorageUri: vscode.Uri): CommandMap {
    return {
        openRecordingsFolder: async () => {
            const recordingsUri = vscode.Uri.joinPath(globalStorageUri, 'recordings');
            await vscode.commands.executeCommand('revealFileInOS', recordingsUri);
        },
    };
}

/** Wire consent + recorder + recording palette commands. Recording build only. */
export function wireDataCollection(deps: DataCollectionDeps): DataCollectionHandle {
    const { context } = deps;
    const consentService = new ConsentService();
    const recordingsUri = context.globalStorageUri;

    const paletteCommands = vscode.Disposable.from(
        vscode.commands.registerCommand('artemis.openRecordingsFolder', async () => {
            await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.joinPath(recordingsUri, 'recordings'));
        }),
    );

    const { sessionRecorder, disposable: recorderDisposable } = wireSessionRecorder({
        context,
        consentService,
        artemisWebsocketService: deps.artemisWebsocketService,
        struggleCoordinator: deps.struggleCoordinator,
        artemisWebviewProvider: deps.artemisWebviewProvider,
        chatWebviewProvider: deps.chatWebviewProvider,
        capabilities: deps.capabilities,
        exerciseRegistry: deps.exerciseRegistry,
        contextStore: deps.contextStore,
        sensorHub: deps.sensorHub,
    });

    // Prompt after wiring so a consent change immediately reaches the recorder.
    void consentService.promptIfPending();

    let disposed = false;
    return {
        async dispose(): Promise<void> {
            if (disposed) { return; }
            disposed = true;
            try {
                await (sessionRecorder as SessionRecorder).shutdown();
            } catch (err) {
                logger.error('Failed to shut down SessionRecorder', LogCategory.TELEMETRY, err);
            }
            recorderDisposable.dispose();
            paletteCommands.dispose();
            consentService.dispose();
        },
    };
}
