import * as vscode from 'vscode';
import type { CommandContext, CommandMap } from './types';

export class IrisCommandModule {
    constructor(private readonly context: CommandContext) {}

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

        if (!exerciseId) {
            vscode.window.showWarningMessage('Unable to open Iris chat: missing exercise information.');
            return;
        }

        await vscode.commands.executeCommand('iris.chatView.focus');

        const chatProvider = (global as any).chatWebviewProvider;
        const title = exerciseTitle || `Exercise ${exerciseId}`;

        if (chatProvider && typeof chatProvider.updateDetectedExercise === 'function') {
            chatProvider.updateDetectedExercise(title, exerciseId, releaseDate, dueDate, exerciseShortName);
        }

        if (chatProvider && typeof chatProvider.setExerciseContext === 'function') {
            chatProvider.setExerciseContext(exerciseId, title, 'user-selected', exerciseShortName);
        } else {
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

        const chatProvider = (global as any).chatWebviewProvider;
        if (chatProvider && typeof chatProvider.setCourseContext === 'function') {
            chatProvider.setCourseContext(courseId, courseTitle || `Course ${courseId}`, 'user-selected', courseShortName);
        } else {
            console.warn('Iris chat provider is unavailable or does not support course context selection.');
        }
    };
}
