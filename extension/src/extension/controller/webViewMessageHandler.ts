import * as vscode from 'vscode';

import type { ExtensionToWebviewMessage, WebviewToExtensionMessage } from '@shared/messageContracts';
import { getCommand } from '@shared/messageContracts';

import { ArtemisApiService } from '@extension/api';
import { AuthManager } from '@extension/services/auth';
import type { CourseAccessStorageService } from '@extension/services/courseAccessStorageService';
import type { CourseDataCache } from '@extension/services/courseDataCache';
import { ExerciseRegistry } from '@extension/services/exerciseRegistry';
import { LogCategory, logger } from '@extension/services/loggingService';
import type { ProactivePreferenceService } from '@extension/services/proactivePreferenceService';
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
import { ProactiveControlCommandModule } from './commands/proactiveControlCommands';
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
        private readonly appStateManager: AppStateManager,
        private readonly actionHandler: WebViewActionHandler,
        extensionContext: vscode.ExtensionContext,
        exerciseRegistry: ExerciseRegistry,
        providerRegistry: IProviderRegistry,
        websocketService?: ArtemisWebsocketService,
        courseDataCache?: CourseDataCache,
        courseAccessStorage?: CourseAccessStorageService,
        recordingHandlers: CommandMap = {},
        struggleLiveFeed?: { subscribe(sink: (msg: ExtensionToWebviewMessage) => void): void; unsubscribe(sink: (msg: ExtensionToWebviewMessage) => void): void; dropSink(sink: (msg: ExtensionToWebviewMessage) => void): void },
        proactivePreference?: ProactivePreferenceService,
        proactiveControl?: CommandContext['proactiveControl'],
    ) {
        this._websocketService = websocketService;
        const context: CommandContext = {
            authManager: this.authManager,
            artemisApi: this.artemisApi,
            appStateManager: this.appStateManager,
            actionHandler: this.actionHandler,
            sendMessage: (message: ExtensionToWebviewMessage) => this._sendMessage(message),
            getCurrentSender: () => this._sendMessage,
            updateAuthContext: (isAuthenticated: boolean) => this.updateAuthContext(isAuthenticated),
            getWebsocketService: () => this._websocketService,
            extensionContext,
            exerciseRegistry,
            providerRegistry,
            courseDataCache,
            courseAccessStorage,
            struggleLiveFeed,
            proactivePreference,
            proactiveControl,
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
            new ProactiveControlCommandModule(context),
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
     * The optional `isAlive` predicate is checked before the queued task runs; when the host
     * has been disposed between enqueue and execution the task is silently skipped.
     */
    public handleMessageWithSender(
        message: WebviewToExtensionMessage,
        sendResponse: (message: ExtensionToWebviewMessage) => void,
        isAlive?: () => boolean,
    ): Promise<void> {
        const task = this._senderQueue.then(async () => {
            if (isAlive && !isAlive()) { return; }
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
     * Return the sender function that is currently bound to this handler. Used
     * by command handlers to capture a stable per-host identity for feed
     * subscription (sidebar: the stable wrapper; fullscreen: the panel's postSafe).
     */
    public getCurrentSender(): (m: ExtensionToWebviewMessage) => void {
        return this._sendMessage;
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
        this.repositoryStatusModule.dispose();
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
