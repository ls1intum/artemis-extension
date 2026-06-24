import type { DecisionTrace, TickRecord } from '@extension/services/struggle/types';

export const emptyDecisionTrace: DecisionTrace = {
    outcome: 'suppressed', reason: 'no-candidate', discreteTrigger: null,
    urgency: 0, theta: 0.7, typingRate: null, boundariesPresent: [],
    secondsSinceLastAlert: Number.POSITIVE_INFINITY, inWarmup: false, graceActive: false,
    gates: {
        fluentTyping: false, grace: false, warmup: false,
        belowThreshold: false, cooldown: false, notRearmed: false,
    },
};

export function tickRecord(over: Partial<TickRecord> = {}): TickRecord {
    return {
        t: 10, ts: 10_000,
        features: { t: 10, effectiveWindowS: 10, nOneCharInserts: 0, typingRate: 0, longestGapS: 0,
            fTyping: 0, fGap: 0, fFb: 0, fA8: 0, fN2: 0, tsState: false },
        sBase: 0, s: 0, v: 0, fastDecay: false, boundariesPreGate: [], alert: null,
        decisionTrace: emptyDecisionTrace, ...over,
    };
}
