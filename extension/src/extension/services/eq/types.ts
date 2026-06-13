// extension/src/extension/services/eq/types.ts
/**
 * Types of the passive EQ pipeline (Jadud 2006 pair scoring).
 *
 * Extracted from the former v1 telemetry layer in PR 2a. Under Engine v2
 * (PR 2c) the EQ pipeline is a passive logger with no decision role; these types
 * describe the snapshots it records for study continuity.
 */

/**
 * Snapshot of error state at a compile-equivalent event.
 * [ADAPTATION] Paper had single error per compile; VS Code shows all errors simultaneously.
 */
export interface ErrorSnapshot {
    /** Timestamp of the snapshot */
    timestamp: number;
    /** Whether there are any errors (severity=Error, excluding lint) */
    hasErrors: boolean;
    /** Set of active error families as "source:code" strings */
    errorFamilies: Set<string>;
    /** Total number of active errors */
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
 * EQ confidence — binary gate based on Jadud's minimum.
 * ✅ Paper-validated: >=7 events = >=6 pairs [P3, Section 4]
 */
export type EQConfidence = 'insufficient' | 'sufficient';

/**
 * EQ configuration — paper-validated weights and thresholds.
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
 * Build result classification for EQ pipeline
 */
export type BuildResultClassification = 'compiler-error' | 'test-failure' | 'success';

/**
 * A compile-equivalent event that feeds into the EQ engine.
 * [ADAPTATION] Paper: "Compilation Event" = student clicks Compile in BlueJ.
 * VS Code: save event or Artemis build result.
 */
export interface CompileEquivalentEvent {
    /** Timestamp of the event */
    timestamp: number;
    /** Source of the event */
    source: 'save' | 'build';
    /** Error snapshot at this point */
    snapshot: ErrorSnapshot;
}
