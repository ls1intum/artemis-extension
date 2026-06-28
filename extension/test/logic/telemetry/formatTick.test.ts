import { describe, expect, it } from 'vitest';

import type { StruggleDebugSnapshot } from '@shared/messageContracts';

import { SPEC } from '@extension/services/struggle/config';
import type { DecisionTrace, FeatureVector, GateConditions, TickRecord } from '@extension/services/struggle/types';
import { formatTick } from '@extension/telemetry/formatTick';

function gates(over: Partial<GateConditions> = {}): GateConditions {
    return {
        fluentTyping: false,
        grace: false,
        warmup: false,
        belowThreshold: false,
        cooldown: false,
        notRearmed: false,
        ...over,
    };
}

function features(over: Partial<FeatureVector> = {}): FeatureVector {
    return {
        t: 60,
        effectiveWindowS: 60,
        nOneCharInserts: 0,
        typingRate: 12,
        longestGapS: 18,
        fTyping: 0.4,
        fGap: 0.45,
        fFb: 0,
        fA8: 0,
        fN2: 0,
        tsState: false,
        ...over,
    };
}

function trace(over: Partial<DecisionTrace> = {}): DecisionTrace {
    return {
        outcome: 'suppressed',
        discreteTrigger: null,
        reason: 'below-threshold',
        urgency: 0.42,
        theta: SPEC.THETA_FULL,
        typingRate: 12,
        boundariesPresent: [],
        secondsSinceLastAlert: Number.POSITIVE_INFINITY,
        inWarmup: false,
        graceActive: false,
        gates: gates(),
        ...over,
    };
}

function tick(over: Partial<TickRecord> = {}): TickRecord {
    const f = over.features ?? features();
    return {
        t: 60,
        ts: 1_000_000,
        features: f,
        sBase: 0.42,
        s: 0.42,
        v: 0.5,
        fastDecay: false,
        boundariesPreGate: [],
        alert: null,
        decisionTrace: trace(),
        ...over,
    };
}

function snapshot(over: Partial<StruggleDebugSnapshot> = {}): StruggleDebugSnapshot {
    return {
        sessionActive: true,
        nowMs: 100_000,
        sessionStartMs: 0,
        lastAlertMs: null,
        lastFmBadMs: null,
        throttle: null,
        fN2Active: false,
        effectiveWindowS: 60,
        longestGapS: 18,
        decisionTrace: null,
        caps: {
            warmupS: SPEC.WARMUP_S,
            cooldownS: SPEC.COOLDOWN_S,
            graceS: SPEC.GRACE_S,
            minDeliveryGapS: 30,
            maxAlertsPerMinute: 2,
            maxAlertsPerSession: 6,
            n2MinActiveS: SPEC.N2_MIN_ACTIVE_S,
            gapNormS: SPEC.GAP_NORM_S,
        },
        ...over,
    };
}

describe('formatTick — Phase A per-tick debug line', () => {
    it('renders the headline urgency-vs-θ decision with the suppression reason', () => {
        const line = formatTick(tick({ decisionTrace: trace({ outcome: 'suppressed', reason: 'd1-warmup', urgency: 0.81, theta: 0.7 }) }));
        expect(line).toContain('urgency=0.81/θ0.70');
        expect(line).toContain('→ suppressed (d1-warmup)');
    });

    it('shows the discrete trigger when the discrete path fired', () => {
        const line = formatTick(tick({ decisionTrace: trace({ outcome: 'fired-discrete', discreteTrigger: 'test-stagnation' }) }));
        expect(line).toContain('→ fired-discrete (test-stagnation)');
    });

    it('shows no parenthetical for a fired edit alert', () => {
        const line = formatTick(tick({
            boundariesPreGate: ['FM'],
            decisionTrace: trace({ outcome: 'fired-edit', reason: 'fired', boundariesPresent: ['FM'], urgency: 0.9 }),
        }));
        expect(line).toContain('→ fired-edit |');
        expect(line).toContain('boundaries=[FM]');
    });

    it('renders the full severity decomposition (typ/gap + fb/a8/n2 bonuses)', () => {
        const line = formatTick(tick({
            sBase: 0.55,
            s: 0.78,
            features: features({ fTyping: 0.5, fGap: 0.6, fFb: 1, fA8: 0.3, fN2: 0.2 }),
        }));
        expect(line).toContain('sBase=0.55 s=0.78');
        expect(line).toContain('sev[typ=0.50 gap=0.60 fb=1.00 a8=0.30 n2=0.20]');
    });

    it('renders every gate as a 1/0 flag in a fixed order', () => {
        const line = formatTick(tick({
            decisionTrace: trace({ gates: gates({ fluentTyping: true, warmup: true, cooldown: true }) }),
        }));
        expect(line).toContain('gates[B2:1 B4:0 warmup:1 below:0 cd:1 rearm:0]');
    });

    it('derives the warmup countdown from t (480 − t)', () => {
        const line = formatTick(tick({ t: 120, features: features({ t: 120 }) }));
        expect(line).toContain(`warmup=${SPEC.WARMUP_S - 120}s`);
    });

    it('clamps the warmup countdown to 0 once past warmup', () => {
        const line = formatTick(tick({ t: 600, features: features({ t: 600 }) }));
        expect(line).toContain('warmup=0s');
    });

    it('shows the cooldown as – when no alert has fired yet', () => {
        const line = formatTick(tick({ decisionTrace: trace({ secondsSinceLastAlert: Number.POSITIVE_INFINITY }) }));
        expect(line).toContain('cd=–');
    });

    it('derives the cooldown countdown from secondsSinceLastAlert (120 − elapsed)', () => {
        const line = formatTick(tick({ decisionTrace: trace({ secondsSinceLastAlert: 30 }) }));
        expect(line).toContain('cd=90s');
    });

    it('clamps the cooldown countdown to 0 once past the cooldown', () => {
        const line = formatTick(tick({ decisionTrace: trace({ secondsSinceLastAlert: 200 }) }));
        expect(line).toContain('cd=0s');
    });

    it('renders gap vs the GAP_NORM constant and the effective window', () => {
        const line = formatTick(tick({ features: features({ longestGapS: 22, effectiveWindowS: 40 }) }));
        expect(line).toContain(`gap=22s/${SPEC.GAP_NORM_S}`);
        expect(line).toContain('win=40s');
    });

    it('renders typing rate, and – when the rate is unavailable', () => {
        expect(formatTick(tick({ decisionTrace: trace({ typingRate: 17 }) }))).toContain('typing=17/min');
        expect(formatTick(tick({ decisionTrace: trace({ typingRate: null }) }))).toContain('typing=–/min');
    });

    it('shows – for the boundary set when no boundary is pending', () => {
        expect(formatTick(tick())).toContain('boundaries=[–]');
    });
});

describe('formatTick — Phase B tail (throttle / grace / fN2)', () => {
    it('omits the Phase B tail entirely when no snapshot is passed', () => {
        const line = formatTick(tick());
        expect(line).not.toContain('throttle');
        expect(line).not.toContain('fN2=');
    });

    it('renders throttle[n/a] grace=– fN2=clear for an empty snapshot', () => {
        const line = formatTick(tick(), snapshot());
        expect(line).toContain('| throttle[n/a] grace=– fN2=clear');
    });

    it('renders the delivery counters + per-minute window + min-gap remaining', () => {
        // now=100s; deliveries at 40s (60s ago → outside window) and 95s (5s ago → inside);
        // min-gap remaining = 30 − 5 = 25s.
        const line = formatTick(tick(), snapshot({
            throttle: { deliveredThisSession: 2, deliveredAtMs: [40_000, 95_000], lastDeliveryMs: 95_000 },
        }));
        expect(line).toContain('throttle[sess=2/6 min=1/2 gap=25s]');
    });

    it('shows gap=– when nothing has been delivered yet', () => {
        const line = formatTick(tick(), snapshot({
            throttle: { deliveredThisSession: 0, deliveredAtMs: [], lastDeliveryMs: null },
        }));
        expect(line).toContain('gap=–');
    });

    it('clamps the min-gap remaining to 0 once the floor has elapsed', () => {
        const line = formatTick(tick(), snapshot({
            throttle: { deliveredThisSession: 1, deliveredAtMs: [0], lastDeliveryMs: 0 },
        }));
        expect(line).toContain('gap=0s');
    });

    it('derives the B4 grace countdown from lastFmBadMs (graceS − elapsed)', () => {
        // now=100s, armed at 80s → 32.94 − 20 ≈ 13s.
        const line = formatTick(tick(), snapshot({ lastFmBadMs: 80_000 }));
        expect(line).toContain('grace=13s');
    });

    it('shows fN2=active when the off-screen-error metric is set', () => {
        expect(formatTick(tick(), snapshot({ fN2Active: true }))).toContain('fN2=active');
    });
});
