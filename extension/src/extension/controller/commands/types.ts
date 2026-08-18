import type * as vscode from 'vscode';

import type { ExtensionToWebviewMessage, WebviewToExtensionMessage } from '@shared/messageContracts';

import type { ArtemisApiService } from '@extension/api';
import type { AppStateManager } from '@extension/controller/appStateManager';
import type { WebViewActionHandler } from '@extension/controller/types';
import type { AuthManager, OidcLoginService } from '@extension/services/auth';
import type { CourseAccessStorageService } from '@extension/services/courseAccessStorageService';
import type { CourseCatalog } from '@extension/services/courseCatalog';
import type { IProviderRegistry } from '@extension/services/ui';
import type { ArtemisWebsocketService } from '@extension/services/websocket';

export type CommandHandler = (message: WebviewToExtensionMessage) => Promise<void>;
export type CommandMap = Record<string, CommandHandler>;

export interface CommandContext {
    authManager: AuthManager;
    artemisApi: ArtemisApiService;
    oidcLoginService: OidcLoginService;
    appStateManager: AppStateManager;
    actionHandler: WebViewActionHandler;
    sendMessage(message: ExtensionToWebviewMessage): void;
    updateAuthContext(isAuthenticated: boolean): Promise<void>;
    getWebsocketService?: () => ArtemisWebsocketService | undefined;
    recheckRepoStatus?: () => Promise<void>;
    extensionContext: vscode.ExtensionContext;
    providerRegistry: IProviderRegistry;
    courseCatalog?: CourseCatalog;
    courseAccessStorage?: CourseAccessStorageService;
    /**
     * The catalog's current epoch, read live on every call. A supplemental
     * write built against a stale epoch is rejected by
     * `CourseCatalog.upsertSupplemental`, so callers capture this BEFORE any
     * await they issue, never after.
     */
    sessionEpoch: () => number;
}
