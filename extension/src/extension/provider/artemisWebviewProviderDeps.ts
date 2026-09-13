import type * as vscode from 'vscode';

import type { ArtemisApiService } from '@extension/api';
import type { AuthCancellationService, AuthManager, OidcLoginService } from '@extension/services/auth';
import type { HandoverFailureStore } from '@extension/services/auth/handoverFailureStore';
import type { CourseAccessStorageService } from '@extension/services/courseAccessStorageService';
import type { CourseCatalog } from '@extension/services/courseCatalog';
import type { ITelemetryManager } from '@extension/services/telemetry';
import type { IProviderRegistry } from '@extension/services/ui';
import type { ArtemisWebsocketService } from '@extension/services/websocket';

import type { BuildErrorCodeLensProvider } from './buildErrorCodeLensProvider';

export interface ArtemisWebviewProviderDeps {
    extensionUri: vscode.Uri;
    extensionContext: vscode.ExtensionContext;
    authManager: AuthManager;
    artemisApi: ArtemisApiService;
    oidcLoginService: OidcLoginService;
    authCancellation: AuthCancellationService;
    handoverFailures: HandoverFailureStore;
    providerRegistry: IProviderRegistry;
    websocketService: ArtemisWebsocketService;
    buildErrorCodeLensProvider: BuildErrorCodeLensProvider;
    telemetryManager: ITelemetryManager;
    updateAuthContext: (isAuthenticated: boolean) => Promise<void>;
    /**
     * Owned by activation, because its scope comes from the session
     * coordinator: the sidebar's own view state cannot name the identity.
     */
    courseAccessStorage: CourseAccessStorageService;
    courseCatalog?: CourseCatalog;
}
