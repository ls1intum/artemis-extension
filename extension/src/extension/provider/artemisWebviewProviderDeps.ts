import type * as vscode from 'vscode';

import type { ArtemisApiService } from '@extension/api';
import type { AuthManager } from '@extension/services/auth';
import type { CourseDataCache } from '@extension/services/courseDataCache';
import type { ExerciseRegistry } from '@extension/services/exerciseRegistry';
import type { IProviderRegistry } from '@extension/services/ui';
import type { ArtemisWebsocketService } from '@extension/services/websocket';
import type { IStruggleCoordinator } from '@extension/telemetry/contract';

import type { BuildErrorCodeLensProvider } from './buildErrorCodeLensProvider';

export interface ArtemisWebviewProviderDeps {
    extensionUri: vscode.Uri;
    extensionContext: vscode.ExtensionContext;
    authManager: AuthManager;
    artemisApi: ArtemisApiService;
    exerciseRegistry: ExerciseRegistry;
    providerRegistry: IProviderRegistry;
    websocketService: ArtemisWebsocketService;
    buildErrorCodeLensProvider: BuildErrorCodeLensProvider;
    struggleCoordinator: IStruggleCoordinator;
    updateAuthContext: (isAuthenticated: boolean) => Promise<void>;
    courseDataCache?: CourseDataCache;
}
