import * as vscode from 'vscode';
import { ExtensionMsg, WebviewMsgType } from '../../shared/messageContracts';
import type { ExtensionToWebviewMessage, CourseDetailData as CourseDetailPayload } from '../../shared/messageContracts';
import type { CourseData, ArchivedCourse } from '../../shared/messageContracts/domainTypes';
import { detectWorkspaceForRepoUris } from '../workspace/workspaceDetectionService';
import type { ExerciseDetailsResponse } from '../../types/apiResponses';
import { isWebviewMessage } from '../../shared/messageContracts/typeGuards';
import { getReactWebviewHtml } from '../../utils/webviewHelpers';
import type { WebViewMessageHandler } from '../../views/app/webViewMessageHandler';
import { logger, LogCategory } from '../loggingService';

export class FullscreenPanelManager {
    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly _extensionContext: vscode.ExtensionContext,
        private readonly _getMessageHandler: () => WebViewMessageHandler,
    ) {}

    public openExerciseFullscreen(exerciseData: ExerciseDetailsResponse): void {
        const exerciseTitle = exerciseData?.exercise?.title || 'Exercise';
        this._openFullscreenPanel({
            viewType: 'artemis.exerciseFullscreen',
            title: `Exercise: ${exerciseTitle}`,
            viewName: 'exerciseDetail',
            onReady: (postSafe) => {
                const repoUris = (exerciseData.exercise?.studentParticipations ?? [])
                    .map(p => p.repositoryUri)
                    .filter((uri): uri is string => !!uri);

                if (repoUris.length > 0) {
                    detectWorkspaceForRepoUris(repoUris).then((repoStatus) => {
                        postSafe({
                            type: ExtensionMsg.ExerciseDetailInit,
                            exerciseData,
                            hideDeveloperTools: false,
                            repoStatus,
                        });
                    }).catch(() => {
                        postSafe({
                            type: ExtensionMsg.ExerciseDetailInit,
                            exerciseData,
                            hideDeveloperTools: false,
                        });
                    });
                } else {
                    postSafe({
                        type: ExtensionMsg.ExerciseDetailInit,
                        exerciseData,
                        hideDeveloperTools: false,
                    });
                }
            },
            onTitleUpdate: (title) => `Exercise: ${title}`,
        });
    }

    public openCourseListFullscreen(courses: CourseData[], archivedCourses?: ArchivedCourse[]): void {
        this._openFullscreenPanel({
            viewType: 'artemis.courseListFullscreen',
            title: 'All Courses',
            viewName: 'courseList',
            onReady: (postSafe) => {
                postSafe({
                    type: ExtensionMsg.CourseListInit,
                    courses,
                    archivedCourses,
                });
            },
        });
    }

    public openCourseFullscreen(courseData: CourseDetailPayload): void {
        const courseTitle = courseData?.course?.title || 'Course';
        this._openFullscreenPanel({
            viewType: 'artemis.courseFullscreen',
            title: `Course: ${courseTitle}`,
            viewName: 'courseDetail',
            onReady: (postSafe) => {
                const config = vscode.workspace.getConfiguration('artemis');
                const developerMode = config.get<boolean>('developerMode', false);
                postSafe({
                    type: ExtensionMsg.CourseDetailInit,
                    courseData: courseData,
                    workspaceExerciseId: null,
                    hideDeveloperTools: !developerMode,
                });
            },
            onTitleUpdate: (title) => `Course: ${title}`,
        });
    }

    private _openFullscreenPanel(options: {
        viewType: string;
        title: string;
        viewName: string;
        onReady: (postSafe: (msg: ExtensionToWebviewMessage) => void) => void;
        onTitleUpdate?: (title: string) => string;
    }): void {
        const panel = vscode.window.createWebviewPanel(
            options.viewType,
            options.title,
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [
                    vscode.Uri.joinPath(this._extensionUri, 'dist'),
                    vscode.Uri.joinPath(this._extensionUri, 'media'),
                ]
            }
        );

        panel.webview.html = getReactWebviewHtml(panel.webview, this._extensionUri, options.viewName);

        let disposed = false;
        let panelReady = false;
        let pendingMessages: ExtensionToWebviewMessage[] = [];

        const postSafe = (msg: ExtensionToWebviewMessage): void => {
            if (panelReady && !disposed) {
                panel.webview.postMessage(msg);
            } else if (!disposed) {
                pendingMessages.push(msg);
            }
        };

        const messageListener = panel.webview.onDidReceiveMessage(async (message: unknown) => {
            if (disposed) { return; }
            if (!isWebviewMessage(message)) { return; }

            if (message.type === WebviewMsgType.Error) {
                const errorPayload = (message as { payload?: { message?: string; stack?: string; componentStack?: string } }).payload;
                logger.error('Fullscreen panel ErrorBoundary crash report', LogCategory.VIEW, {
                    message: errorPayload?.message,
                    stack: errorPayload?.stack,
                    componentStack: errorPayload?.componentStack,
                });
                return;
            }

            if (message.type === WebviewMsgType.Ready) {
                panelReady = true;
                const pending = pendingMessages;
                pendingMessages = [];
                for (const msg of pending) {
                    if (!disposed) { panel.webview.postMessage(msg); }
                }
                options.onReady(postSafe);
                return;
            }

            if (message.type === WebviewMsgType.RequestInit) {
                options.onReady(postSafe);
                return;
            }

            if (message.type === WebviewMsgType.UpdatePanelTitle) {
                if (options.onTitleUpdate) {
                    panel.title = options.onTitleUpdate(message.title);
                }
                return;
            }

            if (message.type === 'command') {
                this._getMessageHandler().handleMessageWithSender(
                    message,
                    (resp: ExtensionToWebviewMessage) => postSafe(resp)
                );
            }
        });

        panel.onDidDispose(() => {
            disposed = true;
            pendingMessages = [];
            messageListener.dispose();
        });

        this._extensionContext.subscriptions.push(panel);
    }
}
