import * as vscode from 'vscode';
import { ProviderRegistry } from '../../../services/ProviderRegistry';
import { logger, LogCategory } from '../../../services/loggingService';
import type { CommandContext, CommandMap } from './types';
import { getPayload } from '../../../shared/messageContracts';
import type { WebviewToExtensionMessage, AskIrisAboutExerciseCommand, AskIrisAboutCourseCommand } from '../../../shared/messageContracts';

export class IrisCommandModule {
    constructor(private readonly context: CommandContext) { }

    public getHandlers(): CommandMap {
        return {
            askIrisAboutExercise: this.handleAskIrisAboutExercise,
            askIrisAboutCourse: this.handleAskIrisAboutCourse,
        };
    }

    private handleAskIrisAboutExercise = async (message: WebviewToExtensionMessage): Promise<void> => {
        const {
            exerciseId,
            exerciseTitle,
            exerciseShortName,
            releaseDate,
            dueDate,
            courseId
        } = getPayload<AskIrisAboutExerciseCommand>(message);

        logger.debug('Button clicked with data:', LogCategory.IRIS_CHAT, {
            exerciseId,
            exerciseTitle,
            exerciseShortName,
            releaseDate,
            dueDate,
            courseId
        });

        if (!exerciseId) {
            logger.irisChatError('ERROR: Missing exercise ID');
            vscode.window.showWarningMessage('Unable to open Iris chat: missing exercise information.');
            return;
        }

        logger.irisChat('Focusing Iris chat view...');
        await vscode.commands.executeCommand('iris.chatView.focus');

        const chatProvider = ProviderRegistry.getInstance().getChatWebviewProvider();
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
            logger.irisChat('setExerciseContext called successfully');
        } else {
            logger.irisChatWarn('WARNING: Chat provider is unavailable or does not support exercise context selection');
        }
    };

    private handleAskIrisAboutCourse = async (message: WebviewToExtensionMessage): Promise<void> => {
        const { courseId, courseTitle, courseShortName } = getPayload<AskIrisAboutCourseCommand>(message);

        if (!courseId) {
            vscode.window.showWarningMessage('Unable to open Iris chat: missing course information.');
            return;
        }

        await vscode.commands.executeCommand('iris.chatView.focus');

        const chatProvider = ProviderRegistry.getInstance().getChatWebviewProvider();
        if (chatProvider && typeof chatProvider.setCourseContext === 'function') {
            chatProvider.setCourseContext(courseId, courseTitle || `Course ${courseId}`, 'user-selected', courseShortName);
        } else {
            logger.irisChatWarn('Iris chat provider is unavailable or does not support course context selection.');
        }
    };
}
