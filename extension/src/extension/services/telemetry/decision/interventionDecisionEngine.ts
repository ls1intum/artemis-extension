import {
    InterventionDecision,
    InterventionState,
    EQConfidence,
    TriggerType,
    RecommendedAction,
} from '../types';
import { InterventionFilter } from '../interventionFilter';

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
     */
    public evaluate(
        eq: number,
        confidence: EQConfidence,
        triggerType: TriggerType | undefined,
        interventionState: InterventionState,
    ): InterventionDecision {
        // 1. Confidence gate: insufficient → no intervention
        //    ✅ Paper minimum: >=7 events = >=6 pairs [P3, Section 4]
        if (confidence === 'insufficient') {
            return {
                shouldIntervene: false,
                level: 'none',
                triggerType,
                eq,
                confidence,
            };
        }

        // 2. Map EQ to intervention level
        const level = this.mapEQToLevel(eq);

        if (level === 'none') {
            return {
                shouldIntervene: false,
                level: 'none',
                triggerType,
                eq,
                confidence,
            };
        }

        // 3. Apply guardrails via InterventionFilter
        const shouldIntervene = this._filter.shouldInterveneEQ(
            { level, eq },
            interventionState,
        );

        return {
            shouldIntervene,
            level,
            triggerType,
            eq,
            confidence,
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
