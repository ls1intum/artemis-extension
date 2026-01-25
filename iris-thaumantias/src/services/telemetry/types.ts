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
 * Struggle context for Iris chat integration
 */
export interface StruggleContext {
    /** Whether student is currently struggling */
    isStruggling: boolean;
    /** Combined struggle score */
    score: number;
    /** List of persistent error messages for context */
    persistentErrors: string[];
    /** Number of consecutive build failures */
    buildFailures: number;
    /** Current activity pattern */
    activityPattern: InactivityPattern;
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
