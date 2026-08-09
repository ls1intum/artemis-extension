import type * as vscode from 'vscode';

import type { ArtemisApiService } from '@extension/api';
import type { CommandContext } from '@extension/controller/commands/types';
import type { AuthManager } from '@extension/services/auth';
import type { CourseAccessStorageService } from '@extension/services/courseAccessStorageService';
import type { CourseCatalog } from '@extension/services/courseCatalog';
import type { IProviderRegistry } from '@extension/services/ui';
import type { ArtemisWebsocketService } from '@extension/services/websocket';
import type { NoAiDetectionService } from '@extension/services/workspace';
import type { IStruggleCoordinator } from '@extension/telemetry/contract';

import type { BuildErrorCodeLensProvider } from './buildErrorCodeLensProvider';

export interface ArtemisWebviewProviderDeps {
    extensionUri: vscode.Uri;
    extensionContext: vscode.ExtensionContext;
    authManager: AuthManager;
    artemisApi: ArtemisApiService;
    providerRegistry: IProviderRegistry;
    websocketService: ArtemisWebsocketService;
    noAiDetectionService: NoAiDetectionService;
    buildErrorCodeLensProvider: BuildErrorCodeLensProvider;
    struggleCoordinator: IStruggleCoordinator;
    updateAuthContext: (isAuthenticated: boolean) => Promise<void>;
    /** Behind-the-`@telemetry`-seam proactive control (pause/resume/apply); absent in the clean build (spec §12.2). */
    proactiveControl?: CommandContext['proactiveControl'];
    /**
     * Owned by activation, because its scope comes from the session
     * coordinator: the sidebar's own view state cannot name the identity.
     */
    courseAccessStorage: CourseAccessStorageService;
    courseCatalog?: CourseCatalog;
}
