import { describe, expect, it } from 'vitest';

import { InterventionDecisionEngine } from '@extension/services/telemetry/decision/interventionDecisionEngine';
import { InterventionFilter } from '@extension/services/telemetry/interventionFilter';
import type { InterventionState } from '@extension/services/telemetry/types';

const SIX_MINUTES_MS = 6 * 60 * 1000;

function freshState(overrides: Partial<InterventionState> = {}): InterventionState {
    return {
        lastInterventionTime: 0,
        sessionInterventionCount: 0,
        lastDismissed: false,
        lastAccepted: false,
        ...overrides,
    };
}

/** A filter that is past the 5-minute warmup, so later gates are reachable. */
function warmedUpFilter(): InterventionFilter {
    const filter = new InterventionFilter();
    filter.setExerciseStartTime(Date.now() - SIX_MINUTES_MS);
    return filter;
}

describe('InterventionDecisionEngine blockedReason attribution', () => {
    it('reports warmup when the exercise has not run long enough', () => {
        const engine = new InterventionDecisionEngine(new InterventionFilter()); // never warmed up
        const result = engine.evaluate(0.4, 'sufficient', 'idle', freshState());
        expect(result.shouldIntervene).toBe(false);
        expect(result.blockedReason).toBe('warmup');
    });

    it('reports recent-progress when the student just made progress', () => {
        const filter = warmedUpFilter();
        filter.recordProgress();
        const engine = new InterventionDecisionEngine(filter);
        const result = engine.evaluate(0.4, 'sufficient', 'idle', freshState());
        expect(result.shouldIntervene).toBe(false);
        expect(result.blockedReason).toBe('recent-progress');
    });

    it('reports last-dismissed when a non-proactive intervention follows a dismissal', () => {
        const engine = new InterventionDecisionEngine(warmedUpFilter());
        const result = engine.evaluate(0.4, 'sufficient', 'idle', freshState({ lastDismissed: true }));
        expect(result.level).toBe('notification');
        expect(result.shouldIntervene).toBe(false);
        expect(result.blockedReason).toBe('last-dismissed');
    });

    it('reports session-limit when the per-session cap is reached', () => {
        const engine = new InterventionDecisionEngine(warmedUpFilter());
        const result = engine.evaluate(0.4, 'sufficient', 'idle', freshState({ sessionInterventionCount: 3 }));
        expect(result.shouldIntervene).toBe(false);
        expect(result.blockedReason).toBe('session-limit');
    });

    it('has no blockedReason when all guardrails pass', () => {
        const engine = new InterventionDecisionEngine(warmedUpFilter());
        const result = engine.evaluate(0.4, 'sufficient', 'idle', freshState());
        expect(result.shouldIntervene).toBe(true);
        expect(result.blockedReason).toBeUndefined();
    });

    it('allows a proactive intervention past the session limit for severe EQ (>= 0.85)', () => {
        const engine = new InterventionDecisionEngine(warmedUpFilter());
        const result = engine.evaluate(0.9, 'sufficient', 'idle', freshState({ sessionInterventionCount: 3 }));
        expect(result.level).toBe('proactive');
        expect(result.shouldIntervene).toBe(true);
        expect(result.blockedReason).toBeUndefined();
    });

    it('still blocks a proactive intervention past the session limit when EQ is below the severe override', () => {
        const engine = new InterventionDecisionEngine(warmedUpFilter());
        const result = engine.evaluate(0.7, 'sufficient', 'idle', freshState({ sessionInterventionCount: 3 }));
        expect(result.level).toBe('proactive');
        expect(result.shouldIntervene).toBe(false);
        expect(result.blockedReason).toBe('session-limit');
    });
});
