import { describe, expect, it, test } from 'vitest';

import { AlertStateMachine, type MachineParams } from '@extension/services/struggle/alerting/alertStateMachine';
import type { BoundaryType } from '@extension/services/struggle/config';
import { SPEC } from '@extension/services/struggle/config';

function ticksFor(durationS: number): number[] {
    const out: number[] = [];
    for (let t = 10; t <= durationS; t += 10) { out.push(t); }
    return out;
}

interface DriveSpec {
    urgency: (t: number, i: number) => number;
    boundaries?: (t: number, i: number) => BoundaryType[];
    typingRate?: (t: number, i: number) => number | null;
    fmBad?: number[];
    params?: Partial<MachineParams>;
}

function drive(durationS: number, spec: DriveSpec) {
    const m = new AlertStateMachine({ thetaFull: 0.6, graceS: 33, ...spec.params });
    const alerts: Array<{ t: number; path: string; types: readonly BoundaryType[]; inGrace: boolean }> = [];
    const fmBad = spec.fmBad ?? [];
    ticksFor(durationS).forEach((t, i) => {
        const lastFm = [...fmBad].reverse().find(f => f <= t);
        const grace = lastFm !== undefined && t - lastFm <= (spec.params?.graceS ?? 33);
        const a = m.tick({
            t,
            urgency: spec.urgency(t, i),
            boundaries: spec.boundaries ? spec.boundaries(t, i) : (['STATE'] as BoundaryType[]),
            typingRate: spec.typingRate ? spec.typingRate(t, i) : null,
            graceActive: grace,
        });
        if (a) { alerts.push({ t: a.t, path: a.path, types: a.types, inGrace: a.inGrace }); }
    });
    return alerts;
}

describe('AlertStateMachine (Python run_state_machine port)', () => {
    it('T3a: 0.55 >= theta-0.1 -> NO re-arm', () => {
        const vs = [0.7, 0.55, 0.7];
        const alerts = drive(30, { urgency: (_t, i) => vs[i], params: { warmupS: 0, cooldownS: 0 } });
        expect(alerts.map(a => a.t)).toEqual([10]);
    });

    it('records live per-gate conditions every tick, independent of a boundary', () => {
        const m = new AlertStateMachine({ thetaFull: 0.6, warmupS: 60, cooldownS: 120 });
        // Idle, in warm-up, urgency below θ, NO boundary (reason = no-candidate):
        // the warm-up and below-threshold gates are still reported as engaged.
        m.tick({ t: 10, urgency: 0.3, boundaries: [], typingRate: 0, graceActive: false });
        expect(m.lastTrace.reason).toBe('no-candidate');
        expect(m.lastTrace.gates).toMatchObject({
            warmup: true, belowThreshold: true, fluentTyping: false, grace: false, cooldown: false, notRearmed: false,
        });

        // Typing fast flips fluentTyping on, still with no boundary.
        m.tick({ t: 20, urgency: 0.3, boundaries: [], typingRate: 200, graceActive: false });
        expect(m.lastTrace.gates.fluentTyping).toBe(true);

        // Past warm-up and urgency over θ: both of those gates go clear.
        m.tick({ t: 70, urgency: 0.9, boundaries: [], typingRate: 0, graceActive: false });
        expect(m.lastTrace.gates).toMatchObject({ warmup: false, belowThreshold: false });
    });
    it('setWarmupS(0) lifts the D1 warm-up gate live (dev skip-warmup)', () => {
        // Default warm-up (SPEC.WARMUP_S = 480 s): a STATE boundary at t=10 is inside it.
        const m = new AlertStateMachine({ thetaFull: 0.6, cooldownS: 0 });
        const input = { urgency: 0.7, boundaries: ['STATE'] as BoundaryType[], typingRate: null, graceActive: false };
        expect(m.tick({ t: 10, ...input })).toBeNull();
        expect(m.lastTrace.reason).toBe('d1-warmup');
        // Skipping warm-up makes the next in-window tick fire.
        m.setWarmupS(0);
        const alert = m.tick({ t: 20, ...input });
        expect(alert).not.toBeNull();
        expect(alert?.primary).toBe('STATE');
        expect(alert?.inWarmup).toBe(false);
    });
    it('T3b: 0.45 < theta-0.1 -> re-arm + alert', () => {
        const vs = [0.7, 0.45, 0.7];
        const alerts = drive(30, { urgency: (_t, i) => vs[i], params: { warmupS: 0, cooldownS: 0 } });
        expect(alerts.map(a => a.t)).toEqual([10, 30]);
    });
    it('T4: cooldown blocks until 120 s despite re-arm', () => {
        const alerts = drive(140, { urgency: (_t, i) => (i % 2 === 0 ? 0.7 : 0.45), params: { warmupS: 0 } });
        expect(alerts.map(a => a.t)).toEqual([10, 130]);
    });
    it('T5a/T5b: E6 re-alerts at 10/130/250 with paths armed/e6/e6', () => {
        const alerts = drive(260, { urgency: () => 0.8, params: { warmupS: 0 } });
        expect(alerts.map(a => a.t)).toEqual([10, 130, 250]);
        expect(alerts.map(a => a.path)).toEqual(['armed', 'e6', 'e6']);
    });
    it('T6a: FM exception fires at the FM tick despite grace', () => {
        const fmBad = [95];
        const alerts = drive(140, {
            urgency: t => (t >= 100 ? 0.8 : 0.3),
            boundaries: t => (t === 100 ? (['FM', 'STATE'] as BoundaryType[]) : (['STATE'] as BoundaryType[])),
            fmBad,
            params: { warmupS: 0, graceS: 32.94 },
        });
        expect(alerts[0]?.t).toBe(100);
        expect(alerts[0]?.types).toEqual(['FM']);
        expect(alerts[0]?.inGrace).toBe(true);
    });
    it('T6b: grace suppresses the state boundary until 95 + 32.94 s', () => {
        const alerts = drive(140, {
            urgency: t => (t >= 100 ? 0.8 : 0.3),
            fmBad: [95],
            params: { warmupS: 0, graceS: 32.94 },
        });
        expect(alerts[0]?.t).toBe(130);
    });
    for (const [type, expected] of [['FM', true], ['E4', true], ['N1', false]] as const) {
        it(`T7 warmup: ${type} ${expected ? 'breaks through' : 'is blocked'}`, () => {
            const alerts = drive(480, {
                urgency: () => 0.8,
                boundaries: t => (t === 100 ? ([type] as BoundaryType[]) : []),
                params: { graceS: 33 },
            });
            expect(alerts.length === 1 && alerts[0].t === 100).toBe(expected);
        });
    }
    it('T9a: B2 blocks at typing_rate >= 20', () => {
        const alerts = drive(30, { urgency: () => 0.8, typingRate: () => 25, params: { warmupS: 0 } });
        expect(alerts).toHaveLength(0);
    });
    it('T9b: B2 lets typing_rate < 20 through', () => {
        const alerts = drive(30, { urgency: () => 0.8, typingRate: () => 10, params: { warmupS: 0 } });
        expect(alerts).toHaveLength(1);
    });
});

test('lastTrace reports B2 suppression while typing fluently', () => {
    const m = new AlertStateMachine();
    m.tick({ t: 20, urgency: 0.9, boundaries: ['STATE'], typingRate: SPEC.B2_TYPING_PER_MIN, graceActive: false });
    expect(m.lastTrace.reason).toBe('b2-fluent-typing');
    expect(m.lastTrace.boundariesPresent).toEqual(['STATE']);
});

test('lastTrace reports below-threshold at a boundary under theta', () => {
    const m = new AlertStateMachine();
    m.tick({ t: 600, urgency: 0.5, boundaries: ['STATE'], typingRate: 0, graceActive: false });
    expect(m.lastTrace.reason).toBe('below-threshold');
});

test('lastTrace reports fired when an alert fires', () => {
    const m = new AlertStateMachine();
    expect(m.tick({ t: 600, urgency: 0.9, boundaries: ['FM'], typingRate: 0, graceActive: false })).not.toBeNull();
    expect(m.lastTrace.reason).toBe('fired');
});

test('lastTrace reports no-candidate when no boundary is pending', () => {
    const m = new AlertStateMachine();
    m.tick({ t: 600, urgency: 0.9, boundaries: [], typingRate: 0, graceActive: false });
    expect(m.lastTrace.reason).toBe('no-candidate');
});

test('lastTrace reports d1-warmup when warmup clears a non-FM/E4 boundary', () => {
    const m = new AlertStateMachine();
    m.tick({ t: 100, urgency: 0.9, boundaries: ['STATE'], typingRate: 0, graceActive: false });
    expect(m.lastTrace.reason).toBe('d1-warmup');
});

test('lastTrace reports b4-grace-filter when grace removes a non-FM STATE boundary', () => {
    const m = new AlertStateMachine();
    m.tick({ t: 600, urgency: 0.9, boundaries: ['STATE'], typingRate: 0, graceActive: true });
    expect(m.lastTrace.reason).toBe('b4-grace-filter');
});

// Interaction: FM survives both grace and warmup -> fires even inside warmup.
test('FM survives grace + warmup and fires', () => {
    const m = new AlertStateMachine();
    expect(m.tick({ t: 100, urgency: 0.9, boundaries: ['FM'], typingRate: 0, graceActive: true })).not.toBeNull();
    expect(m.lastTrace.reason).toBe('fired');
});

test('lastTrace reports cooldown after a recent alert', () => {
    const m = new AlertStateMachine();
    m.tick({ t: 600, urgency: 0.9, boundaries: ['FM'], typingRate: 0, graceActive: false }); // fires
    m.tick({ t: 610, urgency: 0.9, boundaries: ['FM'], typingRate: 0, graceActive: false }); // 10 < COOLDOWN_S
    expect(m.lastTrace.reason).toBe('cooldown');
});
