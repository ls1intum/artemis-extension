// extension/src/extension/services/struggle/types.ts
import type { BoundaryType } from './constants';

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
}

/**
 * Schicht-2 → Schicht-3 hand-off, one per 10-s tick. The DecisionEngine reads
 * `urgency` + `editCandidate` ONLY; `telemetry` (S/V) is recorder/regression
 * substrate that the decision NEVER reads — the v3 threshold moved off the V
 * peak-hold curve onto `urgency = S_base = (f_typing + f_gap)/2` (the
 * `alerts_full_u` configuration). Discrete high-precision triggers
 * (Test-/Prüf-Stagnation) join this contract on their own path in WS3.
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
    /** Recorder/regression substrate only — never read by the DecisionEngine. */
    readonly telemetry: {
        readonly s: number;
        readonly v: number;
        readonly fastDecay: boolean;
    };
}

/** The DecisionEngine's per-tick output, before the engine stamps `ts`/telemetry. */
export interface DecisionAlert {
    readonly t: number;
    /** The threshold signal (S_base) that crossed θ at this tick. */
    readonly urgency: number;
    readonly typesPreGate: readonly BoundaryType[];
    readonly types: readonly BoundaryType[];
    readonly primary: BoundaryType;
    readonly path: 'armed' | 'e6';
    readonly inWarmup: boolean;
    readonly inGrace: boolean;
}

/** Audit record of an emitted alert (Python run_state_machine audit row). */
export interface AlertRecord {
    readonly t: number;
    readonly ts: number;
    /** Threshold signal (S_base) that fired the alert — the live v3 decision input. */
    readonly urgency: number;
    /** Peak-hold V at the firing tick — TELEMETRY only, NOT the decision signal. */
    readonly v: number;
    readonly typesPreGate: readonly BoundaryType[];
    readonly types: readonly BoundaryType[];
    readonly primary: BoundaryType;
    readonly path: 'armed' | 'e6';
    readonly inWarmup: boolean;
    readonly inGrace: boolean;
}

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

/** Live engine state for the debug UI (replaces the v1 EQ StruggleContext). */
export interface StruggleSnapshot {
    isStruggling: boolean;
    /** Live threshold signal (S_base); isStruggling = urgency >= θ (NOT v >= θ). */
    urgency: number;
    v: number;
    s: number;
    primaryBoundary: BoundaryType | null;
    lastAlert: { t: number; types: readonly BoundaryType[]; path: 'armed' | 'e6' } | null;
    sessionSeconds: number;
}
