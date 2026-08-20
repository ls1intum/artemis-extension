import * as vscode from 'vscode';

import { getReactWebviewHtml } from '@extension/services/ui';

import type { AppState } from './appStateManager';

/** Maps AppState values to React view entry-point names. */
const STATE_TO_VIEW: Record<AppState, string> = {
    'login': 'login',
    'dashboard': 'dashboard',
    'course-list': 'courseList',
    'course-detail': 'courseDetail',
    'exercise-detail': 'exerciseDetail',
    'ai-config': 'aiConfig',
    'service-status': 'serviceStatus',
    'struggle-detection': 'struggleDetection',
    'recommended-extensions': 'recommendedExtensions',
    'git-credentials': 'gitCredentials',
};

export function getViewHtml(state: AppState, extensionUri: vscode.Uri, webview: vscode.Webview): string {
    const viewName = STATE_TO_VIEW[state];
    return getReactWebviewHtml(webview, extensionUri, viewName);
}
