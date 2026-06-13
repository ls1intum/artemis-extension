// extension/src/extension/services/struggle/alerting/alertStateMachine.ts
/**
 * Alerting state machine (spec §5) with the gate sequence of spec §4 — an
 * exact port of run_state_machine (engine_v2.py). The ORDER of the checks is
 * load-bearing and verified by the ported unit tests T3-T9:
 *   1. V bookkeeping (hysteresis / over-theta run)
 *   2. boundaries present? -> B2 -> grace filter -> warmup filter -> theta ->
 *      cooldown -> armed/E6
 *   3. alert bookkeeping (E6 resets in_state_since; DECISIONS_v2 #20)
 */
import type { BoundaryType } from '@extension/services/struggle/constants';
import { SPEC } from '@extension/services/struggle/constants';
import { applyGraceFilter, isFluentTyping, survivesWarmup } from '@extension/services/struggle/gates/gates';

export interface MachineParams {
    thetaFull: number;
    graceS: number;
    warmupS: number;
    cooldownS: number;
    hysteresis: number;
    realertS: number;
}

const DEFAULT_PARAMS: MachineParams = {
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
    v: number;
    /** Boundary types pending at this tick, in BOUNDARY_PRIORITY order. */
    boundaries: readonly BoundaryType[];
    /** Current window typing rate; null = no data (B2 fail-open). */
    typingRate: number | null;
    /** B4: inside the grace window after a bad-build result? (computed by the engine) */
    graceActive: boolean;
}

export interface MachineAlert {
    t: number;
    v: number;
    typesPreGate: readonly BoundaryType[];
    types: readonly BoundaryType[];
    primary: BoundaryType;
    path: 'armed' | 'e6';
    inWarmup: boolean;
    inGrace: boolean;
}

export class AlertStateMachine {
    private readonly _p: MachineParams;
    private _armed = true;
    private _inStateSince: number | null = null;
    private _lastAlert = Number.NEGATIVE_INFINITY;

    constructor(params?: Partial<MachineParams>) {
        this._p = { ...DEFAULT_PARAMS, ...params };
    }

    tick(input: MachineTickInput): MachineAlert | null {
        const { t, v } = input;
        const p = this._p;

        // Step 1: V bookkeeping (hysteresis / over-theta run)
        if (v < p.thetaFull - p.hysteresis) {
            this._armed = true;
            this._inStateSince = null;
        } else if (v >= p.thetaFull && this._inStateSince === null) {
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
        if (v < p.thetaFull) {
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
            t,
            v,
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
