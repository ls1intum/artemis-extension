import * as vscode from 'vscode';
import { ProviderRegistry } from '../../../services/ProviderRegistry';
import type { CommandContext, CommandMap } from './types';

export class IrisCommandModule {
    constructor(private readonly context: CommandContext) { }

    public getHandlers(): CommandMap {
        return {
            askIrisAboutExercise: this.handleAskIrisAboutExercise,
            askIrisAboutCourse: this.handleAskIrisAboutCourse,
        };
    }

    private handleAskIrisAboutExercise = async (message: any): Promise<void> => {
        const exerciseId: number = message.exerciseId;
        const exerciseTitle: string | undefined = message.exerciseTitle;
        const exerciseShortName: string | undefined = message.exerciseShortName;
        const releaseDate: string | undefined = message.releaseDate;
        const dueDate: string | undefined = message.dueDate;
        const courseId: number | undefined = message.courseId;

        console.log('🎯 [ASK IRIS] Button clicked with data:', {
            exerciseId,
            exerciseTitle,
            exerciseShortName,
            releaseDate,
            dueDate,
            courseId
        });

        if (!exerciseId) {
            console.error('🎯 [ASK IRIS] ERROR: Missing exercise ID');
            vscode.window.showWarningMessage('Unable to open Iris chat: missing exercise information.');
            return;
        }

        console.log('🎯 [ASK IRIS] Focusing Iris chat view...');
        await vscode.commands.executeCommand('iris.chatView.focus');

        const chatProvider = ProviderRegistry.getInstance().getChatWebviewProvider();
        const title = exerciseTitle || `Exercise ${exerciseId}`;

        console.log('🎯 [ASK IRIS] Chat provider available:', !!chatProvider);
        console.log('🎯 [ASK IRIS] Calling setExerciseContext with:', {
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
            console.log('🎯 [ASK IRIS] setExerciseContext called successfully');
        } else {
            console.warn('🎯 [ASK IRIS] WARNING: Chat provider is unavailable or does not support exercise context selection');
            console.warn('Iris chat provider is unavailable or does not support exercise context selection.');
        }
    };

    private handleAskIrisAboutCourse = async (message: any): Promise<void> => {
        const courseId: number = message.courseId;
        const courseTitle: string | undefined = message.courseTitle;
        const courseShortName: string | undefined = message.courseShortName;

        if (!courseId) {
            vscode.window.showWarningMessage('Unable to open Iris chat: missing course information.');
            return;
        }

        await vscode.commands.executeCommand('iris.chatView.focus');

        const chatProvider = ProviderRegistry.getInstance().getChatWebviewProvider();
        if (chatProvider && typeof chatProvider.setCourseContext === 'function') {
            chatProvider.setCourseContext(courseId, courseTitle || `Course ${courseId}`, 'user-selected', courseShortName);
        } else {
            console.warn('Iris chat provider is unavailable or does not support course context selection.');
        }
    };
}
