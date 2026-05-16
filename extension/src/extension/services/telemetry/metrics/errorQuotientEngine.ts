import {
    DEFAULT_EQ_CONFIG,
    EQConfidence,
    EQConfig,
    EQState,
    ErrorSnapshot,
    SessionResettable,
    SessionStartContext,
} from '../types';
import { shouldDedupSnapshot } from './snapshotDedup';

/**
 * Error Quotient (EQ) Engine — pure calculation based on Jadud 2006 [P3].
 *
 * Implements the pair-scoring formula:
 *   score(eᵢ, eᵢ₊₁) = 11 if both have errors AND share an error family
 *                       = 8  if both have errors AND no shared family
 *                       = 0  otherwise
 *   EQ = mean( score(eᵢ, eᵢ₊₁) / 11 ) for all consecutive pairs
 *
 * Paper reference: Jadud, M.C. (2006). "Methods and Tools for Exploring
 * Novice Compilation Behaviour." ICER '06. [P3, Section 4, Figure 4]
 */
export class ErrorQuotientEngine implements SessionResettable {
    private _snapshots: ErrorSnapshot[] = [];
    private readonly _config: EQConfig;

    constructor(config: EQConfig = DEFAULT_EQ_CONFIG) {
        this._config = config;
    }

    /**
     * Add a new error snapshot from a compile-equivalent event.
     * Applies dedup (same families within window) and inactivity split.
     * @returns true if the snapshot was accepted, false if deduped
     */
    public addSnapshot(snapshot: ErrorSnapshot): boolean {
        const last = this._snapshots[this._snapshots.length - 1];

        // Inactivity split: >30min gap → clear snapshots (new sub-session)
        if (last && (snapshot.timestamp - last.timestamp) > this._config.SESSION_INACTIVITY_SPLIT_MS) {
            this.splitSubSession();
        }

        // Dedup: skip if within window AND same error families
        if (last && shouldDedupSnapshot(snapshot, last, this._config.DEDUP_WINDOW_MS)) {
            return false;
        }

        this._snapshots.push(snapshot);
        return true;
    }

    /**
     * Calculate current EQ and confidence.
     * EQ is always calculated (even under minimum events);
     * confidence indicates how reliable the value is.
     */
    public getCurrentEQ(): { eq: number; confidence: EQConfidence } {
        if (this._snapshots.length < 2) {
            return { eq: 0, confidence: 'insufficient' };
        }

        let totalNormalizedScore = 0;
        const pairCount = this._snapshots.length - 1;

        for (let i = 0; i < pairCount; i++) {
            const prev = this._snapshots[i];
            const curr = this._snapshots[i + 1];

            let pairScore = 0;

            if (prev.hasErrors && curr.hasErrors) {
                // Both events have errors → +8 [P3, Section 4]
                pairScore = this._config.WEIGHT_BOTH_ERROR;

                // Check for shared error family (intersection)
                // [ADAPTATION] Paper: single error match. VS Code: set intersection.
                const hasSharedFamily = this._hasIntersection(prev.errorFamilies, curr.errorFamilies);
                if (hasSharedFamily) {
                    // Same error type → +3 [P3, Section 4]
                    pairScore += this._config.WEIGHT_SAME_TYPE;
                }
            }
            // else: pairScore stays 0 [P3: at least one error-free → 0]

            // Normalize by max pair score [P3, Section 4]
            totalNormalizedScore += pairScore / this._config.MAX_PAIR_SCORE;
        }

        // Confidence based on pair count [Engineering choice]
        const confidence = this._calculateConfidence(pairCount);

        // Average [P3, Section 4]
        return { eq: totalNormalizedScore / pairCount, confidence };
    }

    /**
     * SessionResettable — delegates to existing resetSession().
     */
    public onSessionStart(_context: SessionStartContext): void {
        this.resetSession();
    }

    /**
     * Full reset — for exercise switch.
     */
    public resetSession(): void {
        this._snapshots = [];
    }

    /**
     * Clear snapshots only — for 30min inactivity split.
     */
    public splitSubSession(): void {
        this._snapshots = [];
    }

    /**
     * Get current engine state for debugging/display.
     */
    public getState(): EQState {
        const { eq, confidence } = this.getCurrentEQ();
        return {
            snapshots: [...this._snapshots],
            currentEQ: eq,
            pairCount: Math.max(0, this._snapshots.length - 1),
            confidence,
        };
    }

    /**
     * Seed the engine with pre-existing snapshots (for replay).
     * Replaces current state — call before processing any events.
     */
    public seedSnapshots(snapshots: ErrorSnapshot[]): void {
        this._snapshots = [...snapshots];
    }

    /**
     * Check if two sets have any common elements.
     */
    private _hasIntersection(a: Set<string>, b: Set<string>): boolean {
        // Iterate over the smaller set for efficiency
        const [smaller, larger] = a.size <= b.size ? [a, b] : [b, a];
        for (const item of smaller) {
            if (larger.has(item)) {
                return true;
            }
        }
        return false;
    }

    /**
     * Determine confidence from pair count.
     * ✅ Paper minimum: >=7 events = >=6 pairs [P3, Section 4]
     */
    private _calculateConfidence(pairCount: number): EQConfidence {
        return pairCount >= 6 ? 'sufficient' : 'insufficient';
    }

    public dispose(): void {
        this._snapshots = [];
    }
}
