import { describe, expect, it } from 'vitest';

import type { BoundaryType } from '@extension/services/struggle/constants';
import { DecisionEngine } from '@extension/services/struggle/decision/decisionEngine';
import type { EngineTick } from '@extension/services/struggle/types';

/** Build an EngineTick. The telemetry V defaults to the urgency value, but tests
 *  can decouple them to prove the decision reads urgency and IGNORES V. */
function mkTick(t: number, urgency: number, opts: {
    boundaries?: BoundaryType[];
    typingRate?: number | null;
    graceActive?: boolean;
    telemetryV?: number;
} = {}): EngineTick {
    return {
        t,
        urgency,
        editCandidate: {
            boundaries: opts.boundaries ?? (['STATE'] as BoundaryType[]),
            typingRate: opts.typingRate ?? null,
            graceActive: opts.graceActive ?? false,
        },
        telemetry: { s: urgency, v: opts.telemetryV ?? urgency, fastDecay: false },
    };
}

describe('DecisionEngine (Schicht 3 — urgency-threshold owner)', () => {
    it('fires an armed alert when urgency >= θ and a boundary is present', () => {
        const d = new DecisionEngine({ warmupS: 0, cooldownS: 0 });
        const a = d.decide(mkTick(10, 0.8));
        expect(a).not.toBeNull();
        expect(a!.path).toBe('armed');
        expect(a!.primary).toBe('STATE');
        expect(a!.urgency).toBe(0.8);
    });

    it('stays silent when urgency < θ (boundary present)', () => {
        const d = new DecisionEngine({ warmupS: 0, cooldownS: 0 });
        expect(d.decide(mkTick(10, 0.69))).toBeNull();
    });

    it('stays silent when no boundary is pending', () => {
        const d = new DecisionEngine({ warmupS: 0, cooldownS: 0 });
        expect(d.decide(mkTick(10, 0.9, { boundaries: [] }))).toBeNull();
    });

    // The load-bearing v3 contract (codex-1: do NOT overload v). The decision
    // thresholds on urgency = S_base ONLY; telemetry V never enters the decision.
    it('thresholds on urgency, not telemetry V: urgency>=θ with V=0 still fires', () => {
        const d = new DecisionEngine({ warmupS: 0, cooldownS: 0 });
        const a = d.decide(mkTick(10, 0.8, { telemetryV: 0 }));
        expect(a).not.toBeNull();
        expect(a!.urgency).toBe(0.8);
    });

    it('thresholds on urgency, not telemetry V: urgency<θ with V=0.9 stays silent', () => {
        const d = new DecisionEngine({ warmupS: 0, cooldownS: 0 });
        expect(d.decide(mkTick(10, 0.5, { telemetryV: 0.9 }))).toBeNull();
    });

    it('B2 blocks while typing_rate >= 20 even with urgency >= θ', () => {
        const d = new DecisionEngine({ warmupS: 0, cooldownS: 0 });
        expect(d.decide(mkTick(10, 0.8, { typingRate: 25 }))).toBeNull();
    });

    it('reset() re-arms and clears the cooldown', () => {
        const d = new DecisionEngine({ warmupS: 0 });          // cooldown stays 120
        expect(d.decide(mkTick(10, 0.8))).not.toBeNull();      // armed -> fires
        expect(d.decide(mkTick(20, 0.8))).toBeNull();          // cooldown blocks
        d.reset();
        expect(d.decide(mkTick(30, 0.8))).not.toBeNull();      // re-armed + cooldown cleared
    });

    // Stateful divergence: the hysteresis re-arm / in_state_since / E6 bookkeeping
    // must follow urgency across ticks, NOT telemetry V. These hold V at a fixed
    // value that would produce DIFFERENT behavior under a V-driven machine.
    it('hysteresis re-arm follows urgency even while telemetry V stays above θ', () => {
        const d = new DecisionEngine({ warmupS: 0, cooldownS: 0 });
        // V pinned at 0.9 (>= θ) throughout: a V-driven machine would never re-arm.
        const a1 = d.decide(mkTick(10, 0.8, { telemetryV: 0.9 }));  // armed -> fires
        const a2 = d.decide(mkTick(20, 0.5, { telemetryV: 0.9 }));  // urgency < θ-hyst -> re-arm, no alert
        const a3 = d.decide(mkTick(30, 0.8, { telemetryV: 0.9 }));  // re-armed -> fires AGAIN (armed)
        expect(a1?.path).toBe('armed');
        expect(a2).toBeNull();
        expect(a3?.path).toBe('armed');                            // proves the dip re-armed on urgency
    });

    it('armed→E6 sequence fires on urgency even while telemetry V stays below θ', () => {
        const d = new DecisionEngine({ warmupS: 0 });              // cooldown/realert = 120
        const alerts: Array<{ t: number; path: string }> = [];
        // V pinned at 0.2 (< θ): a V-driven machine could never fire here at all.
        for (let t = 10; t <= 130; t += 10) {
            const a = d.decide(mkTick(t, 0.8, { telemetryV: 0.2 }));
            if (a) { alerts.push({ t: a.t, path: a.path }); }
        }
        expect(alerts).toEqual([
            { t: 10, path: 'armed' },
            { t: 130, path: 'e6' },                                // E6 re-alert at realert span, on urgency
        ]);
    });
});
