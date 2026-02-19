import { CombinedStruggleScore, InterventionState, RecommendedAction } from './types';

/**
 * Pedagogical guards for intervention decisions.
 * Ensures interventions are appropriate and not overwhelming.
 */
export class InterventionFilter {
    /** Minimum time in exercise before first intervention (5 minutes) */
    private static readonly MIN_EXERCISE_TIME_MS = 5 * 60 * 1000;
    /** Maximum interventions per session */
    private static readonly MAX_INTERVENTIONS_PER_SESSION = 3;
    /** Grace period after progress (2 minutes) */
    private static readonly PROGRESS_GRACE_PERIOD_MS = 2 * 60 * 1000;

    private _exerciseStartTime: number | undefined;
    private _lastProgressTime: number = 0;

    constructor() {
        // Will be initialized when exercise is started
    }

    /**
     * Record when the exercise session started
     */
    public setExerciseStartTime(timestamp: number = Date.now()): void {
        this._exerciseStartTime = timestamp;
    }

    /**
     * Record when the student made progress (e.g., fixed an error, passed a test)
     */
    public recordProgress(): void {
        this._lastProgressTime = Date.now();
    }

    /**
     * Determine if an intervention should be shown
     */
    public shouldIntervene(score: CombinedStruggleScore, state: InterventionState): boolean {
        // Don't intervene if action is 'none'
        if (score.recommendedAction === 'none') {
            return false;
        }

        // Check if enough time has passed in the exercise
        if (!this._hasEnoughExerciseTime()) {
            return false;
        }

        // Check if student made recent progress
        if (this._hasRecentProgress()) {
            return false;
        }

        // Check session intervention limit
        if (state.sessionInterventionCount >= InterventionFilter.MAX_INTERVENTIONS_PER_SESSION) {
            // Allow proactive interventions even after limit for severe struggles
            if (score.recommendedAction !== 'proactive' || score.combined < 85) {
                return false;
            }
        }

        // If the last intervention was dismissed and score hasn't increased significantly,
        // only allow proactive interventions
        if (state.lastDismissed && score.recommendedAction !== 'proactive') {
            return false;
        }

        return true;
    }

    /**
     * Check if enough time has passed in the exercise
     */
    private _hasEnoughExerciseTime(): boolean {
        if (this._exerciseStartTime === undefined) {
            // If we don't know when exercise started, assume it's been long enough
            // but be more conservative
            return true;
        }

        const elapsed = Date.now() - this._exerciseStartTime;
        return elapsed >= InterventionFilter.MIN_EXERCISE_TIME_MS;
    }

    /**
     * Check if the student has made recent progress
     */
    private _hasRecentProgress(): boolean {
        if (this._lastProgressTime === 0) {
            return false;
        }

        const elapsed = Date.now() - this._lastProgressTime;
        return elapsed < InterventionFilter.PROGRESS_GRACE_PERIOD_MS;
    }

    /**
     * Get time remaining before interventions are allowed
     */
    public getTimeUntilInterventionsAllowed(): number {
        if (this._exerciseStartTime === undefined) {
            return 0;
        }

        const elapsed = Date.now() - this._exerciseStartTime;
        const remaining = InterventionFilter.MIN_EXERCISE_TIME_MS - elapsed;
        return Math.max(0, remaining);
    }

    /**
     * EQ-based intervention check — applies same guardrails as shouldIntervene
     * but accepts EQ decision instead of CombinedStruggleScore.
     */
    public shouldInterveneEQ(
        decision: { level: RecommendedAction; eq: number },
        state: InterventionState,
    ): boolean {
        if (decision.level === 'none') {
            return false;
        }

        if (!this._hasEnoughExerciseTime()) {
            return false;
        }

        if (this._hasRecentProgress()) {
            return false;
        }

        // Session intervention limit
        if (state.sessionInterventionCount >= InterventionFilter.MAX_INTERVENTIONS_PER_SESSION) {
            // Allow proactive even after limit for severe EQ (>= 0.85)
            if (decision.level !== 'proactive' || decision.eq < 0.85) {
                return false;
            }
        }

        // Dismissed → only proactive allowed
        if (state.lastDismissed && decision.level !== 'proactive') {
            return false;
        }

        return true;
    }

    /**
     * Reset the filter state (e.g., for a new exercise)
     */
    public reset(): void {
        this._exerciseStartTime = undefined;
        this._lastProgressTime = 0;
    }
}
