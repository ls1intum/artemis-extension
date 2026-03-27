import * as vscode from 'vscode';
import { ArtemisApiService } from '../api';
import { AuthManager } from '../services/auth';
import { ArtemisWebsocketService } from '../services/websocket';
import { ExerciseRegistry } from '../services/exerciseRegistry';
import { logger, LogLevel, LogCategory } from '../services/loggingService';
import type { IProviderRegistry } from '../services/ui';
import { AppStateManager } from './appStateManager';
import type { WebViewActionHandler } from './types';
import type { CommandContext, CommandHandler } from './commands/types';
import { getCommand } from '../../shared/messageContracts';
import type { WebviewToExtensionMessage, ExtensionToWebviewMessage } from '../../shared/messageContracts';
import { AuthCommandModule } from './commands/authCommands';
import { NavigationCommandModule } from './commands/navigationCommands';
import { RepositoryCommandModule } from './commands/repositoryCommands';
import { IrisCommandModule } from './commands/irisCommands';
import { HealthCommandModule } from './commands/healthCommands';
import { UtilityCommandModule } from './commands/utilityCommands';

/**
 * Coordinates processing of messages received from the webview by delegating to command modules.
 */
export class WebViewMessageHandler {
    private _authContextUpdater?: (isAuthenticated: boolean) => Promise<void>;
    private _sendMessage: (message: ExtensionToWebviewMessage) => void = (message: ExtensionToWebviewMessage) => {
        logger.debug('Message to send to webview:', LogCategory.VIEW, message);
    };
    private readonly commandHandlers: Map<string, CommandHandler> = new Map();
    private readonly repositoryModule: RepositoryCommandModule;
    private _websocketService?: ArtemisWebsocketService;
    private _senderQueue: Promise<void> = Promise.resolve();

    constructor(
        private readonly authManager: AuthManager,
        private readonly artemisApi: ArtemisApiService,
        private readonly appStateManager: AppStateManager,
        private readonly actionHandler: WebViewActionHandler,
        extensionContext: vscode.ExtensionContext,
        exerciseRegistry: ExerciseRegistry,
        providerRegistry: IProviderRegistry,
        websocketService?: ArtemisWebsocketService,
    ) {
        this._websocketService = websocketService;
        const context: CommandContext = {
            authManager: this.authManager,
            artemisApi: this.artemisApi,
            appStateManager: this.appStateManager,
            actionHandler: this.actionHandler,
            sendMessage: (message: ExtensionToWebviewMessage) => this._sendMessage(message),
            updateAuthContext: (isAuthenticated: boolean) => this.updateAuthContext(isAuthenticated),
            getWebsocketService: () => this._websocketService,
            extensionContext,
            exerciseRegistry,
            providerRegistry,
        };

        const modules = [
            new AuthCommandModule(context),
            new NavigationCommandModule(context),
            (this.repositoryModule = new RepositoryCommandModule(context)),
            new IrisCommandModule(context),
            new HealthCommandModule(context),
            new UtilityCommandModule(context)
        ];

        modules.forEach(module => {
            const handlers = module.getHandlers();
            Object.entries(handlers).forEach(([command, handler]) => {
                if (this.commandHandlers.has(command)) {
                    logger.warn(`Duplicate handler registered for command "${command}". Overwriting existing handler.`, LogCategory.VIEW);
                }
                this.commandHandlers.set(command, handler);
            });
        });
    }

    /**
     * Process a message received from the webview, temporarily overriding the message sender.
     * Serialized via promise queue to prevent concurrent calls from corrupting the sender.
     */
    public handleMessageWithSender(message: WebviewToExtensionMessage, sendResponse: (message: ExtensionToWebviewMessage) => void): Promise<void> {
        const task = this._senderQueue.then(async () => {
            const originalSender = this._sendMessage;
            this._sendMessage = sendResponse;
            try {
                await this.handleMessage(message);
            } finally {
                this._sendMessage = originalSender;
            }
        });
        this._senderQueue = task.catch(() => { /* keep chain alive */ });
        return task;
    }

    /**
     * Process a message received from the webview.
     */
    public async handleMessage(message: WebviewToExtensionMessage): Promise<void> {
        const command = getCommand(message);
        try {
            const handler = this.commandHandlers.get(command);
            if (!handler) {
                logger.warn(`Unknown message command: ${command}`, LogCategory.VIEW);
                return;
            }

            await handler(message);
        } catch (error) {
            logger.error('Error handling message:', LogCategory.VIEW, error);
            vscode.window.showErrorMessage(`Error processing command: ${command}`);
        }
    }

    /**
     * Dispose the handler and its command modules.
     */
    public dispose(): void {
        this.repositoryModule.dispose();
    }

    /**
     * Set the authentication context updater function.
     */
    public setAuthContextUpdater(updater: (isAuthenticated: boolean) => Promise<void>): void {
        this._authContextUpdater = updater;
    }

    /**
     * Set the WebSocket service for real-time updates.
     */
    public setWebsocketService(websocketService: ArtemisWebsocketService): void {
        this._websocketService = websocketService;
    }

    /**
     * Set the method for sending messages to the webview.
     */
    public setMessageSender(sendMessage: (message: ExtensionToWebviewMessage) => void): void {
        this._sendMessage = sendMessage;
    }

    /**
     * Check if an exercise has a recently cloned repository.
     */
    public hasRecentlyClonedRepo(exerciseId: number): boolean {
        return this.repositoryModule.hasRecentlyClonedRepo(exerciseId);
    }

    /**
     * Set the repository context so workspace file-save listeners
     * can automatically detect changes without a manual check.
     */
    public setRepositoryContext(repoUrl: string, exerciseId: number): void {
        this.repositoryModule.setRepositoryContext(repoUrl, exerciseId);
    }

    public clearRepositoryContext(): void {
        this.repositoryModule.clearRepositoryContext();
    }

    private async updateAuthContext(isAuthenticated: boolean): Promise<void> {
        if (this._authContextUpdater) {
            await this._authContextUpdater(isAuthenticated);
        }
    }
}
