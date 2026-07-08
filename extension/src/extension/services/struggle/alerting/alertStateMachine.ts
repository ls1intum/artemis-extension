// extension/src/extension/services/struggle/alerting/alertStateMachine.ts
/**
 * Edit-path alerting state machine (spec §5) with the gate sequence of spec §4
 * — an exact port of run_state_machine (engine_v2.py). v3 feeds it the threshold
 * signal `urgency = S_base = (f_typing + f_gap)/2` in place of the V peak-hold
 * curve (the `alerts_full_u` configuration, script 35); the machine STRUCTURE is
 * unchanged. The ORDER of the checks is load-bearing and verified by the ported
 * unit tests T3-T9:
 *   1. urgency bookkeeping (hysteresis / over-theta run on S_base)
 *   2. boundaries present? -> B2 -> grace filter -> warmup filter -> theta ->
 *      cooldown -> armed/E6
 *   3. alert bookkeeping (E6 resets in_state_since; DECISIONS_v2 #20)
 */
import type { BoundaryType } from '@extension/services/struggle/config';
import { SPEC } from '@extension/services/struggle/config';
import { applyGraceFilter, isFluentTyping, survivesWarmup } from '@extension/services/struggle/gates/gates';
import type { EditDecisionAlert, EditTrace, EditTraceReason, GateConditions } from '@extension/services/struggle/types';

export interface MachineParams {
    thetaFull: number;
    graceS: number;
    warmupS: number;
    cooldownS: number;
    hysteresis: number;
    realertS: number;
}

export const DEFAULT_MACHINE_PARAMS: MachineParams = {
    thetaFull: SPEC.THETA_FULL,
    graceS: SPEC.GRACE_S,
    warmupS: SPEC.WARMUP_S,
    cooldownS: SPEC.COOLDOWN_S,
    hysteresis: SPEC.HYSTERESIS,
    realertS: SPEC.REALERT_S,
};

export interface MachineTickInput {
    /** Session-relative tick time (s). */
    t: number;
    /** Threshold signal — v3 S_base (NOT the V curve). */
    urgency: number;
    /** Boundary types pending at this tick, in BOUNDARY_PRIORITY order. */
    boundaries: readonly BoundaryType[];
    /** Current window typing rate; null = no data (B2 fail-open). */
    typingRate: number | null;
    /** B4: inside the grace window after a bad-build result? (computed by the engine) */
    graceActive: boolean;
}

export class AlertStateMachine {
    private readonly _p: MachineParams;
    private _armed = true;
    private _inStateSince: number | null = null;
    private _lastAlert = Number.NEGATIVE_INFINITY;
    // No initializer here — set in constructor after _p is assigned.
    private _lastTrace: EditTrace;

    constructor(params?: Partial<MachineParams>) {
        this._p = { ...DEFAULT_MACHINE_PARAMS, ...params };
        this._lastTrace = this._emptyTrace();
    }

    private _emptyTrace(): EditTrace {
        return {
            reason: 'no-candidate', urgency: 0, theta: this._p.thetaFull,
            typingRate: null, boundariesPresent: [], secondsSinceLastAlert: Number.POSITIVE_INFINITY,
            inWarmup: false, graceActive: false,
            gates: {
                fluentTyping: false, grace: false, warmup: false,
                belowThreshold: false, cooldown: false, notRearmed: false,
            },
        };
    }

    get lastTrace(): EditTrace { return this._lastTrace; }

    /** The last-alert tick time — the cooldown clock. Shared with the
     *  DecisionEngine's discrete path so edit + discrete alerts honour ONE cooldown. */
    get lastAlertT(): number {
        return this._lastAlert;
    }

    /** Stamp the cooldown clock when a discrete add-on alert fires elsewhere.
     *  Moves ONLY `_lastAlert` (the shared cooldown) — `_armed`/`_inStateSince`
     *  are untouched, so the edit path's hysteresis/E6 bookkeeping is unchanged
     *  (a discrete alert can postpone the next edit E6 via the shared cooldown,
     *  which is the intended single-cooldown behaviour). */
    registerAlert(t: number): void {
        this._lastAlert = t;
    }

    tick(input: MachineTickInput): EditDecisionAlert | null {
        const { t, urgency } = input;
        const p = this._p;

        // Step 1: urgency bookkeeping (hysteresis / over-theta run on S_base).
        // Moved ABOVE `base` so the gate-condition snapshot below reads the same
        // _armed/_inStateSince the gates check. `base` does not depend on Step 1
        // (it never reads _armed/_inStateSince, and Step 1 leaves _lastAlert
        // untouched), so the recorded trace + the alert returns are unchanged.
        if (urgency < p.thetaFull - p.hysteresis) {
            this._armed = true;
            this._inStateSince = null;
        } else if (urgency >= p.thetaFull && this._inStateSince === null) {
            this._inStateSince = t;
        }

        // Per-gate live conditions (telemetry only; never read by the decision).
        // Each flag is the gate's standalone blocking condition, INDEPENDENT of
        // whether a boundary is present, so the developer view can light up gates
        // even on idle/no-candidate ticks. Computed before Step 2/3 mutate state,
        // matching `base.secondsSinceLastAlert` (pre-fire _lastAlert).
        const gates: GateConditions = {
            fluentTyping: isFluentTyping(input.typingRate),
            grace: input.graceActive,
            warmup: t <= p.warmupS,
            belowThreshold: urgency < p.thetaFull,
            cooldown: t - this._lastAlert < p.cooldownS,
            notRearmed: !this._armed
                && !(this._inStateSince !== null && t - this._inStateSince >= p.realertS),
        };

        const base = {
            urgency, theta: p.thetaFull, typingRate: input.typingRate,
            boundariesPresent: [...input.boundaries] as readonly BoundaryType[],
            secondsSinceLastAlert: t - this._lastAlert,
            inWarmup: t <= p.warmupS, graceActive: input.graceActive,
            gates,
        };
        const record = (reason: EditTraceReason): void => { this._lastTrace = { reason, ...base }; };

        // Step 2: alert condition (gate order is load-bearing; outputs identical to the original)
        let present = [...input.boundaries];
        if (present.length === 0) { record('no-candidate'); return null; }
        const preGate = [...present];
        if (isFluentTyping(input.typingRate)) { record('b2-fluent-typing'); return null; }
        if (input.graceActive) {
            present = applyGraceFilter(present);
            if (present.length === 0) { record('b4-grace-filter'); return null; }
        }
        if (t <= p.warmupS && !survivesWarmup(present)) { record('d1-warmup'); return null; }
        if (urgency < p.thetaFull) { record('below-threshold'); return null; }
        if (t - this._lastAlert < p.cooldownS) { record('cooldown'); return null; }
        let e6 = false;
        if (!this._armed) {
            if (this._inStateSince !== null && t - this._inStateSince >= p.realertS) {
                e6 = true;
            } else { record('not-rearmed'); return null; }
        }

        // Step 3: alert
        if (e6) { this._inStateSince = t; }
        this._lastAlert = t;
        this._armed = false;
        record('fired');
        return {
            kind: 'edit', t, urgency,
            typesPreGate: preGate, types: present, primary: present[0],
            path: e6 ? 'e6' : 'armed',
            inWarmup: t <= p.warmupS, inGrace: input.graceActive,
        };
    }

    reset(): void {
        this._armed = true;
        this._inStateSince = null;
        this._lastAlert = Number.NEGATIVE_INFINITY;
        this._lastTrace = this._emptyTrace();
    }

    /** Dev override: live-set the D1 warm-up window (0 = skip). Mutates only
     *  warmupS on the params; all machine bookkeeping is left untouched. */
    setWarmupS(s: number): void { this._p.warmupS = s; }
}
