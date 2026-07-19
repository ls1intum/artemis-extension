import * as vscode from 'vscode';

import type { CourseDetailData, ExtensionToWebviewMessage } from '@shared/messageContracts';
import { ExtensionMsg, WebviewMsgType } from '@shared/messageContracts';
import type { ArchivedCourse } from '@shared/messageContracts/domainTypes';
import { isWebviewMessage } from '@shared/messageContracts/typeGuards';

import type { WebViewMessageHandler } from '@extension/controller/webViewMessageHandler';
import { LogCategory, logger } from '@extension/services/loggingService';
import type { NoAiDetectionService } from '@extension/services/workspace';
import { collectExerciseSources, detectWorkspaceExercise, detectWorkspaceForRepoUris } from '@extension/services/workspace/workspaceDetectionService';
import { getTheiaEnvironment } from '@extension/theia/theiaEnvironment';
import type { ExerciseDetailsResponse } from '@extension/types';
import { VSCODE_CONFIG } from '@extension/utils';

import { getReactWebviewHtml } from './webviewHtml';

export class FullscreenPanelManager {
    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly _extensionContext: vscode.ExtensionContext,
        private readonly _getMessageHandler: () => WebViewMessageHandler,
        private readonly _noAiDetectionService: NoAiDetectionService,
    ) {}

    public openExerciseFullscreen(exerciseData: ExerciseDetailsResponse): void {
        const exerciseTitle = exerciseData?.exercise?.title || 'Exercise';
        // #342: the sidebar provider's own config listener re-pushes the proactive-help card on a
        // consent flip, but it posts through the sidebar's own transport and can never reach this
        // panel's independent webview - so this panel needs its own listener to stay in sync.
        let consentSub: vscode.Disposable | undefined;
        let noAiSub: vscode.Disposable | undefined;
        this._openFullscreenPanel({
            viewType: 'artemis.exerciseFullscreen',
            title: `Exercise: ${exerciseTitle}`,
            viewName: 'exerciseDetail',
            onReady: (postSafe) => {
                const isManagedEnvironment = getTheiaEnvironment().isManagedEnvironment;
                const repoUris = (exerciseData.exercise?.studentParticipations ?? [])
                    .map(p => p.repositoryUri)
                    .filter((uri): uri is string => !!uri);

                if (repoUris.length > 0) {
                    detectWorkspaceForRepoUris(repoUris).then((repoStatus) => {
                        postSafe({
                            type: ExtensionMsg.ExerciseDetailInit,
                            exerciseData,
                            hideDeveloperTools: false,
                            isManagedEnvironment,
                            repoStatus,
                        });
                    }).catch(() => {
                        postSafe({
                            type: ExtensionMsg.ExerciseDetailInit,
                            exerciseData,
                            hideDeveloperTools: false,
                            isManagedEnvironment,
                        });
                    });
                } else {
                    postSafe({
                        type: ExtensionMsg.ExerciseDetailInit,
                        exerciseData,
                        hideDeveloperTools: false,
                        isManagedEnvironment,
                    });
                }

                // onReady can fire again on a RequestInit; only wire the subscription once.
                if (!consentSub) {
                    consentSub = vscode.workspace.onDidChangeConfiguration((event) => {
                        if (event.affectsConfiguration(`${VSCODE_CONFIG.IRIS.SECTION}.${VSCODE_CONFIG.IRIS.PROACTIVE_EGRESS_KEY}`)) {
                            postSafe({ type: ExtensionMsg.UpdateProactiveConsent });
                        }
                    });
                }
                // #334: mirrors the sidebar's own .noai live-refresh (this panel has its own webview).
                if (!noAiSub) {
                    noAiSub = this._noAiDetectionService.onNoAiStatusChanged(isNoAiDetected => {
                        postSafe({ type: ExtensionMsg.UpdateNoAiStatus, isNoAiDetected });
                    });
                }
            },
            onDispose: () => { consentSub?.dispose(); consentSub = undefined; noAiSub?.dispose(); noAiSub = undefined; },
        });
    }

    public openCourseListFullscreen(courses: CourseDetailData[], archivedCourses?: ArchivedCourse[]): void {
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

    public openCourseFullscreen(courseData: CourseDetailData): void {
        const courseTitle = courseData?.course?.title || 'Course';
        this._openFullscreenPanel({
            viewType: 'artemis.courseFullscreen',
            title: `Course: ${courseTitle}`,
            viewName: 'courseDetail',
            onReady: (postSafe) => {
                const config = vscode.workspace.getConfiguration('artemis');
                const developerMode = config.get<boolean>('developerMode', false);
                const sources = collectExerciseSources([{
                    course: courseData.course,
                    exercises: courseData.course.exercises,
                }]);

                detectWorkspaceExercise(sources).then((detectedExercise) => {
                    postSafe({
                        type: ExtensionMsg.CourseDetailInit,
                        courseData: courseData,
                        workspaceExerciseId: detectedExercise?.id ?? null,
                        hideDeveloperTools: !developerMode,
                    });
                }).catch(() => {
                    postSafe({
                        type: ExtensionMsg.CourseDetailInit,
                        courseData: courseData,
                        workspaceExerciseId: null,
                        hideDeveloperTools: !developerMode,
                    });
                });
            },
        });
    }

    /**
     * Open the developer struggle view in its own editor tab (which the user can then move to a
     * separate window via VS Code's native "Move Editor into New Window"). Kept struggle-agnostic:
     * the caller supplies `buildInit` (the snapshot payload) and `subscribeRefresh` (re-send when
     * the engine state changes — ticks AND session start/end), so the always-bundled manager never
     * imports services/struggle and the clean build stays leak-free. The subscription is torn down
     * when the panel closes.
     */
    public openStruggleFullscreen(
        buildInit: () => ExtensionToWebviewMessage,
        subscribeRefresh: (refresh: () => void) => vscode.Disposable,
        onPanelDispose?: (postSafe: (msg: ExtensionToWebviewMessage) => void) => void,
    ): void {
        let refreshSub: vscode.Disposable | undefined;
        this._openFullscreenPanel({
            viewType: 'artemis.struggleFullscreen',
            title: 'Struggle Detection',
            viewName: 'struggleDetection',
            onReady: (postSafe) => {
                postSafe(buildInit());
                // onReady can fire again on a RequestInit; only wire the refresh subscription once.
                if (!refreshSub) { refreshSub = subscribeRefresh(() => postSafe(buildInit())); }
            },
            onDispose: (postSafe) => { refreshSub?.dispose(); refreshSub = undefined; onPanelDispose?.(postSafe); },
        });
    }

    private _openFullscreenPanel(options: {
        viewType: string;
        title: string;
        viewName: string;
        onReady: (postSafe: (msg: ExtensionToWebviewMessage) => void) => void;
        onDispose?: (postSafe: (msg: ExtensionToWebviewMessage) => void) => void;
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

            if (message.type === 'command') {
                this._getMessageHandler().handleMessageWithSender(message, postSafe, () => !disposed);
            }
        });

        panel.onDidDispose(() => {
            disposed = true;
            pendingMessages = [];
            messageListener.dispose();
            options.onDispose?.(postSafe);
        });

        this._extensionContext.subscriptions.push(panel);
    }
}
