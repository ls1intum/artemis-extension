import type * as vscode from 'vscode';

import type { ArtemisWebviewProvider, ChatWebviewProvider } from '@extension/provider';
import type { ExerciseRegistry } from '@extension/services/exerciseRegistry';
import type { ITelemetryManager } from '@extension/services/telemetry';
import type { ArtemisWebsocketService } from '@extension/services/websocket';
import type { WorkspaceExerciseTracker } from '@extension/services/workspace/workspaceExerciseTracker';
import type { PlatformCapabilities } from '@extension/theia';

/** Everything the full data-collection seam needs to wire consent + recording. */
export interface DataCollectionDeps {
    context: vscode.ExtensionContext;
    artemisWebsocketService: ArtemisWebsocketService;
    telemetryManager: ITelemetryManager;
    artemisWebviewProvider: ArtemisWebviewProvider;
    chatWebviewProvider: ChatWebviewProvider;
    capabilities?: PlatformCapabilities;
    exerciseRegistry?: ExerciseRegistry;
    workspaceTracker: WorkspaceExerciseTracker;
}

/**
 * Lifecycle handle for the data-collection subsystem. dispose() is async so the
 * recorder can flush buffered JSONL before host teardown. Owned explicitly by
 * extension.ts (NOT pushed into context.subscriptions, which disposes synchronously).
 */
export interface DataCollectionHandle {
    dispose(): Promise<void>;
}
