import * as vscode from 'vscode';

/**
 * Represents a tracked VS Code diagnostic with persistence information
 */
export interface TrackedDiagnostic {
    /** Unique identifier generated from file:line:code hash */
    id: string;
    /** URI of the file containing the diagnostic */
    uri: string;
    /** Range where the diagnostic appears */
    range: {
        startLine: number;
        startCharacter: number;
        endLine: number;
        endCharacter: number;
    };
    /** Diagnostic code (e.g., 'ts2304') */
    code: string | number | undefined;
    /** Diagnostic message */
    message: string;
    /** Severity level */
    severity: vscode.DiagnosticSeverity;
    /** Timestamp when first seen */
    firstSeen: number;
    /** Timestamp when last seen */
    lastSeen: number;
    /** Number of times this diagnostic has appeared */
    occurrences: number;
    /** Whether this diagnostic has been resolved */
    resolved: boolean;
}

/**
 * Diagnostic-based struggle score
 */
export interface DiagnosticStruggleScore {
    /** Overall score from 0-100 */
    overall: number;
    /** Number of persistent errors (errors that haven't been fixed) */
    persistentErrors: number;
    /** Number of repeated errors (same error appearing multiple times) */
    repeatedErrors: number;
    /** Time spent in confusion state (milliseconds) */
    timeInConfusion: number;
    /** Recommended action based on the score */
    recommendedAction: RecommendedAction;
}

/**
 * Inactivity pattern classification
 */
export type InactivityPattern = 'active' | 'thinking' | 'confusion' | 'giving-up';

/**
 * Recommended intervention action
 */
export type RecommendedAction = 'none' | 'subtle' | 'notification' | 'proactive';

/**
 * Local struggle context (from VS Code diagnostics and editing patterns)
 */
export interface LocalStruggleContext {
    /** Array of persistent error messages */
    persistentErrors: string[];
    /** Current inactivity pattern */
    inactivityPattern: InactivityPattern;
    /** Time since last edit in milliseconds */
    timeSinceLastEdit: number;
    /** Current thrashing score (0-100) */
    thrashingScore: number;
}

/**
 * Server-side struggle context (from Artemis build results)
 */
export interface ServerStruggleContext {
    /** Number of consecutive build failures */
    consecutiveBuildFailures: number;
    /** Names of failing test cases */
    failingTestCases: string[];
    /** Last build error message */
    lastBuildError: string | undefined;
    /** Timestamp of last submission */
    lastSubmissionTime: number | undefined;
}

/**
 * Combined struggle score from all sources
 */
export interface CombinedStruggleScore {
    /** Local struggle metrics */
    local: LocalStruggleContext;
    /** Server-side struggle metrics */
    server: ServerStruggleContext;
    /** Combined score (0-100) */
    combined: number;
    /** Confidence level (0-1) based on data availability */
    confidence: number;
    /** Recommended intervention action */
    recommendedAction: RecommendedAction;
}

/**
 * Struggle context for Iris chat integration.
 * EQ-based — replaces old weighted score.
 */
export interface StruggleContext {
    /** Whether student is currently struggling */
    isStruggling: boolean;
    /** Error Quotient (0.0-1.0), replaces old 0-100 score */
    eq: number;
    /** EQ confidence level */
    eqConfidence: EQConfidence;
    /** Which trigger caused the evaluation (if any) */
    triggerType?: TriggerType;
    /** Recommended action */
    recommendedAction: RecommendedAction;
}

/**
 * Build result from Artemis server
 */
export interface BuildResult {
    /** Timestamp of the build */
    timestamp: number;
    /** Whether the build succeeded */
    success: boolean;
    /** Number of errors in the build */
    errorCount: number;
    /** Names of failed test cases */
    failedTests: string[];
    /** Raw build log content */
    buildLog: string | undefined;
    /** Submission ID from Artemis */
    submissionId: number | undefined;
    /** Whether the build itself failed (compiler error), from result.submission?.buildFailed */
    rawBuildFailed?: boolean;
}

/**
 * Intervention state tracking
 */
export interface InterventionState {
    /** Last intervention timestamp */
    lastInterventionTime: number;
    /** Number of interventions in current session */
    sessionInterventionCount: number;
    /** Whether the last intervention was dismissed */
    lastDismissed: boolean;
    /** Whether the last intervention was accepted */
    lastAccepted: boolean;
}

// ============================================================================
// EQ-based Struggle Detection Types (Jadud 2006 / Pu et al. 2025)
// ============================================================================

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
    /** Diagnostic stabilization debounce in ms [ADAPTATION: optional, default off] */
    readonly DIAGNOSTIC_STABILIZATION_MS: number;
    /** Whether diagnostic stabilization trigger is enabled [Engineering choice] */
    readonly DIAGNOSTIC_STABILIZATION_ENABLED: boolean;
}

/** Default EQ configuration with paper-validated values */
export const DEFAULT_EQ_CONFIG: EQConfig = {
    WEIGHT_BOTH_ERROR: 8,
    WEIGHT_SAME_TYPE: 3,
    MAX_PAIR_SCORE: 11,
    MIN_EVENTS_PER_SESSION: 7,
    SESSION_INACTIVITY_SPLIT_MS: 30 * 60 * 1000, // 30 minutes
    DEDUP_WINDOW_MS: 5 * 1000, // 5 seconds
    DIAGNOSTIC_STABILIZATION_MS: 2_000, // 2 seconds debounce
    DIAGNOSTIC_STABILIZATION_ENABLED: false, // off by default
};

/**
 * Trigger types from Pu et al. 2025 [P11, Section 4, Figure 4]
 */
export type TriggerType = 'execution-error' | 'multiline-paste' | 'idle' | 'selection-maintained';

/**
 * Trigger configuration — paper-validated thresholds [P11, Section 4]
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
    /** Cooldown between trigger evaluations [Engineering choice] */
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
    /** Ignore count per trigger type */
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
    /** Timestamp of the event */
    timestamp: number;
    /** Source of the event */
    source: 'save' | 'build';
    /** Error snapshot at this point */
    snapshot: ErrorSnapshot;
}

/**
 * Decision output from the intervention decision engine
 */
export interface InterventionDecision {
    /** Whether to intervene */
    shouldIntervene: boolean;
    /** Intervention level */
    level: RecommendedAction;
    /** Which trigger caused evaluation */
    triggerType?: TriggerType;
    /** Current EQ value */
    eq: number;
    /** Current EQ confidence */
    confidence: EQConfidence;
}
