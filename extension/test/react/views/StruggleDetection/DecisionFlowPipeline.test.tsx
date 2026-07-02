import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { LiveDecisionTrace, StruggleDebugSnapshot } from '@shared/messageContracts';

import { DecisionFlowPipeline } from '@webview/views/StruggleDetection/DecisionFlowPipeline';

const BASE = 1_700_000_000_000;

function trace(over: Partial<LiveDecisionTrace> = {}): LiveDecisionTrace {
    return {
        outcome: 'suppressed', reason: 'no-candidate', discreteTrigger: null,
        urgency: 0.8, theta: 0.7, typingRate: 0, boundariesPresent: [],
        secondsSinceLastAlert: null, inWarmup: false, graceActive: false,
        gates: { fluentTyping: false, grace: false, warmup: false, belowThreshold: false, cooldown: false, notRearmed: false },
        ...over,
    };
}

function snap(over: Partial<StruggleDebugSnapshot> = {}): StruggleDebugSnapshot {
    return {
        sessionActive: true, nowMs: BASE, sessionStartMs: BASE - 100_000, lastAlertMs: null, lastFmBadMs: null,
        throttle: null, fN2Active: false, effectiveWindowS: 60, longestGapS: 10, decisionTrace: trace(),
        caps: { warmupS: 480, cooldownS: 120, graceS: 32.94, minDeliveryGapS: 30, maxAlertsPerMinute: 2, maxAlertsPerSession: 6, n2MinActiveS: 60, gapNormS: 40 },
        ...over,
    };
}

describe('DecisionFlowPipeline', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(BASE);
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it('renders nothing when no session is active', () => {
        const { container } = render(<DecisionFlowPipeline debug={snap({ sessionActive: false })} />);
        expect(container).toBeEmptyDOMElement();
    });

    it('renders nothing before the first tick (null decision trace)', () => {
        const { container } = render(<DecisionFlowPipeline debug={snap({ decisionTrace: null })} />);
        expect(container).toBeEmptyDOMElement();
    });

    it('marks the cooldown stage as the blocker for a cooldown suppression, with a live countdown, and all earlier stages as passed', () => {
        const { container } = render(<DecisionFlowPipeline debug={snap({
            decisionTrace: trace({ reason: 'cooldown', boundariesPresent: ['STATE'], gates: { fluentTyping: false, grace: false, warmup: false, belowThreshold: false, cooldown: true, notRearmed: true } }),
            lastAlertMs: BASE - 30_000,   // 120 − 30 = 1:30 left
        })} />);
        expect(screen.getByText('Decision flow')).toBeInTheDocument();
        expect(screen.getByText(/blocking · 1:30 left/)).toBeInTheDocument();
        expect(screen.getByText(/cooling down/i)).toBeInTheDocument();   // verdict
        // The engine reached the cooldown check, so candidate, gates, and severity were PASSED.
        const statuses = Array.from(container.querySelectorAll('[data-status]')).map((e) => e.getAttribute('data-status'));
        expect(statuses).toEqual(['pass', 'pass', 'pass', 'block', 'neutral']);
    });

    it('renders the five stages in the engine evaluation order (candidate first, severity after the moment gates)', () => {
        render(<DecisionFlowPipeline debug={snap()} />);
        const names = screen.getAllByText(/^\d · /).map((e) => e.textContent);
        expect(names).toEqual(['1 · Candidate', '2 · Gates', '3 · Severity', '4 · Cooldown', '5 · Outcome']);
    });

    it('does not mark severity as passed when the flow stopped earlier (no boundary, urgency over θ) (regression)', () => {
        const { container } = render(<DecisionFlowPipeline debug={snap({
            decisionTrace: trace({ reason: 'no-candidate', urgency: 0.75, boundariesPresent: [] }),
        })} />);
        const stages = Array.from(container.querySelectorAll('[data-status]'));
        expect(stages).toHaveLength(5);
        expect(stages[0].getAttribute('data-status')).toBe('block');    // candidate is the blocker
        expect(stages[2].getAttribute('data-status')).toBe('neutral');  // severity NOT reached — must not read as passed
        expect(screen.getByText('over threshold')).toBeInTheDocument(); // its live condition is still stated
    });

    it('marks severity as the blocker below threshold, never as a gate-list "blocking" row', () => {
        render(<DecisionFlowPipeline debug={snap({ decisionTrace: trace({
            reason: 'below-threshold', urgency: 0.4,
            gates: { fluentTyping: false, grace: false, warmup: false, belowThreshold: true, cooldown: false, notRearmed: false },
        }) })} />);
        expect(screen.getByText('below threshold')).toBeInTheDocument();
        expect(screen.getByText(/has not reached the alert threshold/i)).toBeInTheDocument();
        // The threshold is the Severity stage, not a gate: it must NOT appear in the gate list,
        // and no gate row may be "blocking". The moment gates were passed on the way to it.
        expect(screen.queryByText('Urgency below threshold')).not.toBeInTheDocument();
        expect(screen.queryByText('blocking')).not.toBeInTheDocument();
        expect(screen.getByText('passed')).toBeInTheDocument();   // stage 2 (gates) was actually passed
    });

    it('shows the fired outcome, clears every gate row, and never claims delivery (FM broke through warm-up + grace)', () => {
        render(<DecisionFlowPipeline debug={snap({ decisionTrace: trace({
            outcome: 'fired-edit', reason: 'fired', boundariesPresent: ['FM'],
            // FM/E4 break through warm-up and FM/FM+ survive the grace filter, so these flags can
            // still be true on a fired tick — but the flow stopped nowhere, so no gate row may read
            // "engaged" (that would contradict the green "all clear" Gates stage box).
            gates: { fluentTyping: false, grace: true, warmup: true, belowThreshold: false, cooldown: false, notRearmed: false },
        }) })} />);
        expect(screen.getAllByText('Alert fired').length).toBeGreaterThanOrEqual(1);
        expect(screen.getByText(/an alert fired this tick/i)).toBeInTheDocument();
        expect(screen.getByText('alert raised')).toBeInTheDocument();          // decision-level, NOT a delivery claim
        expect(screen.queryByText('nudge sent')).not.toBeInTheDocument();
        expect(screen.queryByText('engaged')).not.toBeInTheDocument();         // warm-up/grace flags true but non-blocking on a fire
        expect(screen.getAllByText('clear')).toHaveLength(5);                  // all five gate rows clear
    });

    it('shows a separate discrete verdict (no faked edit flow) for a discrete fire', () => {
        render(<DecisionFlowPipeline debug={snap({ decisionTrace: trace({ outcome: 'fired-discrete', discreteTrigger: 'test-stagnation' }) })} />);
        expect(screen.getByText(/tests are stuck/i)).toBeInTheDocument();
        expect(screen.getByText(/discrete test-stagnation path/i)).toBeInTheDocument();
        expect(screen.queryByText(/Severity/)).not.toBeInTheDocument();   // no 4-stage flow
    });

    it('marks the candidate stage as the blocker when no boundary is pending', () => {
        render(<DecisionFlowPipeline debug={snap({ decisionTrace: trace({ reason: 'no-candidate', boundariesPresent: [] }) })} />);
        expect(screen.getByText('no boundary')).toBeInTheDocument();
        expect(screen.getByText(/no boundary event was pending/i)).toBeInTheDocument();
    });

    it('labels severity factually ("below threshold") when urgency is low, even though the blocker is the missing boundary (regression)', () => {
        render(<DecisionFlowPipeline debug={snap({ decisionTrace: trace({
            reason: 'no-candidate', urgency: 0.59, boundariesPresent: [],
            gates: { fluentTyping: false, grace: false, warmup: false, belowThreshold: true, cooldown: false, notRearmed: false },
        }) })} />);
        expect(screen.getByText('below threshold')).toBeInTheDocument();        // severity reflects urgency < θ
        expect(screen.queryByText('over threshold')).not.toBeInTheDocument();   // NOT mislabeled as over threshold
        expect(screen.getByText('no boundary')).toBeInTheDocument();            // candidate is the decisive blocker
    });

    it('shows the boundary short label and a warm-up gate countdown', () => {
        render(<DecisionFlowPipeline debug={snap({
            decisionTrace: trace({ reason: 'd1-warmup', boundariesPresent: ['STATE'], gates: { fluentTyping: false, grace: false, warmup: true, belowThreshold: false, cooldown: false, notRearmed: false } }),
            sessionStartMs: BASE - 60_000,   // warm-up 480 − 60 = 7:00 left
        })} />);
        expect(screen.getByText('Low typing rate')).toBeInTheDocument();   // STATE short label, candidate stage
        expect(screen.getByText(/blocking · 7:00 left/)).toBeInTheDocument();
    });

    it('shows a no-countdown gate block for fluent typing (B2 has no timer)', () => {
        render(<DecisionFlowPipeline debug={snap({ decisionTrace: trace({ reason: 'b2-fluent-typing', gates: { fluentTyping: true, grace: false, warmup: false, belowThreshold: false, cooldown: false, notRearmed: false } }) })} />);
        expect(screen.getByText(/typing fluently/i)).toBeInTheDocument();          // verdict
        expect(screen.getAllByText('blocking').length).toBeGreaterThanOrEqual(1);  // gate stage + decisive gate row
        expect(screen.queryByText(/blocking ·/)).not.toBeInTheDocument();          // B2 has no countdown
    });

    it('marks an engaged but non-decisive gate as "engaged", not "blocking" (warm-up while no boundary)', () => {
        render(<DecisionFlowPipeline debug={snap({ decisionTrace: trace({ reason: 'no-candidate', gates: { fluentTyping: false, grace: false, warmup: true, belowThreshold: false, cooldown: false, notRearmed: false } }) })} />);
        expect(screen.getByText('engaged')).toBeInTheDocument();         // warm-up condition holds
        expect(screen.queryByText('blocking')).not.toBeInTheDocument();  // but the missing boundary was the blocker, not a gate
    });

    it('lists the five detector gates with their plain-language labels, split into moment and history groups', () => {
        render(<DecisionFlowPipeline debug={snap()} />);
        expect(screen.getByText('Fluent typing')).toBeInTheDocument();
        expect(screen.getByText('Exercise warm-up')).toBeInTheDocument();
        expect(screen.getByText('Re-arm hysteresis')).toBeInTheDocument();
        expect(screen.queryByText('Urgency below threshold')).not.toBeInTheDocument();   // shown as the Severity stage instead
        expect(screen.getAllByText('clear')).toHaveLength(5);   // none engaged in the default trace
        expect(screen.getByText(/reads the student's moment/i)).toBeInTheDocument();
        expect(screen.getByText(/reads the engine's history/i)).toBeInTheDocument();
    });
});
