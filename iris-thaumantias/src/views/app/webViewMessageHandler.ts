import * as vscode from 'vscode';
import { AuthManager } from '../../auth';
import { ArtemisApiService } from '../../api';
import { AppStateManager } from './appStateManager';
import type { WebViewActionHandler } from './types';
import type { CommandContext, CommandHandler } from './commands/types';
import { AuthCommandModule } from './commands/authCommands';
import { NavigationCommandModule } from './commands/navigationCommands';
import { RepositoryCommandModule } from './commands/repositoryCommands';
import { IrisCommandModule } from './commands/irisCommands';
import { PlantUmlCommandModule } from './commands/plantUmlCommands';
import { HealthCommandModule } from './commands/healthCommands';
import { UtilityCommandModule } from './commands/utilityCommands';

/**
 * Coordinates processing of messages received from the webview by delegating to command modules.
 */
export class WebViewMessageHandler {
    private _authContextUpdater?: (isAuthenticated: boolean) => Promise<void>;
    private _sendMessage: (message: any) => void = (message: any) => {
        console.log('Message to send to webview:', message);
    };
    private readonly commandHandlers: Map<string, CommandHandler> = new Map();
    private readonly repositoryModule: RepositoryCommandModule;

    constructor(
        private readonly authManager: AuthManager,
        private readonly artemisApi: ArtemisApiService,
        private readonly appStateManager: AppStateManager,
        private readonly actionHandler: WebViewActionHandler
    ) {
        const context: CommandContext = {
            authManager: this.authManager,
            artemisApi: this.artemisApi,
            appStateManager: this.appStateManager,
            actionHandler: this.actionHandler,
            sendMessage: (message: any) => this._sendMessage(message),
            updateAuthContext: (isAuthenticated: boolean) => this.updateAuthContext(isAuthenticated)
        };

        const modules = [
            new AuthCommandModule(context),
            new NavigationCommandModule(context),
            (this.repositoryModule = new RepositoryCommandModule(context)),
            new IrisCommandModule(context),
            new PlantUmlCommandModule(context),
            new HealthCommandModule(context),
            new UtilityCommandModule(context)
        ];

        modules.forEach(module => {
            const handlers = module.getHandlers();
            Object.entries(handlers).forEach(([command, handler]) => {
                if (this.commandHandlers.has(command)) {
                    console.warn(`Duplicate handler registered for command "${command}". Overwriting existing handler.`);
                }
                this.commandHandlers.set(command, handler);
            });
        });
    }

    /**
     * Process a message received from the webview, temporarily overriding the message sender.
     */
    public async handleMessageWithSender(message: any, sendResponse: (message: any) => void): Promise<void> {
        const originalSender = this._sendMessage;
        this._sendMessage = sendResponse;

        try {
            await this.handleMessage(message);
        } finally {
            this._sendMessage = originalSender;
        }
    }

    /**
     * Process a message received from the webview.
     */
    public async handleMessage(message: any): Promise<void> {
        try {
            const handler = this.commandHandlers.get(message.command);
            if (!handler) {
                console.warn('Unknown message command:', message.command);
                return;
            }

            await handler(message);
        } catch (error) {
            console.error('Error handling message:', error);
            vscode.window.showErrorMessage(`Error processing command: ${message.command}`);
        }
    }

    /**
     * Set the authentication context updater function.
     */
    public setAuthContextUpdater(updater: (isAuthenticated: boolean) => Promise<void>): void {
        this._authContextUpdater = updater;
    }

    /**
     * Set the method for sending messages to the webview.
     */
    public setMessageSender(sendMessage: (message: any) => void): void {
        this._sendMessage = sendMessage;
    }

    /**
     * Check if an exercise has a recently cloned repository.
     */
    public hasRecentlyClonedRepo(exerciseId: number): boolean {
        return this.repositoryModule.hasRecentlyClonedRepo(exerciseId);
    }

    private async updateAuthContext(isAuthenticated: boolean): Promise<void> {
        if (this._authContextUpdater) {
            await this._authContextUpdater(isAuthenticated);
        }
    }
}
