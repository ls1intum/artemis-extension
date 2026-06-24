// extension/src/extension/services/struggle/types.ts
import type { BoundaryType } from './config';

/** Per-tick feature vector (Python compute_features row). All rates per minute,
 *  times in session-relative seconds. */
export interface FeatureVector {
    readonly t: number;
    readonly effectiveWindowS: number;
    readonly nOneCharInserts: number;
    readonly typingRate: number;
    readonly longestGapS: number;
    readonly fTyping: number;
    readonly fGap: number;
    readonly fFb: number;
    readonly fA8: number;
    readonly fN2: number;
    readonly tsState: boolean;
}

/** Outcome of one engine tick (input for the struggleScore recording in PR 2c). */
export interface TickRecord {
    /** Session-relative tick time in seconds (10, 20, ...). */
    readonly t: number;
    /** Absolute tick timestamp in ms (sessionStartMs + t*1000). */
    readonly ts: number;
    readonly features: FeatureVector;
    readonly sBase: number;
    readonly s: number;
    readonly v: number;
    readonly fastDecay: boolean;
    /** Boundary types pending at this tick BEFORE gates (audit). */
    readonly boundariesPreGate: readonly BoundaryType[];
    readonly alert: AlertRecord | null;
    /** Why this tick did/did not fire (telemetry; never read by the decision). */
    readonly decisionTrace: DecisionTrace;
}

/**
 * Schicht-2 → Schicht-3 hand-off, one per 10-s tick. The DecisionEngine reads
 * `urgency` + `editCandidate` + `discreteTriggers` ONLY; `telemetry` (S/V) is
 * recorder/regression substrate that the decision NEVER reads — the v3 threshold
 * moved off the V peak-hold curve onto `urgency = S_base = (f_typing + f_gap)/2`
 * (the `alerts_full_u` configuration).
 */
export interface EngineTick {
    /** Session-relative tick time (s). */
    readonly t: number;
    /** S_base — the live threshold signal (NOT V). */
    readonly urgency: number;
    /** Gated edit-path inputs (boundaries/B2/B4 — see DecisionEngine). */
    readonly editCandidate: {
        readonly boundaries: readonly BoundaryType[];
        readonly typingRate: number | null;
        readonly graceActive: boolean;
    };
    /** Discrete high-precision add-on triggers, on their OWN decision path (NOT
     *  B2/B4-gated). (Prüf-Stagnation deferred until a real attempt signal exists.) */
    readonly discreteTriggers: {
        readonly testStagnation: boolean;
    };
    /** Recorder/regression substrate only — never read by the DecisionEngine. */
    readonly telemetry: {
        readonly s: number;
        readonly v: number;
        readonly fastDecay: boolean;
    };
}

/** Discrete high-precision triggers (Engine v3 add-ons; own decision path). */
export type DiscreteTrigger = 'test-stagnation';

export type EditTraceReason =
	| 'fired'              // an edit alert fired this tick
	| 'no-candidate'       // no boundary was pending
	| 'b2-fluent-typing'   // B2: typing fluently
	| 'b4-grace-filter'    // B4: grace window removed all (non-FM/FM+) boundaries
	| 'd1-warmup'          // D1: warmup removed all (non-FM/E4) boundaries
	| 'below-threshold'    // urgency < theta
	| 'cooldown'           // within COOLDOWN_S of the last alert
	| 'not-rearmed';       // machine not re-armed and not yet E6-eligible (hysteresis/over-θ-span gate)

/**
 * Per-gate live conditions, one boolean per decision gate. Each flag is whether
 * that gate's blocking condition currently holds, INDEPENDENT of whether a
 * boundary is pending this tick, so the developer gate view can light up gates
 * even on idle / no-candidate ticks. Telemetry only; never read by the decision.
 */
export interface GateConditions {
	/** B2: typing rate at/above the fluent threshold. */
	readonly fluentTyping: boolean;
	/** B4: inside the post-build grace window. */
	readonly grace: boolean;
	/** D1: inside the exercise warm-up period. */
	readonly warmup: boolean;
	/** Urgency below the alert threshold θ. */
	readonly belowThreshold: boolean;
	/** Inside the post-alert cooldown. */
	readonly cooldown: boolean;
	/** E6: machine not re-armed and not yet over-θ-span eligible. */
	readonly notRearmed: boolean;
}

export interface EditTrace {
	readonly reason: EditTraceReason;
	readonly urgency: number;
	readonly theta: number;
	readonly typingRate: number | null;
	/** Boundaries pending BEFORE gating (BOUNDARY_PRIORITY order). */
	readonly boundariesPresent: readonly BoundaryType[];
	/** t - lastAlert; Number.POSITIVE_INFINITY if no alert has fired yet. */
	readonly secondsSinceLastAlert: number;
	readonly inWarmup: boolean;
	readonly graceActive: boolean;
	/** Live per-gate conditions (telemetry; for the developer gate view). */
	readonly gates: GateConditions;
}

export type DecisionOutcome = 'fired-edit' | 'fired-discrete' | 'suppressed';

/** Combined per-tick decision trace (edit path + discrete outcome). Telemetry. */
export interface DecisionTrace extends EditTrace {
	readonly outcome: DecisionOutcome;
	/** The discrete trigger that fired, when outcome === 'fired-discrete'; else null. */
	readonly discreteTrigger: DiscreteTrigger | null;
}

/**
 * Edit-path alert: boundary-driven, the alerts_full_u decision surface. The
 * threshold signal `urgency` (S_base) crossed θ at a pending boundary.
 */
export interface EditDecisionAlert {
    readonly kind: 'edit';
    readonly t: number;
    readonly urgency: number;
    readonly typesPreGate: readonly BoundaryType[];
    readonly types: readonly BoundaryType[];
    readonly primary: BoundaryType;
    readonly path: 'armed' | 'e6';
    readonly inWarmup: boolean;
    readonly inGrace: boolean;
}

/**
 * Discrete-path alert: an add-on trigger (e.g. Test-Stagnation) that fires on
 * its OWN path, bypassing the B2/B4 gate matrix. It is NOT boundary-shaped.
 * `urgency` is carried as telemetry (the discrete decision does not threshold on it).
 */
export interface DiscreteDecisionAlert {
    readonly kind: 'discrete';
    readonly t: number;
    readonly urgency: number;
    readonly trigger: DiscreteTrigger;
    readonly inWarmup: boolean;
}

/** The DecisionEngine's per-tick output, before the engine stamps `ts`/telemetry. */
export type DecisionAlert = EditDecisionAlert | DiscreteDecisionAlert;

/** Audit record of an emitted alert (+ absolute ts and the telemetry V). */
export type AlertRecord = DecisionAlert & {
    readonly ts: number;
    /** Peak-hold V at the firing tick — TELEMETRY only, NOT the decision signal. */
    readonly v: number;
};

/** Injectable clock/scheduler so tests and replay drive ticks deterministically. */
export interface EngineClock {
    now(): number;
    setInterval(callback: () => void, ms: number): unknown;
    clearInterval(handle: unknown): void;
}

export interface EngineSessionContext {
    readonly sessionStartMs: number;
    readonly exerciseRoot?: import('vscode').Uri;
}

/** Live engine state for the debug UI. */
export interface StruggleSnapshot {
    isStruggling: boolean;
    /** Live threshold signal (S_base); isStruggling = urgency >= θ (NOT v >= θ). */
    urgency: number;
    v: number;
    s: number;
    primaryBoundary: BoundaryType | null;
    lastAlert: { t: number; kind: 'edit' | 'discrete'; summary: string } | null;
    sessionSeconds: number;
}
