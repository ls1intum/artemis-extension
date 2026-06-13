// extension/src/extension/services/struggle/types.ts
import type { BoundaryType } from './constants';

/** Per-tick feature vector (Python compute_features row). All rates per minute,
 *  times in session-relative seconds. */
export interface FeatureVector {
    readonly t: number;
    readonly effectiveWindowS: number;
    readonly nOneCharInserts: number;
    readonly scrollEvents: number;
    readonly typingRate: number;
    readonly n4Ratio: number;
    readonly longestGapS: number;
    readonly fTyping: number;
    readonly fGap: number;
    readonly fN4: number;
    readonly fFb: number;
    readonly fA8: number;
    readonly fN2: number;
    readonly tsState: boolean;
    readonly n4State: boolean;
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

/** Audit record of an emitted alert (Python run_state_machine audit row). */
export interface AlertRecord {
    readonly t: number;
    readonly ts: number;
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
    v: number;
    s: number;
    primaryBoundary: BoundaryType | null;
    lastAlert: { t: number; types: readonly BoundaryType[]; path: 'armed' | 'e6' } | null;
    sessionSeconds: number;
}
