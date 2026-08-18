import * as vscode from 'vscode';

import type { ExtensionToWebviewMessage, WebviewToExtensionMessage } from '@shared/messageContracts';
import { getCommand } from '@shared/messageContracts';

import { ArtemisApiService } from '@extension/api';
import { AuthManager, OidcLoginService } from '@extension/services/auth';
import type { CourseAccessStorageService } from '@extension/services/courseAccessStorageService';
import type { CourseCatalog } from '@extension/services/courseCatalog';
import { LogCategory, logger } from '@extension/services/loggingService';
import type { IProviderRegistry } from '@extension/services/ui';
import { ArtemisWebsocketService } from '@extension/services/websocket';

import { AppStateManager } from './appStateManager';
import { AuthCommandModule } from './commands/authCommands';
import { BuildLogCommands } from './commands/buildLogCommands';
import { ExerciseLifecycleCommands } from './commands/exerciseLifecycleCommands';
import { HealthCommandModule } from './commands/healthCommands';
import { IrisCommandModule } from './commands/irisCommands';
import { mergeRecordingHandlers } from './commands/mergeCommandHandlers';
import { NavigationCommandModule } from './commands/navigationCommands';
import { ProblemStatementTrackingCommandModule } from './commands/problemStatementTrackingCommands';
import { RepositoryCloneCommands } from './commands/repositoryCloneCommands';
import { RepositoryStatusCommands } from './commands/repositoryStatusCommands';
import { RepositorySubmitCommands } from './commands/repositorySubmitCommands';
import { TestResultsTrackingCommandModule } from './commands/testResultsTrackingCommands';
import type { CommandContext, CommandHandler, CommandMap } from './commands/types';
import { UtilityCommandModule } from './commands/utilityCommands';
import type { WebViewActionHandler } from './types';

/**
 * Coordinates processing of messages received from the webview by delegating to command modules.
 */
export class WebViewMessageHandler {
    private _authContextUpdater?: (isAuthenticated: boolean) => Promise<void>;
    private _sendMessage: (message: ExtensionToWebviewMessage) => void = (message: ExtensionToWebviewMessage) => {
        logger.debug('Message to send to webview:', LogCategory.VIEW, message);
    };
    private readonly commandHandlers: Map<string, CommandHandler> = new Map();
    private readonly repositoryStatusModule: RepositoryStatusCommands;
    private _websocketService?: ArtemisWebsocketService;
    private _senderQueue: Promise<void> = Promise.resolve();

    constructor(
        private readonly authManager: AuthManager,
        private readonly artemisApi: ArtemisApiService,
        private readonly oidcLoginService: OidcLoginService,
        private readonly appStateManager: AppStateManager,
        private readonly actionHandler: WebViewActionHandler,
        extensionContext: vscode.ExtensionContext,
        providerRegistry: IProviderRegistry,
        websocketService?: ArtemisWebsocketService,
        courseCatalog?: CourseCatalog,
        courseAccessStorage?: CourseAccessStorageService,
        recordingHandlers: CommandMap = {},
    ) {
        this._websocketService = websocketService;
        const context: CommandContext = {
            authManager: this.authManager,
            artemisApi: this.artemisApi,
            oidcLoginService: this.oidcLoginService,
            appStateManager: this.appStateManager,
            actionHandler: this.actionHandler,
            sendMessage: (message: ExtensionToWebviewMessage) => this._sendMessage(message),
            updateAuthContext: (isAuthenticated: boolean) => this.updateAuthContext(isAuthenticated),
            getWebsocketService: () => this._websocketService,
            extensionContext,
            providerRegistry,
            courseCatalog,
            courseAccessStorage,
            sessionEpoch: () => courseCatalog?.currentEpoch ?? 0,
        };

        this.repositoryStatusModule = new RepositoryStatusCommands(context);
        context.recheckRepoStatus = () => this.repositoryStatusModule.recheckCurrentRepoStatus();

        const modules = [
            new AuthCommandModule(context),
            new NavigationCommandModule(context),
            this.repositoryStatusModule,
            new RepositoryCloneCommands(context),
            new RepositorySubmitCommands(context),
            new IrisCommandModule(context),
            new HealthCommandModule(context),
            new UtilityCommandModule(context),
            new TestResultsTrackingCommandModule(context),
            new ProblemStatementTrackingCommandModule(context),
            new BuildLogCommands(context),
            new ExerciseLifecycleCommands(context),
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

        mergeRecordingHandlers(this.commandHandlers, recordingHandlers);
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

    public dispose(): void {
        this.repositoryStatusModule.dispose();
    }

    public setAuthContextUpdater(updater: (isAuthenticated: boolean) => Promise<void>): void {
        this._authContextUpdater = updater;
    }

    public setMessageSender(sendMessage: (message: ExtensionToWebviewMessage) => void): void {
        this._sendMessage = sendMessage;
    }

    /**
     * Set the repository context so workspace file-save listeners
     * can automatically detect changes without a manual check.
     */
    public setRepositoryContext(repoUrl: string, exerciseId: number): void {
        this.repositoryStatusModule.setRepositoryContext(repoUrl, exerciseId);
    }

    public clearRepositoryContext(): void {
        this.repositoryStatusModule.clearRepositoryContext();
    }

    private async updateAuthContext(isAuthenticated: boolean): Promise<void> {
        if (this._authContextUpdater) {
            await this._authContextUpdater(isAuthenticated);
        }
    }
}
