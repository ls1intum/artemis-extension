import * as vscode from 'vscode';
import type { AppState } from './appStateManager';
import { getReactWebviewHtml } from '../services/ui';

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

/** Returns the React webview HTML for the given application state. */
export function getViewHtml(state: AppState, extensionUri: vscode.Uri, webview: vscode.Webview): string {
    const viewName = STATE_TO_VIEW[state];
    return getReactWebviewHtml(webview, extensionUri, viewName);
}
