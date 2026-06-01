import * as vscode from 'vscode';

import type { WebCmd, WebviewToExtensionMessage } from '@shared/messageContracts';
import { getPayload, WebviewCmd } from '@shared/messageContracts';

import { LogCategory, logger } from '@extension/services/loggingService';
import { extractErrorMessage } from '@extension/utils';

import type { CommandContext, CommandMap } from './types';

export class ExerciseLifecycleCommands {
    constructor(private readonly context: CommandContext) { }

    public getHandlers(): CommandMap {
        return {
            [WebviewCmd.StartPractice]: this.handleStartPractice,
            [WebviewCmd.StartExercise]: this.handleStartExercise,
        };
    }

    private handleStartPractice = async (message: WebviewToExtensionMessage): Promise<void> => {
        try {
            const payload = getPayload<WebCmd<'startPractice'>>(message);
            const exerciseId = payload.exerciseId;
            const exerciseTitle = payload.exerciseTitle ?? 'Exercise';
            vscode.window.showInformationMessage('Starting practice mode...');
            const participation = await this.context.artemisApi.startPracticeParticipation(exerciseId);

            if (participation) {
                vscode.window.showInformationMessage(
                    `Successfully started practice mode for "${exerciseTitle}". You can now clone the practice repository.`
                );
                await this.context.actionHandler.openExerciseDetails(exerciseId);
            }
        } catch (error: unknown) {
            logger.error('Failed to start practice participation:', LogCategory.SUBMISSION, error);
            vscode.window.showErrorMessage(
                `Failed to start practice mode: ${extractErrorMessage(error)}`
            );
        }
    };

    private handleStartExercise = async (message: WebviewToExtensionMessage): Promise<void> => {
        try {
            const payload = getPayload<WebCmd<'startExercise'>>(message);
            const exerciseId = payload.exerciseId;
            vscode.window.showInformationMessage('Starting exercise...');
            const participation = await this.context.artemisApi.startExerciseParticipation(exerciseId);

            if (participation) {
                vscode.window.showInformationMessage('Successfully started exercise participation.');
                await this.context.actionHandler.openExerciseDetails(exerciseId);
            }
        } catch (error: unknown) {
            logger.error('Failed to start exercise:', LogCategory.SUBMISSION, error);
            vscode.window.showErrorMessage(
                `Failed to start exercise: ${extractErrorMessage(error)}`
            );
        }
    };
}
