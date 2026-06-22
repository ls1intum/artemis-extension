import type { AlertRecord, TickRecord } from '@extension/services/struggle/types';

import type { GoldenAlert, GoldenSession, GoldenTick } from './goldenTypes';
import type { ReplayResult } from './struggleReplay';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ExactDivergence {
    readonly kind: 'tickCount' | 'tickField' | 'alertCount' | 'alertField';
    readonly t?: number;
    readonly index?: number;
    readonly field?: string;
    readonly replay?: unknown;
    readonly golden?: unknown;
    readonly message: string;
}

export interface ExactReport {
    readonly ok: boolean;
    readonly firstDivergence?: ExactDivergence;
}

export interface CausalReport {
    readonly ticksCompared: number;
    readonly tickCountDelta: number;
    readonly fA8DisagreeTicks: number;
    readonly fN2DisagreeTicks: number;
    readonly pasteBoundaryDisagreeTicks: number;
    readonly maxAbsSDelta: number;
    readonly maxAbsVDelta: number;
    readonly alertCountReplay: number;
    readonly alertCountGolden: number;
    readonly alertCountDelta: number;
    /** Alert tick-times present in the replay but not the reference. */
    readonly alertTimesOnlyInReplay: number;
    /** Alert tick-times present in the reference but not the replay. */
    readonly alertTimesOnlyInGolden: number;
    /** Alerts at a shared tick-time that differ in primary boundary or path. */
    readonly alertSharedTimeFieldMismatches: number;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const TOL = 1e-6;

// ── Helpers ───────────────────────────────────────────────────────────────────

function approxEq(a: number, b: number): boolean {
    return Math.abs(a - b) <= TOL;
}

function arraysEqual<T>(a: readonly T[], b: readonly T[]): boolean {
    if (a.length !== b.length) {return false;}
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) {return false;}
    }
    return true;
}

// ── compareExact ──────────────────────────────────────────────────────────────

function compareTickFields(
    rt: TickRecord,
    gt: GoldenTick,
    index: number,
): ExactDivergence | null {
    const t = gt.t;

    const numericFields: Array<{ field: string; replay: number; golden: number }> = [
        { field: 'effectiveWindowS', replay: rt.features.effectiveWindowS, golden: gt.effectiveWindowS },
        { field: 'nOneCharInserts', replay: rt.features.nOneCharInserts, golden: gt.nOneCharInserts },
        { field: 'typingRate', replay: rt.features.typingRate, golden: gt.typingRate },
        { field: 'longestGapS', replay: rt.features.longestGapS, golden: gt.longestGapS },
        { field: 'fTyping', replay: rt.features.fTyping, golden: gt.fTyping },
        { field: 'fGap', replay: rt.features.fGap, golden: gt.fGap },
        { field: 'fFb', replay: rt.features.fFb, golden: gt.fFb },
        { field: 'fA8', replay: rt.features.fA8, golden: gt.fA8 },
        { field: 'fN2', replay: rt.features.fN2, golden: gt.fN2 },
        { field: 'sBase', replay: rt.sBase, golden: gt.sBase },
        { field: 's', replay: rt.s, golden: gt.s },
        { field: 'v', replay: rt.v, golden: gt.v },
    ];

    for (const { field, replay, golden } of numericFields) {
        if (!approxEq(replay, golden)) {
            return {
                kind: 'tickField',
                t,
                index,
                field,
                replay,
                golden,
                message: `tick[${index}] t=${t}: field "${field}" diverged (replay=${replay}, golden=${golden}, diff=${Math.abs(replay - golden)})`,
            };
        }
    }

    if (rt.features.tsState !== gt.tsState) {
        return {
            kind: 'tickField',
            t,
            index,
            field: 'tsState',
            replay: rt.features.tsState,
            golden: gt.tsState,
            message: `tick[${index}] t=${t}: field "tsState" diverged (replay=${rt.features.tsState}, golden=${gt.tsState})`,
        };
    }

    if (rt.fastDecay !== gt.fastDecay) {
        return {
            kind: 'tickField',
            t,
            index,
            field: 'fastDecay',
            replay: rt.fastDecay,
            golden: gt.fastDecay,
            message: `tick[${index}] t=${t}: field "fastDecay" diverged (replay=${rt.fastDecay}, golden=${gt.fastDecay})`,
        };
    }

    if (!arraysEqual(rt.boundariesPreGate, gt.boundaries)) {
        return {
            kind: 'tickField',
            t,
            index,
            field: 'boundariesPreGate',
            replay: [...rt.boundariesPreGate],
            golden: [...gt.boundaries],
            message: `tick[${index}] t=${t}: field "boundariesPreGate" diverged (replay=${JSON.stringify(rt.boundariesPreGate)}, golden=${JSON.stringify(gt.boundaries)})`,
        };
    }

    return null;
}

function compareAlertFields(
    ra: AlertRecord,
    ga: GoldenAlert,
    index: number,
): ExactDivergence | null {
    const t = ga.t;

    // Goldens are validated-base (edit-only); a discrete add-on alert here is a
    // real divergence (and lets the rest of this fn narrow `ra` to an edit alert).
    if (ra.kind !== 'edit') {
        return {
            kind: 'alertField',
            t,
            index,
            field: 'kind',
            replay: ra.kind,
            golden: 'edit',
            message: `alert[${index}] t=${t}: replay produced a discrete '${ra.trigger}' alert where the golden has an edit alert`,
        };
    }

    if (!approxEq(ra.v, ga.v)) {
        return {
            kind: 'alertField',
            t,
            index,
            field: 'v',
            replay: ra.v,
            golden: ga.v,
            message: `alert[${index}] t=${t}: field "v" diverged (replay=${ra.v}, golden=${ga.v})`,
        };
    }

    if (!arraysEqual(ra.typesPreGate, ga.typesPreGate)) {
        return {
            kind: 'alertField',
            t,
            index,
            field: 'typesPreGate',
            replay: [...ra.typesPreGate],
            golden: [...ga.typesPreGate],
            message: `alert[${index}] t=${t}: field "typesPreGate" diverged`,
        };
    }

    if (!arraysEqual(ra.types, ga.types)) {
        return {
            kind: 'alertField',
            t,
            index,
            field: 'types',
            replay: [...ra.types],
            golden: [...ga.types],
            message: `alert[${index}] t=${t}: field "types" diverged`,
        };
    }

    if (ra.primary !== ga.primary) {
        return {
            kind: 'alertField',
            t,
            index,
            field: 'primary',
            replay: ra.primary,
            golden: ga.primary,
            message: `alert[${index}] t=${t}: field "primary" diverged (replay=${ra.primary}, golden=${ga.primary})`,
        };
    }

    if (ra.path !== ga.path) {
        return {
            kind: 'alertField',
            t,
            index,
            field: 'path',
            replay: ra.path,
            golden: ga.path,
            message: `alert[${index}] t=${t}: field "path" diverged (replay=${ra.path}, golden=${ga.path})`,
        };
    }

    if (ra.inWarmup !== ga.inWarmup) {
        return {
            kind: 'alertField',
            t,
            index,
            field: 'inWarmup',
            replay: ra.inWarmup,
            golden: ga.inWarmup,
            message: `alert[${index}] t=${t}: field "inWarmup" diverged`,
        };
    }

    if (ra.inGrace !== ga.inGrace) {
        return {
            kind: 'alertField',
            t,
            index,
            field: 'inGrace',
            replay: ra.inGrace,
            golden: ga.inGrace,
            message: `alert[${index}] t=${t}: field "inGrace" diverged`,
        };
    }

    return null;
}

/**
 * Tick-for-tick exact comparison of a replay result against a golden session.
 * Returns on the first divergence with full context.
 */
export function compareExact(replay: ReplayResult, golden: GoldenSession): ExactReport {
    if (replay.ticks.length !== golden.ticks.length) {
        return {
            ok: false,
            firstDivergence: {
                kind: 'tickCount',
                replay: replay.ticks.length,
                golden: golden.ticks.length,
                message: `tick count mismatch: replay has ${replay.ticks.length}, golden has ${golden.ticks.length}`,
            },
        };
    }

    for (let i = 0; i < golden.ticks.length; i++) {
        const gt = golden.ticks[i];
        const rt = replay.ticks[i];

        if (rt.t !== gt.t) {
            return {
                ok: false,
                firstDivergence: {
                    kind: 'tickField',
                    t: gt.t,
                    index: i,
                    field: 't',
                    replay: rt.t,
                    golden: gt.t,
                    message: `tick[${i}]: time mismatch (replay t=${rt.t}, golden t=${gt.t})`,
                },
            };
        }

        const div = compareTickFields(rt, gt, i);
        if (div !== null) {
            return { ok: false, firstDivergence: div };
        }
    }

    if (replay.alerts.length !== golden.alerts.length) {
        return {
            ok: false,
            firstDivergence: {
                kind: 'alertCount',
                replay: replay.alerts.length,
                golden: golden.alerts.length,
                message: `alert count mismatch: replay has ${replay.alerts.length}, golden has ${golden.alerts.length}`,
            },
        };
    }

    for (let i = 0; i < golden.alerts.length; i++) {
        const ga = golden.alerts[i];
        const ra = replay.alerts[i];

        if (ra.t !== ga.t) {
            return {
                ok: false,
                firstDivergence: {
                    kind: 'alertField',
                    t: ga.t,
                    index: i,
                    field: 't',
                    replay: ra.t,
                    golden: ga.t,
                    message: `alert[${i}]: time mismatch (replay t=${ra.t}, golden t=${ga.t})`,
                },
            };
        }

        const div = compareAlertFields(ra, ga, i);
        if (div !== null) {
            return { ok: false, firstDivergence: div };
        }
    }

    return { ok: true };
}

// ── summarizeCausal ───────────────────────────────────────────────────────────

/**
 * Measurement-only comparison: counts disagreements and deltas without asserting.
 * Useful for diagnosing causal-mode divergence at the feature level.
 */
export function summarizeCausal(replay: ReplayResult, golden: GoldenSession): CausalReport {
    const ticksCompared = Math.min(replay.ticks.length, golden.ticks.length);
    const tickCountDelta = replay.ticks.length - golden.ticks.length;

    let fA8DisagreeTicks = 0;
    let fN2DisagreeTicks = 0;
    let pasteBoundaryDisagreeTicks = 0;
    let maxAbsSDelta = 0;
    let maxAbsVDelta = 0;

    for (let i = 0; i < ticksCompared; i++) {
        const rt = replay.ticks[i];
        const gt = golden.ticks[i];

        if (rt.features.fA8 !== gt.fA8) {fA8DisagreeTicks++;}
        if (rt.features.fN2 !== gt.fN2) {fN2DisagreeTicks++;}

        const replayHasN1 = rt.boundariesPreGate.includes('N1');
        const goldenHasN1 = gt.boundaries.includes('N1');
        if (replayHasN1 !== goldenHasN1) {pasteBoundaryDisagreeTicks++;}

        const sDelta = Math.abs(rt.s - gt.s);
        if (sDelta > maxAbsSDelta) {maxAbsSDelta = sDelta;}

        const vDelta = Math.abs(rt.v - gt.v);
        if (vDelta > maxAbsVDelta) {maxAbsVDelta = vDelta;}
    }

    const alertCountReplay = replay.alerts.length;
    const alertCountGolden = golden.alerts.length;

    // Alerts fire at most once per integer tick-time, so compare by tick-time:
    // does the same alert fire at the same time, with the same primary + path?
    const replayByT = new Map(replay.alerts.map(a => [a.t, a]));
    const goldenByT = new Map(golden.alerts.map(a => [a.t, a]));
    let alertTimesOnlyInReplay = 0;
    let alertTimesOnlyInGolden = 0;
    let alertSharedTimeFieldMismatches = 0;
    for (const [t, ra] of replayByT) {
        const ga = goldenByT.get(t);
        if (ga === undefined) { alertTimesOnlyInReplay++; }
        else if (ra.kind !== 'edit' || ra.primary !== ga.primary || ra.path !== ga.path) { alertSharedTimeFieldMismatches++; }
    }
    for (const t of goldenByT.keys()) {
        if (!replayByT.has(t)) { alertTimesOnlyInGolden++; }
    }

    return {
        ticksCompared,
        tickCountDelta,
        fA8DisagreeTicks,
        fN2DisagreeTicks,
        pasteBoundaryDisagreeTicks,
        maxAbsSDelta,
        maxAbsVDelta,
        alertCountReplay,
        alertCountGolden,
        alertCountDelta: alertCountReplay - alertCountGolden,
        alertTimesOnlyInReplay,
        alertTimesOnlyInGolden,
        alertSharedTimeFieldMismatches,
    };
}
