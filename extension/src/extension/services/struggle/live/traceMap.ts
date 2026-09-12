import type { LiveDecisionTrace } from '@shared/messageContracts';

import type { DecisionTrace } from '@extension/services/struggle/types';

/**
 * Map the engine's internal {@link DecisionTrace} to the JSON-safe wire
 * {@link LiveDecisionTrace}. Shared by the live-tick feed AND the dev debug snapshot so the
 * decision wording/shape never drifts between the two channels. `Infinity` is not JSON-safe,
 * so `secondsSinceLastAlert` is serialised to `null`.
 */
export function toLiveDecisionTrace(tr: DecisionTrace): LiveDecisionTrace {
    return {
        outcome: tr.outcome,
        reason: tr.reason,
        discreteTrigger: tr.discreteTrigger,
        urgency: tr.urgency,
        theta: tr.theta,
        typingRate: tr.typingRate,
        boundariesPresent: [...tr.boundariesPresent],
        secondsSinceLastAlert: Number.isFinite(tr.secondsSinceLastAlert) ? tr.secondsSinceLastAlert : null,
        inWarmup: tr.inWarmup,
        graceActive: tr.graceActive,
        gates: {
            fluentTyping: tr.gates.fluentTyping,
            grace: tr.gates.grace,
            warmup: tr.gates.warmup,
            belowThreshold: tr.gates.belowThreshold,
            cooldown: tr.gates.cooldown,
            notRearmed: tr.gates.notRearmed,
        },
    };
}
