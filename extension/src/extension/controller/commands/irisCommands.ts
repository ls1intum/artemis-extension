import * as vscode from 'vscode';
import { logger, LogCategory } from '../../services/loggingService';
import type { CommandContext, CommandMap } from './types';
import { getPayload, WebviewCmd } from '../../../shared/messageContracts';
import type { WebviewToExtensionMessage, WebCmd } from '../../../shared/messageContracts';
import { extractErrorMessage } from '../../utils';

export class IrisCommandModule {
    constructor(private readonly context: CommandContext) { }

    public getHandlers(): CommandMap {
        return {
            [WebviewCmd.AskIrisAboutExercise]: this.handleAskIrisAboutExercise,
            [WebviewCmd.AskIrisAboutCourse]: this.handleAskIrisAboutCourse,
        };
    }

    private handleAskIrisAboutExercise = async (message: WebviewToExtensionMessage): Promise<void> => {
        try {
            const {
                exerciseId,
                exerciseTitle,
                exerciseShortName,
                releaseDate,
                dueDate,
                courseId
            } = getPayload<WebCmd<'askIrisAboutExercise'>>(message);

            logger.debug('Button clicked with data:', LogCategory.IRIS_CHAT, {
                exerciseId,
                exerciseTitle,
                exerciseShortName,
                releaseDate,
                dueDate,
                courseId
            });

            if (!exerciseId) {
                logger.error('ERROR: Missing exercise ID', LogCategory.IRIS_CHAT);
                vscode.window.showWarningMessage('Unable to open Iris chat: missing exercise information.');
                return;
            }

            logger.info('Focusing Iris chat view...', LogCategory.IRIS_CHAT);
            await vscode.commands.executeCommand('iris.chatView.focus');

            const chatProvider = this.context.providerRegistry.getChatWebviewProvider();
            const title = exerciseTitle || `Exercise ${exerciseId}`;

            logger.debug(`Chat provider available: ${!!chatProvider}`, LogCategory.IRIS_CHAT);
            logger.debug('Calling setExerciseContext with:', LogCategory.IRIS_CHAT, {
                exerciseId,
                title,
                reason: 'user-selected',
                shortName: exerciseShortName,
                releaseDate,
                dueDate,
                courseId
            });

            // Note: We don't call updateDetectedExercise here because it can trigger
            // autoSelectContext() which might select the wrong exercise based on priority.
            // The setExerciseContext call below will properly register and set the context.

            if (chatProvider && typeof chatProvider.setExerciseContext === 'function') {
                chatProvider.setExerciseContext(exerciseId, title, 'user-selected', exerciseShortName, releaseDate, dueDate, courseId);
                logger.info('setExerciseContext called successfully', LogCategory.IRIS_CHAT);
            } else {
                logger.warn('WARNING: Chat provider is unavailable or does not support exercise context selection', LogCategory.IRIS_CHAT);
            }
        } catch (error: unknown) {
            logger.error('Failed to open Iris chat for exercise:', LogCategory.IRIS_CHAT, error);
            vscode.window.showErrorMessage(`Failed to open Iris chat for exercise: ${extractErrorMessage(error)}`);
        }
    };

    private handleAskIrisAboutCourse = async (message: WebviewToExtensionMessage): Promise<void> => {
        try {
            const { courseId, courseTitle, courseShortName } = getPayload<WebCmd<'askIrisAboutCourse'>>(message);

            if (!courseId) {
                vscode.window.showWarningMessage('Unable to open Iris chat: missing course information.');
                return;
            }

            await vscode.commands.executeCommand('iris.chatView.focus');

            const chatProvider = this.context.providerRegistry.getChatWebviewProvider();
            if (chatProvider && typeof chatProvider.setCourseContext === 'function') {
                chatProvider.setCourseContext(courseId, courseTitle || `Course ${courseId}`, 'user-selected', courseShortName);
            } else {
                logger.warn('Iris chat provider is unavailable or does not support course context selection.', LogCategory.IRIS_CHAT);
            }
        } catch (error: unknown) {
            logger.error('Failed to open Iris chat for course:', LogCategory.IRIS_CHAT, error);
            vscode.window.showErrorMessage(`Failed to open Iris chat for course: ${extractErrorMessage(error)}`);
        }
    };
}
