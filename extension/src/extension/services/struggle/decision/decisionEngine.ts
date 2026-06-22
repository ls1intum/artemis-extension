// extension/src/extension/services/struggle/decision/decisionEngine.ts
/**
 * Schicht-3 decision owner (Engine v3). The ONE component that turns a per-tick
 * EngineTick into an (unthrottled) alert candidate. It thresholds on
 * `urgency = S_base` (NOT the V peak-hold curve) — the `alerts_full_u`
 * configuration (script 35): run_state_machine re-run on S_base at θ = 0.7. The
 * edit path delegates to the ported AlertStateMachine; the hysteresis / over-θ
 * span / cooldown / E6 / gate sequence are unchanged from v2 — only the
 * threshold signal changed (V → urgency). The telemetry V on the EngineTick is
 * deliberately NEVER read here.
 *
 * Pure given its inputs: both the live engine (struggleEngine._runTick) and the
 * golden-replay harness call THIS component, so the measured/recorded decision
 * surface is identical (the load-bearing urgency golden, WS5).
 *
 * Discrete high-precision triggers (Test-/Prüf-Stagnation) get their OWN,
 * non-behaviorally-gated path here in WS3; for now only the edit path is wired.
 */
import { AlertStateMachine, type MachineParams } from '@extension/services/struggle/alerting/alertStateMachine';
import type { DecisionAlert, EngineTick } from '@extension/services/struggle/types';

export class DecisionEngine {
    private readonly _editMachine: AlertStateMachine;

    constructor(params?: Partial<MachineParams>) {
        this._editMachine = new AlertStateMachine(params);
    }

    /** Decide whether this tick produces an (unthrottled) alert candidate. */
    decide(tick: EngineTick): DecisionAlert | null {
        return this._editPath(tick);
    }

    /** Edit path: urgency thresholding + B2/B4/warmup gates + cooldown/E6. */
    private _editPath(tick: EngineTick): DecisionAlert | null {
        const { boundaries, typingRate, graceActive } = tick.editCandidate;
        return this._editMachine.tick({
            t: tick.t,
            urgency: tick.urgency,
            boundaries,
            typingRate,
            graceActive,
        });
    }

    reset(): void {
        this._editMachine.reset();
    }
}
