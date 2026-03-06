import type * as vscode from 'vscode';
import type { AuthManager } from '../../../auth';
import type { ArtemisApiService } from '../../../api';
import type { AppStateManager } from '../appStateManager';
import type { WebViewActionHandler } from '../types';
import type { ArtemisWebsocketService } from '../../../services';
import type { ExerciseRegistry } from '../../../services';
import type { IProviderRegistry } from '../../../services/ProviderRegistry';
import type { WebviewToExtensionMessage, ExtensionToWebviewMessage } from '../../../shared/messageContracts';
import type { BuildErrorCodeLensProvider } from '../../../provider/buildErrorCodeLensProvider';

export type CommandHandler = (message: WebviewToExtensionMessage) => Promise<void>;
export type CommandMap = Record<string, CommandHandler>;

export interface CommandContext {
    authManager: AuthManager;
    artemisApi: ArtemisApiService;
    appStateManager: AppStateManager;
    actionHandler: WebViewActionHandler;
    sendMessage(message: ExtensionToWebviewMessage): void;
    updateAuthContext(isAuthenticated: boolean): Promise<void>;
    buildCodeLens?: BuildErrorCodeLensProvider;
    websocketService?: ArtemisWebsocketService;
    extensionContext: vscode.ExtensionContext;
    exerciseRegistry: ExerciseRegistry;
    providerRegistry: IProviderRegistry;
}
