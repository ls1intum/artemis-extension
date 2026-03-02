import * as vscode from 'vscode';
import { AppStateManager, type AppState } from './appStateManager';
import { getReactWebviewHtml } from '../../utils/webviewHelpers';

/**
 * Maps application state to the appropriate React webview HTML.
 * All views are now React-based — no legacy HTML generation.
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

        const state = this._appStateManager.currentState;
        const viewName = this._stateToViewName(state);

        return getReactWebviewHtml(webview, this._extensionContext.extensionUri, viewName);
    }

    /**
     * Map AppState values to React view names.
     */
    private _stateToViewName(state: AppState): string {
        // Map kebab-case state names to camelCase view names
        switch (state) {
            case 'git-credentials':
                return 'gitCredentials';
            case 'service-status':
                return 'serviceStatus';
            case 'recommended-extensions':
                return 'recommendedExtensions';
            case 'login':
                return 'login';
            case 'dashboard':
                return 'dashboard';
            case 'course-list':
                return 'courseList';
            case 'course-detail':
                return 'courseDetail';
            case 'exercise-detail':
                return 'exerciseDetail';
            case 'exam-exercise-detail':
                return 'examExerciseDetail';
            case 'ai-config':
                return 'aiConfig';
            case 'struggle-detection':
                return 'struggleDetection';
            case 'exam-start':
                return 'examStart';
            case 'exam-conduction':
                return 'examConduction';
            default: {
                const _exhaustive: never = state;
                throw new Error(`Unhandled app state: ${_exhaustive}`);
            }
        }
    }
}
