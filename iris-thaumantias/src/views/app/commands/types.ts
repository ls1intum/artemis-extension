import type { AuthManager } from '../../../auth';
import type { ArtemisApiService } from '../../../api';
import type { AppStateManager } from '../appStateManager';
import type { WebViewActionHandler } from '../types';

export type CommandHandler = (message: any) => Promise<void>;
export type CommandMap = Record<string, CommandHandler>;

export interface CommandContext {
    authManager: AuthManager;
    artemisApi: ArtemisApiService;
    appStateManager: AppStateManager;
    actionHandler: WebViewActionHandler;
    sendMessage(message: any): void;
    updateAuthContext(isAuthenticated: boolean): Promise<void>;
}
