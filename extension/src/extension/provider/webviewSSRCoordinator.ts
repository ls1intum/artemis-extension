import * as vscode from 'vscode';

import type { ExtensionToWebviewMessage } from '@shared/messageContracts';
import { ExtensionMsg } from '@shared/messageContracts';
import { selectParticipation } from '@shared/utils/participationSelection';

import type { AppStateManager } from '@extension/controller/appStateManager';
import { LogCategory, logger } from '@extension/services/loggingService';
import type { ProblemStatementRenderService } from '@extension/services/problemStatementRenderService';
import type { ExerciseDetailsResponse } from '@extension/types';

export interface WebviewSSRCoordinatorDeps {
    appStateManager: AppStateManager;
    renderService: ProblemStatementRenderService;
    postMessage: (msg: ExtensionToWebviewMessage) => void;
    fetchExerciseDetails: (exerciseId: number) => Promise<ExerciseDetailsResponse>;
}

interface RefreshOpts {
    exerciseId: number;
}

/**
 * Coordinates server-side rendering (SSR) of problem statements for the
 * exercise-detail view. Owns the theme-change listener that invalidates the
 * render cache and schedules a fresh render whenever the active color theme
 * changes (because darkMode is part of the render request).
 *
 * Also coordinates server-driven refreshes (e.g. WebSocket newResult events)
 * via {@link refreshFromServer}: re-fetches enriched exercise details,
 * updates the extension-side app state, and re-renders the PS. Concurrent
 * refresh requests are coalesced last-wins so only one fetch is in flight
 * at a time with at most one pending behind it.
 */
export class WebviewSSRCoordinator implements vscode.Disposable {
    private readonly _themeListener: vscode.Disposable;
    private _refreshing = false;
    private _refreshPending: RefreshOpts | undefined;
    private _disposed = false;

    constructor(private readonly deps: WebviewSSRCoordinatorDeps) {
        this._themeListener = vscode.window.onDidChangeActiveColorTheme(() => {
            this.deps.renderService.invalidateAll();
            this.deps.appStateManager.serverRenderedProblemStatement = null;
            void this.scheduleRender();
        });
    }

    public async scheduleRender(): Promise<void> {
        if (this._disposed) { return; }
        // SSR is for the exercise detail view only.
        if (this.deps.appStateManager.currentState !== 'exercise-detail') { return; }

        const exerciseData = this.deps.appStateManager.currentExerciseData;
        if (!exerciseData?.exercise?.problemStatement) {
            logger.info('[SSR] No exercise data or problemStatement, skipping', LogCategory.GENERAL);
            return;
        }

        const exercise = exerciseData.exercise;
        const exerciseId = exercise.id;
        // The same rule the exercise view uses, off the same fact: which repository the student
        // actually has open. Rendering `[0]` instead was not merely a different choice, it was a
        // nondeterministic one, because Artemis builds this list from an unordered set.
        const participation = selectParticipation(
            exercise.studentParticipations,
            this.deps.appStateManager.workspaceIsPractice,
        );
        const participationId = participation?.id;
        // A pending submission carries no result, so without this the statement would render with no
        // task markers at all for the length of every build.
        const buildPending = participationId !== undefined
            && exerciseData.pendingSubmissionsByParticipationId?.[participationId] !== undefined;

        logger.info(`[SSR] Starting background render for exercise ${exerciseId}`, LogCategory.GENERAL);

        try {
            const rendered = await this.deps.renderService.render(exercise, { participation, buildPending });

            // Guard: dispose may have happened during the render await; also
            // verify same exercise is still active.
            if (this._disposed) { return; }
            const current = this.deps.appStateManager.currentExerciseData;
            if (current?.exercise?.id !== exerciseId) { return; }
            // And that the workspace has not switched participation underneath the render, which the
            // exercise id alone does not cover: both belong to the same exercise.
            if (selectParticipation(
                current?.exercise?.studentParticipations,
                this.deps.appStateManager.workspaceIsPractice,
            )?.id !== participationId) { return; }

            if (rendered) {
                // Labelled with the participation THIS render selected, never with one carried inside
                // the render service. Its cache is keyed on a hash of the render inputs, so two
                // participations whose test results happen to match share an entry; taking the
                // identity from there would hand back the other participation's id and the view would
                // hide HTML that is correct for it.
                const payload = { html: rendered.html, participationId };
                // Store in app state so sendExerciseDetailInit includes it
                this.deps.appStateManager.serverRenderedProblemStatement = payload;
                // Also send as separate message for cases where init was already sent
                this.deps.postMessage({
                    type: ExtensionMsg.ProblemStatementRendered,
                    ...payload,
                });
                logger.info(`[SSR] Server render cached + sent (hash: ${rendered.contentHash.slice(0, 8)})`, LogCategory.GENERAL);
            }
        } catch (error) {
            logger.info(`[SSR] Background render failed: ${error}`, LogCategory.GENERAL);
        }
    }

    /**
     * Re-fetch enriched exercise details from the server, push them into
     * app state, and trigger a fresh SSR render.
     *
     * Concurrency: at most one fetch is in flight. A second call while one
     * is in flight stores the latest opts as pending and runs after the
     * current completes (last-wins). Multiple results arriving rapidly
     * therefore collapse to at most one extra refresh.
     *
     * No `sendInitData()` is performed here on purpose: the webview's store
     * already patches `newResult` payloads incrementally, and the SSR
     * re-render arrives via the `ProblemStatementRendered` message. Sending
     * a full init would clear the cached server render (because
     * `showExerciseDetail` resets `serverRenderedProblemStatement` to null)
     * and produce a brief blank/markdown-fallback render until the new
     * SSR returns.
     */
    public refreshFromServer(opts: RefreshOpts): void {
        if (this._disposed) { return; }
        if (this._refreshing) {
            this._refreshPending = opts;
            return;
        }
        void this._runRefreshLoop(opts);
    }

    private async _runRefreshLoop(initial: RefreshOpts): Promise<void> {
        this._refreshing = true;
        try {
            let next: RefreshOpts | undefined = initial;
            while (next) {
                this._refreshPending = undefined;
                try {
                    await this._refreshOnce(next);
                } catch (err) {
                    // `_refreshOnce` already swallows fetch errors. This catch
                    // is belt-and-suspenders against an unexpected throw
                    // (e.g. a future invariant breach in `showExerciseDetail`)
                    // permanently stalling the loop and dropping the pending
                    // refresh.
                    logger.warn(`[SSR] Refresh iteration threw: ${err}`, LogCategory.GENERAL);
                }
                next = this._refreshPending;
            }
        } finally {
            this._refreshing = false;
        }
    }

    private async _refreshOnce({ exerciseId }: RefreshOpts): Promise<void> {
        if (this._disposed) { return; }
        if (this.deps.appStateManager.currentState !== 'exercise-detail') { return; }
        const current = this.deps.appStateManager.currentExerciseData;
        if (current?.exercise?.id !== exerciseId) { return; }

        let fresh: ExerciseDetailsResponse;
        try {
            fresh = await this.deps.fetchExerciseDetails(exerciseId);
        } catch (err) {
            logger.info(`[SSR] Refresh fetch failed for exercise ${exerciseId}: ${err}`, LogCategory.GENERAL);
            return;
        }

        // Re-check guards: state, exerciseId, and disposed may all have
        // changed during the await.
        if (this._disposed) { return; }
        if (this.deps.appStateManager.currentState !== 'exercise-detail') { return; }
        const curAfter = this.deps.appStateManager.currentExerciseData;
        if (curAfter?.exercise?.id !== exerciseId) { return; }

        this.deps.appStateManager.showExerciseDetail(fresh);
        await this.scheduleRender();
    }

    public dispose(): void {
        this._disposed = true;
        this._themeListener.dispose();
    }
}
