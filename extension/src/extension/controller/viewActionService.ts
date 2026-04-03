import * as vscode from 'vscode';
import { logger, LogCategory } from '../services/loggingService';
import type { ArtemisApiService } from '../api';
import { AppStateManager } from './appStateManager';
import { fetchAndEnrichExerciseDetails } from './exerciseDataLoader';
import type { ExerciseDetail } from '../types';

/**
 * Hosts actions triggered from the webview that reach beyond simple rendering.
 */
export class ViewActionService {
    constructor(
        private readonly _appStateManager: AppStateManager,
        private readonly _artemisApi: ArtemisApiService,
    ) { }

    public async openJsonInEditor(data: Record<string, unknown>): Promise<void> {
        try {
            const jsonContent = JSON.stringify(data, null, 2);
            const document = await vscode.workspace.openTextDocument({
                content: jsonContent,
                language: 'json'
            });

            await vscode.window.showTextDocument(document, {
                preview: false,
                viewColumn: vscode.ViewColumn.One
            });
        } catch (error) {
            logger.error('Error opening JSON in editor:', LogCategory.VIEW, error);
            vscode.window.showErrorMessage('Failed to open JSON in editor');
        }
    }

    /**
     * Returns true when the exercise view was updated and the caller should re-render.
     */
    public async openExerciseDetails(exerciseId: number): Promise<boolean> {
        try {
            const data = await fetchAndEnrichExerciseDetails(this._artemisApi, exerciseId);
            this._appStateManager.showExerciseDetail(data);
            return true;
        } catch (error) {
            logger.error('Error fetching exercise details:', LogCategory.VIEW, error);
            vscode.window.showErrorMessage('Failed to fetch exercise details');
            return false;
        }
    }

    /**
     * Opens an exam exercise details view using data from the studentExam.
     * This avoids API calls that are forbidden during exams.
     */
    public async openExamExerciseDetails(
        exercise: ExerciseDetail,
        exerciseIndex: number,
        courseId: number,
        examId: number
    ): Promise<boolean> {
        try {
            this._appStateManager.showExamExerciseDetail(exercise, exerciseIndex, courseId, examId);
            return true;
        } catch (error) {
            logger.error('Error showing exam exercise details:', LogCategory.VIEW, error);
            vscode.window.showErrorMessage('Failed to show exam exercise details');
            return false;
        }
    }
}
