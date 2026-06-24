import { describe, expect, it } from 'vitest';

import type { AlertRecord, TickRecord } from '@extension/services/struggle/types';

import { compareExact, summarizeCausal } from './goldenCompare';
import type { GoldenAlert, GoldenSession, GoldenTick } from './goldenTypes';
import { emptyDecisionTrace } from '@test/__shared__/tickRecordFixture';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeTick(overrides: Partial<GoldenTick> = {}): GoldenTick {
    return {
        t: 10,
        effectiveWindowS: 10,
        nOneCharInserts: 0,
        typingRate: 5,
        longestGapS: 0,
        fTyping: 0.75,
        fGap: 0,
        fFb: 0,
        fA8: 0,
        fN2: 0,
        tsState: false,
        sBase: 0.1,
        s: 0.2,
        v: 0.5,
        fastDecay: false,
        boundaries: [],
        ...overrides,
    };
}

function makeAlert(overrides: Partial<GoldenAlert> = {}): GoldenAlert {
    return {
        t: 10,
        urgency: 0.65,
        typesPreGate: ['FM'],
        types: ['FM'],
        primary: 'FM',
        path: 'armed',
        inWarmup: false,
        inGrace: false,
        ...overrides,
    };
}

function makeGolden(overrides: { ticks?: GoldenTick[]; alerts?: GoldenAlert[] } = {}): GoldenSession {
    return {
        pid: 'P1',
        durationS: 600,
        theta: 0.6,
        graceS: 30,
        ticks: overrides.ticks ?? [makeTick()],
        alerts: overrides.alerts ?? [],
        inject: { fA8: [], fN2: [], pasteEventTimes: [] },
    };
}

/** Build a TickRecord matching a GoldenTick. */
function makeReplayTick(gt: GoldenTick): TickRecord {
    return {
        t: gt.t,
        ts: gt.t * 1000,
        features: {
            t: gt.t,
            effectiveWindowS: gt.effectiveWindowS,
            nOneCharInserts: gt.nOneCharInserts,
            typingRate: gt.typingRate,
            longestGapS: gt.longestGapS,
            fTyping: gt.fTyping,
            fGap: gt.fGap,
            fFb: gt.fFb,
            fA8: gt.fA8,
            fN2: gt.fN2,
            tsState: gt.tsState,
        },
        sBase: gt.sBase,
        s: gt.s,
        v: gt.v,
        fastDecay: gt.fastDecay,
        boundariesPreGate: [...gt.boundaries],
        alert: null,
        decisionTrace: emptyDecisionTrace,
    };
}

/** Build an AlertRecord matching a GoldenAlert. */
function makeReplayAlert(ga: GoldenAlert): AlertRecord {
    return {
        kind: 'edit',
        t: ga.t,
        ts: ga.t * 1000,
        urgency: ga.urgency,
        // The golden carries only the urgency decision signal; the telemetry V is
        // compared at the tick level, not here, so this fixture mirrors urgency.
        v: ga.urgency,
        typesPreGate: [...ga.typesPreGate],
        types: [...ga.types],
        primary: ga.primary,
        path: ga.path,
        inWarmup: ga.inWarmup,
        inGrace: ga.inGrace,
    };
}

// ── compareExact ──────────────────────────────────────────────────────────────

describe('compareExact', () => {
    it('returns ok:true when replay exactly matches golden', () => {
        const gt = makeTick();
        const golden = makeGolden({ ticks: [gt] });
        const replay = {
            durationS: 600,
            ticks: [makeReplayTick(gt)],
            alerts: [],
        };
        expect(compareExact(replay, golden)).toEqual({ ok: true });
    });

    it('returns ok:true when numeric difference is within TOL (1e-7)', () => {
        const gt = makeTick({ v: 0.5 });
        const golden = makeGolden({ ticks: [gt] });
        const replayTick = makeReplayTick(gt);
        // perturb v by 1e-7, which is within TOL=1e-6
        const replay = {
            durationS: 600,
            ticks: [{ ...replayTick, v: replayTick.v + 1e-7 }],
            alerts: [],
        };
        expect(compareExact(replay, golden)).toEqual({ ok: true });
    });

    it('returns ok:false with tickField divergence when v differs by 1e-5', () => {
        const gt = makeTick({ v: 0.5 });
        const golden = makeGolden({ ticks: [gt] });
        const replayTick = makeReplayTick(gt);
        const replay = {
            durationS: 600,
            ticks: [{ ...replayTick, v: replayTick.v + 1e-5 }],
            alerts: [],
        };
        const result = compareExact(replay, golden);
        expect(result.ok).toBe(false);
        expect(result.firstDivergence?.kind).toBe('tickField');
        expect(result.firstDivergence?.t).toBe(10);
        expect(result.firstDivergence?.field).toBe('v');
    });

    it('returns ok:false with tickCount divergence when tick counts differ', () => {
        const gt = makeTick();
        const golden = makeGolden({ ticks: [gt, makeTick({ t: 20 })] });
        const replay = {
            durationS: 600,
            ticks: [makeReplayTick(gt)],
            alerts: [],
        };
        const result = compareExact(replay, golden);
        expect(result.ok).toBe(false);
        expect(result.firstDivergence?.kind).toBe('tickCount');
    });

    it('returns ok:false with alertField divergence when alert primary differs', () => {
        const ga = makeAlert({ primary: 'FM' });
        const golden = makeGolden({ ticks: [makeTick()], alerts: [ga] });
        const replayAlert = makeReplayAlert(ga);
        const replay = {
            durationS: 600,
            ticks: [makeReplayTick(makeTick())],
            alerts: [{ ...replayAlert, primary: 'N1' as const }],
        };
        const result = compareExact(replay, golden);
        expect(result.ok).toBe(false);
        expect(result.firstDivergence?.kind).toBe('alertField');
        expect(result.firstDivergence?.field).toBe('primary');
    });

    it('returns ok:false when typesPreGate arrays differ', () => {
        const ga = makeAlert({ typesPreGate: ['FM'] });
        const golden = makeGolden({ ticks: [makeTick()], alerts: [ga] });
        const replayAlert = makeReplayAlert(ga);
        const replay = {
            durationS: 600,
            ticks: [makeReplayTick(makeTick())],
            alerts: [{ ...replayAlert, typesPreGate: ['N1'] as const }],
        };
        const result = compareExact(replay, golden);
        expect(result.ok).toBe(false);
        expect(result.firstDivergence?.kind).toBe('alertField');
        expect(result.firstDivergence?.field).toBe('typesPreGate');
    });

    it('returns ok:false with alertCount when alert counts differ', () => {
        const ga = makeAlert();
        const golden = makeGolden({ ticks: [makeTick()], alerts: [ga] });
        const replay = {
            durationS: 600,
            ticks: [makeReplayTick(makeTick())],
            alerts: [],
        };
        const result = compareExact(replay, golden);
        expect(result.ok).toBe(false);
        expect(result.firstDivergence?.kind).toBe('alertCount');
    });
});

// ── summarizeCausal ───────────────────────────────────────────────────────────

describe('summarizeCausal', () => {
    it('returns correct counts and maxAbsSDelta without throwing', () => {
        const gt1 = makeTick({ t: 10, fA8: 0, s: 0.2, v: 0.5 });
        const gt2 = makeTick({ t: 20, fA8: 1, s: 0.4, v: 0.6 });
        const golden = makeGolden({ ticks: [gt1, gt2] });

        // replay: fA8 disagrees at t=20, s differs by 0.1 at t=20
        const rt1 = makeReplayTick(gt1);
        const rt2: TickRecord = {
            ...makeReplayTick(gt2),
            features: { ...makeReplayTick(gt2).features, fA8: 0 }, // disagrees
            s: 0.3, // delta = 0.1
        };
        const replay = { durationS: 600, ticks: [rt1, rt2], alerts: [] };

        const report = summarizeCausal(replay, golden);
        expect(report.ticksCompared).toBe(2);
        expect(report.tickCountDelta).toBe(0);
        expect(report.fA8DisagreeTicks).toBe(1);
        expect(report.fN2DisagreeTicks).toBe(0);
        expect(report.maxAbsSDelta).toBeCloseTo(0.1, 10);
        expect(report.alertCountReplay).toBe(0);
        expect(report.alertCountGolden).toBe(0);
        expect(report.alertCountDelta).toBe(0);
    });

    it('reports pasteBoundaryDisagreeTicks correctly', () => {
        // golden boundaries has N1; replay does not
        const gt = makeTick({ t: 10, boundaries: ['N1'] });
        const golden = makeGolden({ ticks: [gt] });
        const rt: TickRecord = {
            ...makeReplayTick(gt),
            boundariesPreGate: [], // N1 absent
        };
        const replay = { durationS: 600, ticks: [rt], alerts: [] };

        const report = summarizeCausal(replay, golden);
        expect(report.pasteBoundaryDisagreeTicks).toBe(1);
    });

    it('reports alert-time parity by tick-time', () => {
        const golden = makeGolden({
            ticks: [makeTick({ t: 10 })],
            alerts: [
                makeAlert({ t: 10, primary: 'STATE', path: 'armed' }),
                makeAlert({ t: 130, primary: 'STATE', path: 'e6' }),
            ],
        });
        const replay = {
            durationS: 600,
            ticks: [makeReplayTick(makeTick({ t: 10 }))],
            alerts: [
                makeReplayAlert(makeAlert({ t: 10, primary: 'FM', path: 'armed' })), // shared t, primary differs
                makeReplayAlert(makeAlert({ t: 250, primary: 'STATE', path: 'armed' })), // only in replay
            ],
        };
        const report = summarizeCausal(replay, golden);
        expect(report.alertTimesOnlyInReplay).toBe(1); // t=250
        expect(report.alertTimesOnlyInGolden).toBe(1); // t=130
        expect(report.alertSharedTimeFieldMismatches).toBe(1); // t=10 FM vs STATE
    });
});
