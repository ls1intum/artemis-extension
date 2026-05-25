import * as vscode from 'vscode';

import type { ExtensionToWebviewMessage } from '@shared/messageContracts';
import { ExtensionMsg } from '@shared/messageContracts';

import type { AppStateManager } from '@extension/controller/appStateManager';
import { LogCategory, logger } from '@extension/services/loggingService';
import type { ProblemStatementRenderService } from '@extension/services/problemStatementRenderService';

export interface WebviewSSRCoordinatorDeps {
    appStateManager: AppStateManager;
    renderService: ProblemStatementRenderService;
    postMessage: (msg: ExtensionToWebviewMessage) => void;
}

/**
 * Coordinates server-side rendering (SSR) of problem statements for the
 * exercise-detail view. Owns the theme-change listener that invalidates the
 * render cache and schedules a fresh render whenever the active color theme
 * changes (because darkMode is part of the render request).
 */
export class WebviewSSRCoordinator implements vscode.Disposable {
    private readonly _themeListener: vscode.Disposable;

    constructor(private readonly deps: WebviewSSRCoordinatorDeps) {
        this._themeListener = vscode.window.onDidChangeActiveColorTheme(() => {
            this.deps.renderService.invalidateAll();
            this.deps.appStateManager.serverRenderedProblemStatement = null;
            void this.scheduleRender();
        });
    }

    public async scheduleRender(): Promise<void> {
        // SSR is for the exercise detail view only.
        if (this.deps.appStateManager.currentState !== 'exercise-detail') { return; }

        const exerciseData = this.deps.appStateManager.currentExerciseData;
        if (!exerciseData?.exercise?.problemStatement) {
            logger.info('[SSR] No exercise data or problemStatement, skipping', LogCategory.GENERAL);
            return;
        }

        const exercise = exerciseData.exercise;
        const exerciseId = exercise.id;
        const participation = exercise.studentParticipations?.[0];

        logger.info(`[SSR] Starting background render for exercise ${exerciseId}`, LogCategory.GENERAL);

        try {
            const rendered = await this.deps.renderService.render(exercise, { participation });

            // Guard: verify same exercise is still active after await
            const current = this.deps.appStateManager.currentExerciseData;
            if (current?.exercise?.id !== exerciseId) { return; }

            if (rendered) {
                // Store in app state so sendExerciseDetailInit includes it
                this.deps.appStateManager.serverRenderedProblemStatement = {
                    html: rendered.html,
                };
                // Also send as separate message for cases where init was already sent
                this.deps.postMessage({
                    type: ExtensionMsg.ProblemStatementRendered,
                    html: rendered.html,
                });
                logger.info(`[SSR] Server render cached + sent (hash: ${rendered.contentHash.slice(0, 8)})`, LogCategory.GENERAL);
            }
        } catch (error) {
            logger.info(`[SSR] Background render failed: ${error}`, LogCategory.GENERAL);
        }
    }

    public dispose(): void {
        this._themeListener.dispose();
    }
}
