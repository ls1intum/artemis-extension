import type * as vscode from 'vscode';

import type { ExtensionToWebviewMessage, WebviewToExtensionMessage } from '@shared/messageContracts';

import type { ArtemisApiService } from '@extension/api';
import type { AppStateManager } from '@extension/controller/appStateManager';
import type { WebViewActionHandler } from '@extension/controller/types';
import type { AuthManager } from '@extension/services/auth';
import type { CourseAccessStorageService } from '@extension/services/courseAccessStorageService';
import type { CourseDataCache } from '@extension/services/courseDataCache';
import type { ExerciseRegistry } from '@extension/services/exerciseRegistry';
import type { IProviderRegistry } from '@extension/services/ui';
import type { ArtemisWebsocketService } from '@extension/services/websocket';

export type CommandHandler = (message: WebviewToExtensionMessage) => Promise<void>;
export type CommandMap = Record<string, CommandHandler>;

export interface CommandContext {
    authManager: AuthManager;
    artemisApi: ArtemisApiService;
    appStateManager: AppStateManager;
    actionHandler: WebViewActionHandler;
    sendMessage(message: ExtensionToWebviewMessage): void;
    updateAuthContext(isAuthenticated: boolean): Promise<void>;
    getWebsocketService?: () => ArtemisWebsocketService | undefined;
    extensionContext: vscode.ExtensionContext;
    exerciseRegistry: ExerciseRegistry;
    providerRegistry: IProviderRegistry;
    courseDataCache?: CourseDataCache;
    courseAccessStorage?: CourseAccessStorageService;
}
