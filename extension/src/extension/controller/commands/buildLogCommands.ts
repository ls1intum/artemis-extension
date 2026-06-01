import * as vscode from 'vscode';

import type { WebCmd, WebviewToExtensionMessage } from '@shared/messageContracts';
import { getPayload, WebviewCmd } from '@shared/messageContracts';

import { LogCategory, logger } from '@extension/services/loggingService';
import { BuildLogParser } from '@extension/utils';

import type { CommandContext, CommandMap } from './types';

export class BuildLogCommands {
    constructor(private readonly context: CommandContext) { }

    public getHandlers(): CommandMap {
        return {
            [WebviewCmd.ViewBuildLog]: this.handleViewBuildLog,
            [WebviewCmd.GoToSource]: this.handleGoToSource,
        };
    }

    private handleViewBuildLog = async (message: WebviewToExtensionMessage): Promise<void> => {
        try {
            const { participationId, resultId } = getPayload<WebCmd<'viewBuildLog'>>(message);
            const logs = await this.context.artemisApi.getBuildLogs(participationId, resultId);
            const logText = logs.map(entry => `[${entry.time}] ${entry.log}`).join('\n');
            const doc = await vscode.workspace.openTextDocument({ content: logText, language: 'log' });
            await vscode.window.showTextDocument(doc);
        } catch (error: unknown) {
            logger.error('Failed to fetch build logs:', LogCategory.SUBMISSION, error);
            vscode.window.showErrorMessage('Failed to fetch build logs.');
        }
    };

    private handleGoToSource = async (message: WebviewToExtensionMessage): Promise<void> => {
        try {
            const { participationId, resultId } = getPayload<WebCmd<'goToSource'>>(message);
            const logs = await this.context.artemisApi.getBuildLogs(participationId, resultId);
            const error = BuildLogParser.parseFirstError(logs);
            if (error) {
                await vscode.commands.executeCommand('artemis.goToSourceError', error.filePath, error.line, error.column, error.message);
            } else {
                vscode.window.showInformationMessage('No source error location found in build logs');
            }
        } catch (err: unknown) {
            logger.error('Failed to navigate to source error:', LogCategory.SUBMISSION, err);
            vscode.window.showErrorMessage('Failed to navigate to source error.');
        }
    };
}
