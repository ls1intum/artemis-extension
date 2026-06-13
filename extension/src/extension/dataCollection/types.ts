import type * as vscode from 'vscode';

import type { ArtemisWebviewProvider, ChatWebviewProvider } from '@extension/provider';
import type { ExerciseRegistry } from '@extension/services/exerciseRegistry';
import type { ContextStore } from '@extension/services/iris/context/contextStore';
import type { SensorHub } from '@extension/services/sensing';
import type { StruggleCoordinator } from '@extension/services/struggle/struggleCoordinator';
import type { ArtemisWebsocketService } from '@extension/services/websocket';
import type { PlatformCapabilities } from '@extension/theia';

/** Everything the full data-collection seam needs to wire consent + recording. */
export interface DataCollectionDeps {
    context: vscode.ExtensionContext;
    artemisWebsocketService: ArtemisWebsocketService;
    struggleCoordinator: StruggleCoordinator;
    artemisWebviewProvider: ArtemisWebviewProvider;
    chatWebviewProvider: ChatWebviewProvider;
    capabilities?: PlatformCapabilities;
    exerciseRegistry?: ExerciseRegistry;
    contextStore: ContextStore;
    sensorHub: SensorHub;
}

/**
 * Lifecycle handle for the data-collection subsystem. dispose() is async so the
 * recorder can flush buffered JSONL before host teardown. Owned explicitly by
 * extension.ts (NOT pushed into context.subscriptions, which disposes synchronously).
 */
export interface DataCollectionHandle {
    dispose(): Promise<void>;
}
