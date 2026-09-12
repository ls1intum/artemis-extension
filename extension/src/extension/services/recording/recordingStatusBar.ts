/**
 * Status bar item that shows recording state and lets the user toggle recording.
 *
 * Only visible when consent is Extended. Clicking starts or stops the session.
 */

import * as vscode from 'vscode';

import { LogCategory, logger } from '@extension/services/loggingService';

import type { SessionRecorder } from './sessionRecorder';

export class RecordingStatusBarService implements vscode.Disposable {
    private readonly _statusBarItem: vscode.StatusBarItem;
    private readonly _disposables: vscode.Disposable[] = [];

    private _isEnabled = false;
    private _isRecording = false;

    public static readonly COMMAND_ID = 'artemis.toggleRecording';

    constructor(
        private readonly _sessionRecorder: SessionRecorder,
        private readonly _getExerciseId: () => number | undefined,
    ) {
        this._statusBarItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Right,
            99,
        );
        this._statusBarItem.command = RecordingStatusBarService.COMMAND_ID;

        this._disposables.push(
            vscode.commands.registerCommand(
                RecordingStatusBarService.COMMAND_ID,
                () => this._handleClick(),
            ),
        );

        this._disposables.push(
            this._sessionRecorder.onDidChangeState(state => {
                this._isEnabled = state.isEnabled;
                this._isRecording = state.isRecording;
                this._updateAppearance();
            }),
        );

        this._isEnabled = this._sessionRecorder.isEnabled;
        this._isRecording = this._sessionRecorder.isRecording;
        this._updateAppearance();
    }

    private _updateAppearance(): void {
        if (!this._isEnabled) {
            this._statusBarItem.hide();
            return;
        }

        if (this._isRecording) {
            this._statusBarItem.text = '$(circle-filled) Recording';
            this._statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
            this._statusBarItem.tooltip = 'Session recording in progress — click to stop';
        } else {
            this._statusBarItem.text = '$(circle-outline) Record';
            this._statusBarItem.backgroundColor = undefined;
            this._statusBarItem.tooltip = 'Start session recording — click to begin';
        }

        this._statusBarItem.show();
    }

    private async _handleClick(): Promise<void> {
        if (this._isRecording) {
            await this._sessionRecorder.endSession();
            logger.info('Recording stopped by user', LogCategory.TELEMETRY);
            return;
        }

        const exerciseId = this._getExerciseId();
        if (exerciseId === undefined) {
            vscode.window.showWarningMessage('No Artemis exercise detected for the current workspace.');
            return;
        }

        const exerciseRoot = vscode.workspace.workspaceFolders?.[0]?.uri.toString();
        await this._sessionRecorder.startSession(exerciseId, undefined, exerciseRoot);
        logger.info('Recording started by user', LogCategory.TELEMETRY);
    }

    dispose(): void {
        this._statusBarItem.dispose();
        while (this._disposables.length > 0) {
            const d = this._disposables.pop();
            d?.dispose();
        }
    }
}
