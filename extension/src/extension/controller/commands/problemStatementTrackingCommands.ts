import type { WebCmd, WebviewToExtensionMessage } from '@shared/messageContracts';
import { getPayload, WebviewCmd } from '@shared/messageContracts';

import { LogCategory, logger } from '@extension/services/loggingService';

import type { CommandContext, CommandMap } from './types';

export class ProblemStatementTrackingCommandModule {
    constructor(private readonly context: CommandContext) { }

    public getHandlers(): CommandMap {
        return {
            [WebviewCmd.ProblemStatementScroll]: this.handleProblemStatementScroll,
            [WebviewCmd.ProblemStatementSelection]: this.handleProblemStatementSelection,
        };
    }

    private handleProblemStatementScroll = async (message: WebviewToExtensionMessage): Promise<void> => {
        try {
            const payload = getPayload<WebCmd<'problemStatementScroll'>>(message);
            this.context.providerRegistry.getArtemisWebviewProvider()?.fireProblemStatementScroll(payload);
        } catch (error: unknown) {
            logger.warn('Failed to handle problemStatementScroll command', LogCategory.VIEW, error);
        }
    };

    private handleProblemStatementSelection = async (message: WebviewToExtensionMessage): Promise<void> => {
        try {
            const payload = getPayload<WebCmd<'problemStatementSelection'>>(message);
            this.context.providerRegistry.getArtemisWebviewProvider()?.fireProblemStatementSelection(payload);
        } catch (error: unknown) {
            logger.warn('Failed to handle problemStatementSelection command', LogCategory.VIEW, error);
        }
    };
}
