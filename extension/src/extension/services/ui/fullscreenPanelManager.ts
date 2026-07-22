import * as vscode from 'vscode';

import type { CourseDetailData, ExtensionToWebviewMessage } from '@shared/messageContracts';
import { ExtensionMsg, WebviewMsgType } from '@shared/messageContracts';
import type { ArchivedCourse } from '@shared/messageContracts/domainTypes';
import { isWebviewMessage } from '@shared/messageContracts/typeGuards';

import type { WebViewMessageHandler } from '@extension/controller/webViewMessageHandler';
import { LogCategory, logger } from '@extension/services/loggingService';
import type { ExerciseDetailsResponse } from '@extension/types';

import type { ViewInitDataService } from './viewInitDataService';
import type { WebviewBroadcaster } from './webviewBroadcaster';
import { getReactWebviewHtml } from './webviewHtml';

export class FullscreenPanelManager {
    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly _extensionContext: vscode.ExtensionContext,
        private readonly _getMessageHandler: () => WebViewMessageHandler,
        // Lazy: the init service is constructed after this manager. Shared with the
        // sidebar so both transports build identical exercise/course init payloads.
        private readonly _getViewInitData: () => ViewInitDataService,
        // Every panel registers its transport here so global pushes (consent,
        // .noai, SSR) reach it without the panel re-subscribing on its own.
        private readonly _broadcaster: WebviewBroadcaster,
    ) {}

    public openExerciseFullscreen(exerciseData: ExerciseDetailsResponse): void {
        const exerciseTitle = exerciseData?.exercise?.title || 'Exercise';
        this._openFullscreenPanel({
            viewType: 'artemis.exerciseFullscreen',
            title: `Exercise: ${exerciseTitle}`,
            viewName: 'exerciseDetail',
            // Same shared builder the sidebar uses (repoStatus, dev-tools gating, and the
            // cached SSR). onReady also fires on RequestInit; rebuilding each time is fine.
            // Consent/.noai/SSR live updates arrive via the broadcaster (registered in
            // _openFullscreenPanel), so this panel no longer needs its own listeners.
            onReady: (postSafe) => {
                void this._getViewInitData().buildExerciseDetailInit(exerciseData).then(({ msg }) => postSafe(msg));
            },
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
                void this._getViewInitData().buildCourseDetailInit(courseData).then(postSafe);
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

        // Register this panel's transport once (at creation, NOT in onReady which
        // re-fires on RequestInit) so global pushes reach it; postSafe buffers
        // anything that arrives before the webview signals Ready.
        const sinkRegistration = this._broadcaster.addSink(postSafe);

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
            sinkRegistration.dispose();
            messageListener.dispose();
            options.onDispose?.(postSafe);
        });

        this._extensionContext.subscriptions.push(panel);
    }
}
