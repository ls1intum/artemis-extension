import * as vscode from 'vscode';
import { AppStateManager } from './appStateManager';

/**
 * Hosts actions triggered from the webview that reach beyond simple rendering.
 */
export class ViewActionService {
    constructor(private readonly _appStateManager: AppStateManager) {}

    public async openJsonInEditor(data: any): Promise<void> {
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
            console.error('Error opening JSON in editor:', error);
            vscode.window.showErrorMessage('Failed to open JSON in editor');
        }
    }

    /**
     * Returns true when the exercise view was updated and the caller should re-render.
     */
    public async openExerciseDetails(exerciseId: number): Promise<boolean> {
        try {
            await this._appStateManager.showExerciseDetail(exerciseId);
            return true;
        } catch (error) {
            console.error('Error fetching exercise details:', error);
            vscode.window.showErrorMessage('Failed to fetch exercise details');
            return false;
        }
    }
}
