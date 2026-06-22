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
import type { EditDecisionAlert } from '@extension/services/struggle/types';

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

    constructor(params?: Partial<MachineParams>) {
        this._p = { ...DEFAULT_MACHINE_PARAMS, ...params };
    }

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

        // Step 1: urgency bookkeeping (hysteresis / over-theta run on S_base)
        if (urgency < p.thetaFull - p.hysteresis) {
            this._armed = true;
            this._inStateSince = null;
        } else if (urgency >= p.thetaFull && this._inStateSince === null) {
            this._inStateSince = t;
        }

        // Step 2: alert condition
        let present = [...input.boundaries];
        if (present.length === 0) {
            return null;
        }
        const preGate = [...present];
        if (isFluentTyping(input.typingRate)) {
            return null;                                    // B2 blocks everything
        }
        if (input.graceActive) {
            present = applyGraceFilter(present);            // B4: only FM/FM+ survive
        }
        if (t <= p.warmupS && !survivesWarmup(present)) {
            present = [];                                   // D1: only FM/E4 break through
        }
        if (present.length === 0) {
            return null;
        }
        if (urgency < p.thetaFull) {
            return null;
        }
        if (t - this._lastAlert < p.cooldownS) {
            return null;
        }
        let e6 = false;
        if (!this._armed) {
            if (this._inStateSince !== null && t - this._inStateSince >= p.realertS) {
                e6 = true;                                  // E6 re-alert without re-arm
            } else {
                return null;
            }
        }

        // Step 3: alert
        if (e6) {
            this._inStateSince = t;                         // E6 reset (DECISIONS_v2 #20)
        }
        this._lastAlert = t;
        this._armed = false;
        return {
            kind: 'edit',
            t,
            urgency,
            typesPreGate: preGate,
            types: present,
            primary: present[0],                            // BOUNDARY_PRIORITY-sorted input
            path: e6 ? 'e6' : 'armed',
            inWarmup: t <= p.warmupS,
            inGrace: input.graceActive,
        };
    }

    reset(): void {
        this._armed = true;
        this._inStateSince = null;
        this._lastAlert = Number.NEGATIVE_INFINITY;
    }
}
