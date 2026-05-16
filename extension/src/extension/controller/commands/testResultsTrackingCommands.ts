import type { WebCmd, WebviewToExtensionMessage } from '@shared/messageContracts';
import { getPayload, WebviewCmd } from '@shared/messageContracts';

import { LogCategory, logger } from '@extension/services/loggingService';

import type { CommandContext, CommandMap } from './types';

export class TestResultsTrackingCommandModule {
    constructor(private readonly context: CommandContext) { }

    public getHandlers(): CommandMap {
        return {
            [WebviewCmd.TestResultsOverviewOpened]: this.handleTestResultsOverviewOpened,
            [WebviewCmd.TestResultsOverviewClosed]: this.handleTestResultsOverviewClosed,
            [WebviewCmd.TaskFeedbackOpened]: this.handleTaskFeedbackOpened,
            [WebviewCmd.TaskFeedbackClosed]: this.handleTaskFeedbackClosed,
        };
    }

    private handleTestResultsOverviewOpened = async (message: WebviewToExtensionMessage): Promise<void> => {
        try {
            const payload = getPayload<WebCmd<'testResultsOverviewOpened'>>(message);
            this.context.providerRegistry.getArtemisWebviewProvider()?.fireTestResultsOverviewOpened(payload);
        } catch (error: unknown) {
            logger.warn('Failed to handle testResultsOverviewOpened command', LogCategory.VIEW, error);
        }
    };

    private handleTestResultsOverviewClosed = async (message: WebviewToExtensionMessage): Promise<void> => {
        try {
            const payload = getPayload<WebCmd<'testResultsOverviewClosed'>>(message);
            this.context.providerRegistry.getArtemisWebviewProvider()?.fireTestResultsOverviewClosed(payload);
        } catch (error: unknown) {
            logger.warn('Failed to handle testResultsOverviewClosed command', LogCategory.VIEW, error);
        }
    };

    private handleTaskFeedbackOpened = async (message: WebviewToExtensionMessage): Promise<void> => {
        try {
            const payload = getPayload<WebCmd<'taskFeedbackOpened'>>(message);
            this.context.providerRegistry.getArtemisWebviewProvider()?.fireTaskFeedbackOpened(payload);
        } catch (error: unknown) {
            logger.warn('Failed to handle taskFeedbackOpened command', LogCategory.VIEW, error);
        }
    };

    private handleTaskFeedbackClosed = async (message: WebviewToExtensionMessage): Promise<void> => {
        try {
            const payload = getPayload<WebCmd<'taskFeedbackClosed'>>(message);
            this.context.providerRegistry.getArtemisWebviewProvider()?.fireTaskFeedbackClosed(payload);
        } catch (error: unknown) {
            logger.warn('Failed to handle taskFeedbackClosed command', LogCategory.VIEW, error);
        }
    };
}
