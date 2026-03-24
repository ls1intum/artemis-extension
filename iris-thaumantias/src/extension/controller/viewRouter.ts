import * as vscode from 'vscode';
import { AppStateManager, type AppState } from './appStateManager';
import { getReactWebviewHtml } from '../services';

/** Maps AppState values to React view entry-point names. */
const STATE_TO_VIEW: Record<AppState, string> = {
    'login': 'login',
    'dashboard': 'dashboard',
    'course-list': 'courseList',
    'course-detail': 'courseDetail',
    'exercise-detail': 'exerciseDetail',
    'exam-exercise-detail': 'examExerciseDetail',
    'ai-config': 'aiConfig',
    'service-status': 'serviceStatus',
    'struggle-detection': 'struggleDetection',
    'recommended-extensions': 'recommendedExtensions',
    'git-credentials': 'gitCredentials',
    'exam-start': 'examStart',
    'exam-conduction': 'examConduction',
};

/**
 * Maps application state to the appropriate React webview HTML.
 */
export class ViewRouter {
    constructor(
        private readonly _appStateManager: AppStateManager,
        private readonly _extensionContext: vscode.ExtensionContext,
        private readonly _webview?: vscode.Webview
    ) {}

    public async getHtml(): Promise<string> {
        const webview = this._webview;
        if (!webview) {
            throw new Error('Webview is not initialized');
        }

        const viewName = STATE_TO_VIEW[this._appStateManager.currentState];
        return getReactWebviewHtml(webview, this._extensionContext.extensionUri, viewName);
    }
}
