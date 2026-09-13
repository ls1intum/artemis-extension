import { InterventionBlockedReason, InterventionState, RecommendedAction, SessionResettable, SessionStartContext } from './types';

/**
 * Pedagogical guards for intervention decisions.
 * Ensures interventions are appropriate and not overwhelming.
 */
export class InterventionFilter implements SessionResettable {
    /** Warmup before the first intervention of an exercise. */
    private static readonly MIN_EXERCISE_TIME_MS = 5 * 60 * 1000;
    private static readonly MAX_INTERVENTIONS_PER_SESSION = 3;
    /** Silence after the student made progress. */
    private static readonly PROGRESS_GRACE_PERIOD_MS = 2 * 60 * 1000;
    /** EQ at/above which a proactive intervention is allowed even past the session limit */
    private static readonly SEVERE_EQ_PROACTIVE_OVERRIDE = 0.85;

    private _exerciseStartTime: number | undefined;
    private _lastProgressTime: number = 0;

    constructor() {
    }

    public setExerciseStartTime(timestamp: number = Date.now()): void {
        this._exerciseStartTime = timestamp;
    }

    /** Progress means e.g. a fixed error or a newly passing test. */
    public recordProgress(): void {
        this._lastProgressTime = Date.now();
    }

    /**
     * An unknown start time (session never initialized) blocks interventions:
     * the warmup exists to prevent premature interventions, and "unknown" must
     * not silently bypass it.
     */
    private _hasEnoughExerciseTime(): boolean {
        if (this._exerciseStartTime === undefined) {
            return false;
        }

        const elapsed = Date.now() - this._exerciseStartTime;
        return elapsed >= InterventionFilter.MIN_EXERCISE_TIME_MS;
    }

    private _hasRecentProgress(): boolean {
        if (this._lastProgressTime === 0) {
            return false;
        }

        const elapsed = Date.now() - this._lastProgressTime;
        return elapsed < InterventionFilter.PROGRESS_GRACE_PERIOD_MS;
    }

    /**
     * EQ-based intervention check. Applies the pedagogical guardrails: exercise
     * time, recent progress, session limit, dismiss behavior.
     */
    public shouldInterveneEQ(
        decision: { level: RecommendedAction; eq: number },
        state: InterventionState,
    ): { ok: boolean; reason?: InterventionBlockedReason } {
        if (decision.level === 'none') {
            return { ok: false };
        }

        if (!this._hasEnoughExerciseTime()) {
            return { ok: false, reason: 'warmup' };
        }

        if (this._hasRecentProgress()) {
            return { ok: false, reason: 'recent-progress' };
        }

        if (state.sessionInterventionCount >= InterventionFilter.MAX_INTERVENTIONS_PER_SESSION) {
            // A severe EQ still gets a proactive intervention past the limit.
            if (decision.level !== 'proactive' || decision.eq < InterventionFilter.SEVERE_EQ_PROACTIVE_OVERRIDE) {
                return { ok: false, reason: 'session-limit' };
            }
        }

        if (state.lastDismissed && decision.level !== 'proactive') {
            return { ok: false, reason: 'last-dismissed' };
        }

        return { ok: true };
    }

    public onSessionStart(_context: SessionStartContext): void {
        this.setExerciseStartTime();
        this._lastProgressTime = 0;
    }

}
