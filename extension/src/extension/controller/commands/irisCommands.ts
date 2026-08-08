import * as vscode from 'vscode';

import type { WebCmd, WebviewToExtensionMessage } from '@shared/messageContracts';
import { getPayload, WebviewCmd } from '@shared/messageContracts';

import type { TopicChangeOutcome } from '@extension/services/iris/conversation/conversationService';
import { LogCategory, logger } from '@extension/services/loggingService';
import { extractErrorMessage } from '@extension/utils';

import type { CommandContext, CommandMap } from './types';

/**
 * What the student is told after an Ask-Iris click. Every successful outcome
 * says the same thing, because a topic change stays in the open conversation:
 * `opened` survives only for the cold start, where the click acquired the FIRST
 * conversation and there was nothing on screen to replace. Returns `undefined`
 * when there is nothing worth saying.
 */
export function askIrisOutcomeMessage(outcome: TopicChangeOutcome, title: string): string | undefined {
    switch (outcome.kind) {
        case 'staged':
        case 'noop':
        case 'unstaged':
        case 'opened':
            return `Iris is now looking at ${title}.`;
        // The chat already carries the persistent "Iris is off in this course"
        // banner, and the move itself succeeded. A notification on top would be
        // a second, retry-shaped answer to something no retry can change.
        case 'course-disabled':
            return undefined;
        case 'stale':
            return undefined;
        case 'rejected':
            switch (outcome.reason) {
                case 'loading':
                    return 'Iris is still loading. Try again in a moment.';
                case 'send-in-flight':
                    return 'Iris is answering right now. Please wait.';
                case 'cross-course':
                    return 'That topic belongs to another course.';
                case 'no-course':
                case 'failed':
                    return 'Iris could not switch to that topic. Please try again.';
            }
    }
}

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
                courseId
            } = getPayload<WebCmd<'askIrisAboutExercise'>>(message);

            logger.debug('Button clicked with data:', LogCategory.IRIS_CHAT, {
                exerciseId,
                exerciseTitle,
                courseId
            });

            if (!exerciseId) {
                logger.error('ERROR: Missing exercise ID', LogCategory.IRIS_CHAT);
                vscode.window.showWarningMessage('Unable to open Iris chat: missing exercise information.');
                return;
            }

            const chatProvider = this.context.providerRegistry.getChatWebviewProvider();
            const title = exerciseTitle || `Exercise ${exerciseId}`;

            // Note: We deliberately do not register this exercise as detected
            // here, since doing so could trigger autoSelectContext() and
            // select the wrong exercise based on priority.

            if (!chatProvider || typeof chatProvider.askIrisAbout !== 'function') {
                logger.warn('WARNING: Chat provider is unavailable or does not support topic selection', LogCategory.IRIS_CHAT);
                return;
            }
            // Before the focus, not after: focusing resolves the webview, and a
            // resolved view is what lets the startup coordinator acquire the
            // workspace conversation. Announcing our destination afterwards
            // would be too late.
            chatProvider.admitExplicitIntent('askIrisAbout');

            logger.info('Focusing Iris chat view...', LogCategory.IRIS_CHAT);
            await vscode.commands.executeCommand('iris.chatView.focus');

            // The payload's courseId travels WITH the target: on a fresh window
            // no conversation is open, so the service has no course of its own
            // and would answer `no-course` if this were dropped here.
            const outcome = await chatProvider.askIrisAbout(
                { mode: 'PROGRAMMING_EXERCISE_CHAT', entityId: exerciseId, name: title },
                courseId,
            );
            const notice = askIrisOutcomeMessage(outcome, title);
            if (notice) {
                vscode.window.showInformationMessage(notice);
            }
        } catch (error: unknown) {
            logger.error('Failed to open Iris chat for exercise:', LogCategory.IRIS_CHAT, error);
            vscode.window.showErrorMessage(`Failed to open Iris chat for exercise: ${extractErrorMessage(error)}`);
        }
    };

    private handleAskIrisAboutCourse = async (message: WebviewToExtensionMessage): Promise<void> => {
        try {
            const { courseId, courseTitle } = getPayload<WebCmd<'askIrisAboutCourse'>>(message);

            if (!courseId) {
                vscode.window.showWarningMessage('Unable to open Iris chat: missing course information.');
                return;
            }

            const chatProvider = this.context.providerRegistry.getChatWebviewProvider();
            if (!chatProvider || typeof chatProvider.askIrisAbout !== 'function') {
                logger.warn('Iris chat provider is unavailable or does not support topic selection.', LogCategory.IRIS_CHAT);
                return;
            }
            // Before the focus, not after: focusing resolves the webview, and a
            // resolved view is what lets the startup coordinator acquire the
            // workspace conversation. Announcing our destination afterwards
            // would be too late.
            chatProvider.admitExplicitIntent('askIrisAbout');

            await vscode.commands.executeCommand('iris.chatView.focus');

            const title = courseTitle || `Course ${courseId}`;
            // A course chat IS the course, so the hint is the entity itself.
            const outcome = await chatProvider.askIrisAbout(
                { mode: 'COURSE_CHAT', entityId: courseId, name: title },
                courseId,
            );
            const notice = askIrisOutcomeMessage(outcome, title);
            if (notice) {
                vscode.window.showInformationMessage(notice);
            }
        } catch (error: unknown) {
            logger.error('Failed to open Iris chat for course:', LogCategory.IRIS_CHAT, error);
            vscode.window.showErrorMessage(`Failed to open Iris chat for course: ${extractErrorMessage(error)}`);
        }
    };
}
