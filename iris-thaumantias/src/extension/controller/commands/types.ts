import type * as vscode from 'vscode';
import type { ArtemisApiService } from '../../api';
import type { AppStateManager } from '../appStateManager';
import type { WebViewActionHandler } from '../types';
import type { AuthManager } from '../../services/auth';
import type { ArtemisWebsocketService } from '../../services/websocket';
import type { ExerciseRegistry } from '../../services/exerciseRegistry';
import type { IProviderRegistry } from '../../services/ui';
import type { WebviewToExtensionMessage, ExtensionToWebviewMessage } from '../../../shared/messageContracts';
import type { TheiaEnvironment } from '../../theia';
import type { CourseDataCache } from '../../services/courseDataCache';

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
    theiaEnv?: TheiaEnvironment;
}
