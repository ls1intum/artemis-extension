import type { DetectionOutcome } from '@extension/services/workspace/detectionOutcome';

import { StartupLatch } from './startupLatch';

export type DetectionUiState = 'unsettled' | 'settled' | 'unavailable';

export interface ChatStartupDeps {
    start(workspace: { exerciseId: number; courseId: number }): Promise<void>;
    publishDetectionState(state: DetectionUiState): void;
    retryDetection(): void;
}

/**
 * The single owner of the chat's automatic cold start.
 *
 * Two things have to be true before the chat may acquire a conversation by
 * itself: the webview exists, and workspace detection has settled. They arrive
 * in either order and used to race, which is why a first-ever exercise folder
 * could land on the course chooser and stay there forever.
 */
export class ChatStartupCoordinator {
    private readonly _latch = new StartupLatch();
    private _viewResolved = false;
    private _outcome: DetectionOutcome | undefined;

    constructor(private readonly _deps: ChatStartupDeps) {}

    public onViewResolved(): void {
        this._viewResolved = true;
        this._maybeStart();
    }

    public onDetectionSettled(outcome: DetectionOutcome): void {
        this._outcome = outcome;
        this._deps.publishDetectionState(this._uiStateFor(outcome));
        this._maybeStart();
    }

    public admitExplicitIntent(reason: string): void {
        const wasEligible = this._latch.state === 'eligible';
        this._latch.cancel(reason);
        // The student is on their way somewhere. A startup-unavailable banner
        // left on screen would now offer a Retry that can no longer do
        // anything, because `retry()` requires an eligible latch.
        if (wasEligible && this._outcome?.kind === 'unavailable') {
            this._deps.publishDetectionState('settled');
        }
    }

    /**
     * `unavailable` is only worth showing while the Retry it offers can still
     * act. Once the latch is consumed or cancelled, `retry()` is a no-op, so
     * publishing `unavailable` would put a dead button in front of the student.
     * Two real orders reach that state: a `no-match` consumes the latch and a
     * later folder change settles `unavailable`, or an explicit navigation
     * cancels it and detection then fails.
     */
    private _uiStateFor(outcome: DetectionOutcome): DetectionUiState {
        if (outcome.kind !== 'unavailable') { return 'settled'; }
        return this._latch.state === 'eligible' ? 'unavailable' : 'settled';
    }

    /**
     * The startup Retry. It re-runs DETECTION rather than reloading the
     * conversation: on this path there may be no workspace exercise at all, so
     * a reload would start whatever happens to be left over, or nothing.
     */
    public retry(): void {
        if (this._latch.state !== 'eligible') { return; }
        this._outcome = undefined;
        this._deps.publishDetectionState('unsettled');
        this._deps.retryDetection();
    }

    private _maybeStart(): void {
        if (!this._viewResolved || this._outcome === undefined) { return; }
        // An unreachable server is not an answer. Keep the latch so the Retry
        // can still reach the conversation the student actually has.
        if (this._outcome.kind === 'unavailable') { return; }
        if (!this._latch.consume()) { return; }
        if (this._outcome.kind === 'no-match') { return; }
        void this._deps.start({
            exerciseId: this._outcome.exerciseId,
            courseId: this._outcome.courseId,
        });
    }
}
