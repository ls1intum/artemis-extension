import { InterventionFilter } from '@extension/services/telemetry/interventionFilter';
import {
    EQConfidence,
    InterventionDecision,
    InterventionState,
    RecommendedAction,
    TriggerType,
} from '@extension/services/telemetry/types';

/**
 * EQ-to-Intervention thresholds.
 * [NOT paper-validated] — Jadud gives no intervention thresholds.
 * Initial estimates based on EQ distribution in the paper.
 *
 * See MVP Section 2.4:
 *   EQ 0.00-0.15: Normal programming
 *   EQ 0.15-0.35: Occasional difficulties
 *   EQ 0.35-0.60: Systematic problems
 *   EQ 0.60-1.00: Severe, persistent struggle
 */
interface DecisionThresholds {
    subtle: number;
    notification: number;
    proactive: number;
}

const DEFAULT_THRESHOLDS: DecisionThresholds = {
    subtle: 0.15,
    notification: 0.35,
    proactive: 0.60,
};

/**
 * Maps EQ scores + trigger events to intervention decisions.
 *
 * Flow:
 *   1. Confidence gate: insufficient → no intervention
 *   2. EQ thresholds → level (none/subtle/notification/proactive)
 *   3. Pass through InterventionFilter guardrails
 */
export class InterventionDecisionEngine {
    private readonly _thresholds: DecisionThresholds;
    private readonly _filter: InterventionFilter;

    constructor(filter: InterventionFilter, thresholds?: Partial<DecisionThresholds>) {
        this._filter = filter;
        this._thresholds = { ...DEFAULT_THRESHOLDS, ...thresholds };
    }

    /**
     * Evaluate whether to intervene based on current EQ and trigger context.
     *
     * `rawWanted` is true when EQ is above the severity threshold, regardless
     * of confidence or guardrails. `shouldIntervene` is only true when ALL
     * gates pass. When `rawWanted=true` and `shouldIntervene=false`, callers
     * receive a `blockedReason` explaining which gate failed.
     */
    public evaluate(
        eq: number,
        confidence: EQConfidence,
        triggerType: TriggerType | undefined,
        interventionState: InterventionState,
    ): InterventionDecision {
        // 1. Map EQ to intervention level (severity only, no confidence gate here).
        const level = this.mapEQToLevel(eq);
        const rawWanted = level !== 'none';

        // 2. Confidence gate: insufficient → block with reason 'low-confidence'
        //    ✅ Paper minimum: >=7 events = >=6 pairs [P3, Section 4]
        if (confidence === 'insufficient') {
            return {
                rawWanted,
                shouldIntervene: false,
                level,
                triggerType,
                eq,
                confidence,
                blockedReason: rawWanted ? 'low-confidence' : undefined,
            };
        }

        if (!rawWanted) {
            return {
                rawWanted: false,
                shouldIntervene: false,
                level: 'none',
                triggerType,
                eq,
                confidence,
            };
        }

        // 3. Apply guardrails via InterventionFilter, which reports the exact
        //    blocking reason (warmup / recent-progress / session-limit / last-dismissed).
        const { ok: shouldIntervene, reason } = this._filter.shouldInterveneEQ(
            { level, eq },
            interventionState,
        );

        return {
            rawWanted: true,
            shouldIntervene,
            level,
            triggerType,
            eq,
            confidence,
            blockedReason: shouldIntervene ? undefined : reason,
        };
    }

    /**
     * Map EQ score to recommended action level.
     * Single source of truth for EQ-to-action mapping.
     */
    public mapEQToLevel(eq: number): RecommendedAction {
        if (eq >= this._thresholds.proactive) {
            return 'proactive';
        }
        if (eq >= this._thresholds.notification) {
            return 'notification';
        }
        if (eq >= this._thresholds.subtle) {
            return 'subtle';
        }
        return 'none';
    }

}
