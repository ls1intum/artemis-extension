// Type-only: this module is value-imported by the replay parser, which also
// runs in a plain Node process (scripts/validate-recording.ts). Keeping vscode
// type-only guarantees no runtime 'vscode' resolution leaks into that path.
import type * as vscode from 'vscode';

/**
 * Context passed to telemetry sub-services when a new exercise session starts.
 */
export interface SessionStartContext {
    exerciseId: number;
    exerciseRoot?: vscode.Uri;
}

/**
 * Implemented by telemetry sub-services that need per-exercise lifecycle management.
 * TelemetryManager iterates all registered SessionResettable services on exercise
 * switch instead of calling individual reset methods.
 */
export interface SessionResettable {
    onSessionStart(context: SessionStartContext): void;
    onSessionEnd?(): void;
}

export interface TrackedDiagnostic {
    /** Unique identifier generated from file:line:code hash */
    id: string;
    uri: string;
    range: {
        startLine: number;
        startCharacter: number;
        endLine: number;
        endCharacter: number;
    };
    /** Diagnostic code (e.g., 'ts2304') */
    code: string | number | undefined;
    message: string;
    severity: vscode.DiagnosticSeverity;
    firstSeen: number;
    lastSeen: number;
    occurrences: number;
    resolved: boolean;
}

export type InactivityPattern = 'active' | 'thinking' | 'confusion' | 'giving-up';

/**
 * Active intervention levels (excludes 'none'). Single source for the level
 * vocabulary shared by the decision engine and the recording schema.
 */
export const INTERVENTION_LEVELS = ['subtle', 'notification', 'proactive'] as const;
export type InterventionLevel = typeof INTERVENTION_LEVELS[number];

/**
 * Recommended intervention action: an active level or 'none'.
 */
export type RecommendedAction = 'none' | InterventionLevel;

/**
 * Struggle context for Iris chat integration.
 */
export interface StruggleContext {
    isStruggling: boolean;
    /** Error Quotient (0.0-1.0) */
    eq: number;
    eqConfidence: EQConfidence;
    /** Which trigger caused the evaluation (if any) */
    triggerType?: TriggerType;
    recommendedAction: RecommendedAction;
}

/**
 * Build result from Artemis server
 */
export interface BuildResult {
    timestamp: number;
    success: boolean;
    errorCount: number;
    failedTests: string[];
    buildLog: string | undefined;
    submissionId: number | undefined;
    /** Whether the build itself failed (compiler error), from result.submission?.buildFailed */
    rawBuildFailed?: boolean;
}

export interface InterventionState {
    lastInterventionTime: number;
    sessionInterventionCount: number;
    lastDismissed: boolean;
    lastAccepted: boolean;
}

// EQ-based struggle detection types (Jadud 2006 / Pu et al. 2025)

/**
 * Snapshot of error state at a compile-equivalent event.
 * [ADAPTATION] Paper had single error per compile; VS Code shows all errors simultaneously.
 */
export interface ErrorSnapshot {
    timestamp: number;
    /** Whether there are any errors (severity=Error, excluding lint) */
    hasErrors: boolean;
    /** Set of active error families as "source:code" strings */
    errorFamilies: Set<string>;
    errorCount: number;
}

/**
 * Internal state of the EQ engine
 */
export interface EQState {
    /** Chronologically ordered snapshots */
    snapshots: ErrorSnapshot[];
    /** Current EQ value (0.0-1.0) */
    currentEQ: number;
    /** Number of scored pairs */
    pairCount: number;
    /** Confidence level based on pair count */
    confidence: EQConfidence;
}

/**
 * EQ confidence: binary gate based on Jadud's minimum.
 * ✅ Paper-validated: >=7 events = >=6 pairs [P3, Section 4]
 */
export type EQConfidence = 'insufficient' | 'sufficient';

/**
 * EQ configuration: paper-validated weights and thresholds.
 * Weights: +8 (both error), +3 (same type) → max 11 [P3, Section 4]
 */
export interface EQConfig {
    /** Both events have errors [P3, Section 4] */
    readonly WEIGHT_BOTH_ERROR: number;
    /** Same error type bonus [P3, Section 4] */
    readonly WEIGHT_SAME_TYPE: number;
    /** Maximum pair score [P3, Section 4] */
    readonly MAX_PAIR_SCORE: number;
    /** Minimum events per session [P3, Section 4] */
    readonly MIN_EVENTS_PER_SESSION: number;
    /** Inactivity split threshold in ms [ADAPTATION: 30min vs Paper 5min] */
    readonly SESSION_INACTIVITY_SPLIT_MS: number;
    /** Dedup window in ms [Engineering choice] */
    readonly DEDUP_WINDOW_MS: number;
}

/** Default EQ configuration with paper-validated values */
export const DEFAULT_EQ_CONFIG: EQConfig = {
    WEIGHT_BOTH_ERROR: 8,
    WEIGHT_SAME_TYPE: 3,
    MAX_PAIR_SCORE: 11,
    MIN_EVENTS_PER_SESSION: 7,
    SESSION_INACTIVITY_SPLIT_MS: 30 * 60 * 1000, // 30 minutes
    DEDUP_WINDOW_MS: 5 * 1000, // 5 seconds
};

/**
 * Trigger types from Pu et al. 2025 [P11, Section 4, Figure 4]
 */
export const TRIGGER_TYPES = ['execution-error', 'multiline-paste', 'idle', 'selection-maintained'] as const;
export type TriggerType = typeof TRIGGER_TYPES[number];

/**
 * Trigger configuration: paper-validated thresholds [P11, Section 4]
 */
export interface TriggerConfig {
    /** Idle initial threshold: 30s [P11, Section 4] */
    readonly IDLE_INITIAL_MS: number;
    /** Idle increment per ignore: +30s [P11, Section 4] */
    readonly IDLE_INCREMENT_MS: number;
    /** Selection initial threshold: 15s [P11, Section 4] */
    readonly SELECTION_INITIAL_MS: number;
    /** Selection increment per ignore: +15s [P11, Section 4] */
    readonly SELECTION_INCREMENT_MS: number;
    /** Min lines for multi-line paste: >1 line [P11, Section 4] */
    readonly MULTILINE_PASTE_MIN_LINES: number;
    /** Idle threshold cap [Engineering choice] */
    readonly IDLE_MAX_THRESHOLD_MS: number;
    /** Selection threshold cap [Engineering choice] */
    readonly SELECTION_MAX_THRESHOLD_MS: number;
    /** Cooldown between trigger evaluations [Engineering choice].
     *  Applies to execution-error, multiline-paste, selection-maintained.
     *  Idle uses a one-shot state machine and does not use cooldown. */
    readonly TRIGGER_COOLDOWN_MS: number;
}

/** Default trigger configuration with paper-validated values */
export const DEFAULT_TRIGGER_CONFIG: TriggerConfig = {
    IDLE_INITIAL_MS: 30_000,
    IDLE_INCREMENT_MS: 30_000,
    SELECTION_INITIAL_MS: 15_000,
    SELECTION_INCREMENT_MS: 15_000,
    MULTILINE_PASTE_MIN_LINES: 2,
    IDLE_MAX_THRESHOLD_MS: 180_000,
    SELECTION_MAX_THRESHOLD_MS: 120_000,
    TRIGGER_COOLDOWN_MS: 60_000,
};

/**
 * Adaptive state for trigger threshold escalation [P11, Section 4]
 */
export interface AdaptiveState {
    ignoreCounts: Record<TriggerType, number>;
}

/**
 * Build result classification for EQ pipeline
 */
export type BuildResultClassification = 'compiler-error' | 'test-failure' | 'success';

/**
 * A compile-equivalent event that feeds into the EQ engine.
 * [ADAPTATION] Paper: "Compilation Event" = student clicks Compile in BlueJ.
 * VS Code: save event or Artemis build result.
 */
export interface CompileEquivalentEvent {
    timestamp: number;
    source: 'save' | 'build';
    snapshot: ErrorSnapshot;
}

/**
 * Reason why an intervention was blocked (i.e. rawWanted=true but shouldIntervene=false).
 *
 * - 'cooldown':        InterventionService internal cooldown (notification/proactive only)
 * - 'warmup':          Exercise hasn't reached the 5-minute warmup yet
 * - 'recent-progress': Student made progress within the 2-minute grace period
 * - 'session-limit':   Max interventions per session exceeded
 * - 'last-dismissed':  Previous intervention was dismissed (non-proactive blocked)
 * - 'low-confidence':  EQ above threshold but confidence gate is 'insufficient'
 */
export const INTERVENTION_BLOCKED_REASONS = [
    'cooldown',
    'warmup',
    'session-limit',
    'low-confidence',
    'recent-progress',
    'last-dismissed',
] as const;
export type InterventionBlockedReason = typeof INTERVENTION_BLOCKED_REASONS[number];

/**
 * Reason why an intervention was dismissed.
 *
 * - 'user-action':  User explicitly clicked "Not now" / "Later"
 * - 'hidden':       Hint was hidden implicitly (e.g. build succeeded, session ended)
 * - 'replaced':     A newer intervention replaced the current one
 * - 'session-end':  Session ended while intervention was pending
 */
export const INTERVENTION_DISMISS_REASONS = ['user-action', 'hidden', 'replaced', 'session-end'] as const;
export type InterventionDismissReason = typeof INTERVENTION_DISMISS_REASONS[number];

/**
 * Reason a wanted intervention was suppressed without being delivered to the user.
 * Currently only one reason exists; left as a union so future suppression sources
 * (e.g. per-condition study mode) can extend it cleanly.
 *
 * Note: this is a SEPARATE concept from `InterventionBlockedReason`. Blocks come
 * from engine-internal gates (cooldown, warmup, session-limit, low-confidence)
 * and are rate-limited. Suppression comes from explicit user/config choice and
 * is NOT rate-limited so the per-opportunity signal stays intact.
 */
export const INTERVENTION_SUPPRESSION_REASONS = ['user-disabled'] as const;
export type InterventionSuppressionReason = typeof INTERVENTION_SUPPRESSION_REASONS[number];

/**
 * Payload of `TelemetryManager.onDidSuppressIntervention`.
 *
 * `decision` is the original eligible decision with `shouldIntervene === true`.
 * It must NOT be mutated to `false`; the recording must retain the per-opportunity
 * eligibility signal for later analysis.
 */
export interface SuppressedInterventionPayload {
    decision: InterventionDecision;
    reason: InterventionSuppressionReason;
}

/**
 * Decision output from the intervention decision engine
 */
export interface InterventionDecision {
    /**
     * True when EQ is above the severity threshold, ignoring confidence and
     * guardrails. This is the "raw" want signal: the engine wanted to show
     * something based on severity alone.
     *
     * Example: EQ=0.5 (above notification threshold), confidence=insufficient
     *   → rawWanted=true, shouldIntervene=false, blockedReason='low-confidence'
     */
    rawWanted: boolean;
    /** Whether to actually show an intervention (rawWanted AND confidence AND guardrails pass) */
    shouldIntervene: boolean;
    level: RecommendedAction;
    /** Which trigger caused evaluation */
    triggerType?: TriggerType;
    eq: number;
    confidence: EQConfidence;
    /**
     * Populated when rawWanted=true and shouldIntervene=false.
     * Identifies why the intervention was blocked.
     */
    blockedReason?: InterventionBlockedReason;
}
