// extension/src/extension/services/struggle/decision/decisionEngine.ts
/**
 * Schicht-3 decision owner (Engine v3). The ONE component that turns a per-tick
 * EngineTick into an (unthrottled) alert candidate. Two paths, ONE cooldown:
 *
 *  - Edit path (validated, golden-pinned): thresholds on `urgency = S_base` (NOT
 *    the V curve) — the `alerts_full_u` configuration (run_state_machine on
 *    S_base at θ=0.7). Delegates to the ported AlertStateMachine; hysteresis /
 *    over-θ span / E6 / cooldown / B2/B4/warmup gates are unchanged from v2.
 *  - Discrete path (add-ons): high-precision triggers (Test-Stagnation) fire on
 *    their OWN path, NOT suppressed by the B2/B4 gate matrix. Test-Stagnation is
 *    build-anchored, so it BREAKS warmup; it is subject only to the SHARED
 *    cooldown (stamped on the same machine clock via registerAlert, so edit and
 *    discrete alerts never double-fire within COOLDOWN_S). A discrete alert can
 *    postpone the next edit-path E6 — intended single-cooldown behaviour.
 *
 * The edit path runs FIRST every tick (keeps the machine's urgency bookkeeping
 * exact) and an edit alert wins the tick; the discrete path is the fallback.
 * Ablation flags gate the add-ons: validated-base mode (all add-ons OFF) makes
 * the DecisionEngine identical to alerts_full_u — that is the golden surface.
 * Pure given its inputs: both the live engine and the golden-replay harness call
 * THIS component.
 *
 * (Prüf-Stagnation + the gate ablation are deferred — see the WS3 plan: E4 is a
 * generic terminal-end with no test/build-attempt classification.)
 */
import {
    AlertStateMachine, DEFAULT_MACHINE_PARAMS, type MachineParams,
} from '@extension/services/struggle/alerting/alertStateMachine';
import type {
    DecisionAlert, DecisionTrace, DiscreteDecisionAlert, EditDecisionAlert, EngineTick,
} from '@extension/services/struggle/types';

/** Ablation toggles for the add-on decision paths. Default = production (all ON). */
export interface DecisionAblation {
    /** Test-Stagnation discrete add-on. OFF = validated-base mode (golden parity). */
    readonly enableTestStagnation?: boolean;
}

export class DecisionEngine {
    private readonly _editMachine: AlertStateMachine;
    private readonly _params: MachineParams;
    private readonly _enableTestStagnation: boolean;
    private _lastTrace: DecisionTrace;

    constructor(params?: Partial<MachineParams>, ablation?: DecisionAblation) {
        this._params = { ...DEFAULT_MACHINE_PARAMS, ...params };
        this._editMachine = new AlertStateMachine(params);
        this._enableTestStagnation = ablation?.enableTestStagnation ?? true;
        this._lastTrace = { ...this._editMachine.lastTrace, outcome: 'suppressed', discreteTrigger: null };
    }

    get lastTrace(): DecisionTrace { return this._lastTrace; }

    /** Decide whether this tick produces an (unthrottled) alert candidate. */
    decide(tick: EngineTick): DecisionAlert | null {
        const edit = this._editPath(tick);
        const editTrace = this._editMachine.lastTrace;
        if (edit !== null) {
            this._lastTrace = { ...editTrace, outcome: 'fired-edit', discreteTrigger: null };
            return edit;                                   // edit alert wins the tick
        }
        const discrete = this._discretePath(tick);
        if (discrete !== null) {
            this._lastTrace = { ...editTrace, outcome: 'fired-discrete', discreteTrigger: discrete.trigger };
            return discrete;
        }
        this._lastTrace = { ...editTrace, outcome: 'suppressed', discreteTrigger: null };
        return null;
    }

    /** Edit path: urgency thresholding + B2/B4/warmup gates + cooldown/E6. */
    private _editPath(tick: EngineTick): EditDecisionAlert | null {
        const { boundaries, typingRate, graceActive } = tick.editCandidate;
        return this._editMachine.tick({
            t: tick.t,
            urgency: tick.urgency,
            boundaries,
            typingRate,
            graceActive,
        });
    }

    /** Discrete add-on path (NOT B2/B4-gated). Test-Stagnation breaks warmup;
     *  guarded only by the shared cooldown. */
    private _discretePath(tick: EngineTick): DiscreteDecisionAlert | null {
        if (!this._enableTestStagnation || !tick.discreteTriggers.testStagnation) {
            return null;
        }
        if (tick.t - this._editMachine.lastAlertT < this._params.cooldownS) {
            return null;                                   // shared cooldown
        }
        this._editMachine.registerAlert(tick.t);           // stamp the shared cooldown clock
        return {
            kind: 'discrete',
            t: tick.t,
            urgency: tick.urgency,                         // telemetry (the discrete decision did not threshold on it)
            trigger: 'test-stagnation',
            inWarmup: tick.t <= this._params.warmupS,
        };
    }

    reset(): void {
        this._editMachine.reset();
        this._lastTrace = { ...this._editMachine.lastTrace, outcome: 'suppressed', discreteTrigger: null };
    }
}
