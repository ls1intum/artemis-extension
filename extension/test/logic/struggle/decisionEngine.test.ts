import { describe, expect, it } from 'vitest';

import type { BoundaryType } from '@extension/services/struggle/config';
import { DecisionEngine } from '@extension/services/struggle/decision/decisionEngine';
import type { EngineTick } from '@extension/services/struggle/types';
import { asEditAlert } from '@test/__shared__/alertNarrow';

function mkTick(t: number, urgency: number, opts: {
    boundaries?: BoundaryType[];
    typingRate?: number | null;
    graceActive?: boolean;
    testStagnation?: boolean;
} = {}): EngineTick {
    return {
        t,
        urgency,
        editCandidate: {
            boundaries: opts.boundaries ?? (['STATE'] as BoundaryType[]),
            typingRate: opts.typingRate ?? null,
            graceActive: opts.graceActive ?? false,
        },
        discreteTriggers: { testStagnation: opts.testStagnation ?? false },
    };
}

describe('DecisionEngine (Schicht 3 — urgency-threshold owner)', () => {
    it('fires an armed alert when urgency >= θ and a boundary is present', () => {
        const d = new DecisionEngine({ warmupS: 0, cooldownS: 0 });
        const a = asEditAlert(d.decide(mkTick(10, 0.8)));
        expect(a.path).toBe('armed');
        expect(a.primary).toBe('STATE');
        expect(a.urgency).toBe(0.8);
    });

    it('setWarmupS(0) lifts the D1 warm-up gate live (dev skip-warmup)', () => {
        const d = new DecisionEngine({ cooldownS: 0 });        // warmupS defaults to SPEC.WARMUP_S
        // Inside the default warm-up a STATE boundary is D1-suppressed.
        expect(d.decide(mkTick(10, 0.8))).toBeNull();
        d.setWarmupS(0);
        const a = asEditAlert(d.decide(mkTick(20, 0.8)));
        expect(a.primary).toBe('STATE');
        expect(a.inWarmup).toBe(false);
    });

    it('stays silent when urgency < θ (boundary present)', () => {
        const d = new DecisionEngine({ warmupS: 0, cooldownS: 0 });
        expect(d.decide(mkTick(10, 0.69))).toBeNull();
    });

    it('stays silent when no boundary is pending', () => {
        const d = new DecisionEngine({ warmupS: 0, cooldownS: 0 });
        expect(d.decide(mkTick(10, 0.9, { boundaries: [] }))).toBeNull();
    });

    // The load-bearing v3 contract: the decision thresholds on urgency = S_base ONLY.
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

    // Stateful behavior: the hysteresis re-arm / in_state_since / E6 bookkeeping
    // follows urgency across ticks.
    it('hysteresis re-arms after an urgency dip below θ-hyst', () => {
        const d = new DecisionEngine({ warmupS: 0, cooldownS: 0 });
        const a1 = d.decide(mkTick(10, 0.8));  // armed -> fires
        const a2 = d.decide(mkTick(20, 0.5));  // urgency < θ-hyst -> re-arm, no alert
        const a3 = d.decide(mkTick(30, 0.8));  // re-armed -> fires AGAIN (armed)
        expect(asEditAlert(a1).path).toBe('armed');
        expect(a2).toBeNull();
        expect(asEditAlert(a3).path).toBe('armed');                // proves the dip re-armed on urgency
    });

    it('armed→E6 sequence fires on sustained urgency at the realert span', () => {
        const d = new DecisionEngine({ warmupS: 0 });              // cooldown/realert = 120
        const alerts: Array<{ t: number; path: string }> = [];
        for (let t = 10; t <= 130; t += 10) {
            const a = d.decide(mkTick(t, 0.8));
            if (a) { const e = asEditAlert(a); alerts.push({ t: e.t, path: e.path }); }
        }
        expect(alerts).toEqual([
            { t: 10, path: 'armed' },
            { t: 130, path: 'e6' },                                // E6 re-alert at realert span, on urgency
        ]);
    });
});

describe('DecisionEngine — discrete (Test-Stagnation) path', () => {
    it('fires a discrete alert when the edit path is blocked by B2 (fluent typing)', () => {
        const d = new DecisionEngine({ warmupS: 0, cooldownS: 0 });
        // urgency >= θ but B2 (typing_rate 25) blocks the edit path; the discrete
        // trigger is NOT B2-gated, so it fires on its own path.
        const a = d.decide(mkTick(10, 0.8, { typingRate: 25, testStagnation: true }));
        expect(a?.kind).toBe('discrete');
        expect(a && a.kind === 'discrete' ? a.trigger : null).toBe('test-stagnation');
    });

    it('fires even with no boundary present (the edit path produces nothing)', () => {
        const d = new DecisionEngine({ warmupS: 0, cooldownS: 0 });
        const a = d.decide(mkTick(10, 0.0, { boundaries: [], testStagnation: true }));
        expect(a?.kind).toBe('discrete');
    });

    it('Test-Stagnation BREAKS warmup (fires while t <= warmupS)', () => {
        const d = new DecisionEngine({ warmupS: 480, cooldownS: 0 });
        const a = d.decide(mkTick(100, 0.0, { boundaries: [], testStagnation: true }));
        expect(a?.kind).toBe('discrete');
        expect(a?.inWarmup).toBe(true);
    });

    it('does not fire when the ablation flag is off (validated-base mode)', () => {
        const d = new DecisionEngine({ warmupS: 0, cooldownS: 0 }, { enableTestStagnation: false });
        expect(d.decide(mkTick(10, 0.0, { boundaries: [], testStagnation: true }))).toBeNull();
    });

    it('an edit alert wins the tick over a co-firing discrete trigger', () => {
        const d = new DecisionEngine({ warmupS: 0, cooldownS: 0 });
        // STATE boundary + urgency >= θ -> edit fires; discrete is the fallback only.
        const a = d.decide(mkTick(10, 0.8, { testStagnation: true }));
        expect(a?.kind).toBe('edit');
    });

    // Shared cooldown: edit and discrete draw on ONE cooldown clock.
    it('an edit alert blocks a following discrete alert within the shared cooldown', () => {
        const d = new DecisionEngine({ warmupS: 0 });              // cooldown 120
        expect(d.decide(mkTick(10, 0.8))?.kind).toBe('edit');      // edit fires at 10
        // discrete trigger at 20 (no boundary so edit is silent) is cooldown-blocked.
        expect(d.decide(mkTick(20, 0.0, { boundaries: [], testStagnation: true }))).toBeNull();
        // once the cooldown clears (>=130) the discrete trigger fires.
        expect(d.decide(mkTick(130, 0.0, { boundaries: [], testStagnation: true }))?.kind).toBe('discrete');
    });

    it('a discrete alert blocks a following edit alert within the shared cooldown', () => {
        const d = new DecisionEngine({ warmupS: 0 });              // cooldown/realert 120
        // discrete fires at 10 (no boundary); it stamps the shared cooldown.
        expect(d.decide(mkTick(10, 0.0, { boundaries: [], testStagnation: true }))?.kind).toBe('discrete');
        // an edit candidate at 20 (boundary + urgency>=θ) is cooldown-blocked by the discrete alert.
        expect(d.decide(mkTick(20, 0.8))).toBeNull();
        // edit fires once the shared cooldown clears (130 - 10 = 120).
        expect(d.decide(mkTick(130, 0.8))?.kind).toBe('edit');
    });

    it('a discrete alert postpones the next edit-path E6 (shared cooldown moves, in_state_since does not)', () => {
        const d = new DecisionEngine({ warmupS: 0 });              // cooldown/realert 120
        expect(d.decide(mkTick(10, 0.8))?.kind).toBe('edit');      // armed edit at 10 (lastAlert=10, in_state_since=10)
        // urgency stays >= θ throughout (no re-arm); at 130 there is NO boundary so the
        // edit path is silent, but the discrete trigger fires (cooldown 130-10=120 clears)
        // and stamps the shared cooldown to 130.
        expect(d.decide(mkTick(130, 0.8, { boundaries: [], testStagnation: true }))?.kind).toBe('discrete');
        // WITHOUT the discrete alert, an edit boundary at 140 would E6 (140-10=130 >= 120
        // cooldown AND in_state_since span). WITH it, the cooldown clock is now 130, so 140 is blocked.
        expect(d.decide(mkTick(140, 0.8))).toBeNull();
        // The E6 finally fires once the shared cooldown clears again (250-130=120); in_state_since
        // is still 10, so the span condition holds — it is an E6, postponed from 140 to 250.
        const e6 = asEditAlert(d.decide(mkTick(250, 0.8)));
        expect(e6.path).toBe('e6');
    });
});

describe('DecisionEngine — lastTrace', () => {
    function tickWith(over: Partial<EngineTick>): EngineTick {
        return {
            t: 600, urgency: 0.9,
            editCandidate: { boundaries: ['FM'], typingRate: 0, graceActive: false },
            discreteTriggers: { testStagnation: false },
            ...over,
        };
    }

    it('lastTrace outcome is fired-edit when the edit path fires', () => {
        const d = new DecisionEngine(undefined, { enableTestStagnation: false });
        expect(d.decide(tickWith({}))?.kind).toBe('edit');
        expect(d.lastTrace.outcome).toBe('fired-edit');
        expect(d.lastTrace.reason).toBe('fired');
        expect(d.lastTrace.discreteTrigger).toBeNull();
    });

    it('lastTrace outcome is fired-discrete and names the trigger', () => {
        const d = new DecisionEngine(undefined, { enableTestStagnation: true });
        const alert = d.decide(tickWith({
            editCandidate: { boundaries: [], typingRate: 0, graceActive: false },
            discreteTriggers: { testStagnation: true },
        }));
        expect(alert?.kind).toBe('discrete');
        expect(d.lastTrace.outcome).toBe('fired-discrete');
        expect(d.lastTrace.discreteTrigger).toBe('test-stagnation');
        expect(d.lastTrace.reason).toBe('no-candidate'); // the edit path had no boundary
    });

    it('lastTrace outcome is suppressed with the edit reason when nothing fires', () => {
        const d = new DecisionEngine(undefined, { enableTestStagnation: false });
        expect(d.decide(tickWith({ urgency: 0.5 }))).toBeNull();
        expect(d.lastTrace.outcome).toBe('suppressed');
        expect(d.lastTrace.reason).toBe('below-threshold');
        expect(d.lastTrace.discreteTrigger).toBeNull();
    });
});
