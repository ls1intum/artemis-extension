/**
 * Struggle Detection Test Framework - Type Definitions
 *
 * EQ-based types (Jadud 2006). Scenarios generate ErrorSnapshots
 * from save/build events and verify the resulting EQ value.
 */

import { EQConfidence } from '@extension/services/eq/types';
import { RecommendedAction } from '@extension/services/telemetry/types';

// ============================================================================
// Scenario Definition Types
// ============================================================================

/**
 * A complete struggle scenario definition
 */
export interface StruggleScenario {
    /** Unique identifier */
    id: string;
    /** Human-readable name */
    name: string;
    /** Description of what this scenario tests */
    description: string;

    /** Expected outcome (ground truth) */
    expectedOutcome: ExpectedOutcome;

    /** Timeline of events to simulate */
    events: ScenarioEvent[];

    /** Tags for categorization */
    tags: string[];
    /** Difficulty classification */
    difficulty: 'obvious' | 'subtle' | 'edge-case';
}

/**
 * Ground truth: what we expect the detection to produce.
 * EQ-based — expectedEQ is on a 0.0–1.0 scale.
 */
export interface ExpectedOutcome {
    /** Should struggle be detected? (EQ >= 0.15 with medium+ confidence) */
    shouldDetectStruggle: boolean;
    /** Expected final EQ range (0.0–1.0) */
    expectedEQ: { min: number; max: number };
    /** Expected recommended action */
    expectedAction: RecommendedAction;
    /** Minimum expected confidence level */
    expectedMinConfidence?: EQConfidence;
    /** Optional: expected time until detection (ms) */
    expectedTimeToDetection?: number;
}

// ============================================================================
// Event Types
// ============================================================================

export type ScenarioEvent =
    | DiagnosticEvent
    | EditEvent
    | SaveEvent
    | BuildResultEvent
    | WaitEvent;

/**
 * Diagnostic event - add/remove/clear VS Code diagnostics
 */
export interface DiagnosticEvent {
    type: 'diagnostic';
    /** Relative timestamp in ms */
    timestamp: number;
    /** Action to perform */
    action: 'add' | 'remove' | 'clear';
    /** Diagnostics to add (if action is 'add') */
    diagnostics?: DiagnosticDefinition[];
}

export interface DiagnosticDefinition {
    file: string;
    line: number;
    severity: 'error' | 'warning';
    code: string;
    message: string;
    /** Diagnostic source (e.g. 'ts', 'java'). Defaults to 'compiler'. */
    source?: string;
}

/**
 * Edit event - change document content (triggers inactivity tracking)
 */
export interface EditEvent {
    type: 'edit';
    /** Relative timestamp in ms */
    timestamp: number;
    /** File being edited */
    file: string;
    /** New content of the file */
    content: string;
}

/**
 * Save event - triggers a compile-equivalent event.
 * The test runner creates an ErrorSnapshot from current diagnostics.
 */
export interface SaveEvent {
    type: 'save';
    /** Relative timestamp in ms */
    timestamp: number;
    /** File being saved */
    file: string;
}

/**
 * Build result event - simulate Artemis build result.
 * For EQ: buildFailed=true → hasErrors=true; test-failure/success → hasErrors=false.
 */
export interface BuildResultEvent {
    type: 'build';
    /** Relative timestamp in ms */
    timestamp: number;
    /** Whether build succeeded */
    success: boolean;
    /** Whether the build itself failed (compiler error). Defaults to !success if not specified. */
    buildFailed?: boolean;
    /** Error messages (if failed) */
    errors?: string[];
    /** Failed test names */
    failedTests?: string[];
}

/**
 * Wait event - advance time by specified duration
 */
export interface WaitEvent {
    type: 'wait';
    /** Duration to wait in ms (will be simulated via Sinon) */
    duration: number;
}

// ============================================================================
// Result Types
// ============================================================================

/**
 * EQ snapshot at a point in time
 */
export interface ScoreSnapshot {
    /** Timestamp when snapshot was taken */
    timestamp: number;
    /** Current EQ value (0.0–1.0) */
    eq: number;
    /** EQ confidence level */
    confidence: EQConfidence;
    /** Recommended action based on EQ and confidence */
    recommendedAction: RecommendedAction;
    /** Event type that preceded this snapshot */
    eventType: string;
}

/**
 * Result of running a single scenario
 */
export interface ScenarioResult {
    /** The scenario that was run */
    scenario: StruggleScenario;
    /** Whether the scenario passed all checks */
    passed: boolean;

    /** Detailed metrics */
    metrics: ScenarioMetrics;

    /** Full EQ timeline for debugging */
    scoreTimeline: ScoreSnapshot[];

    /** Any errors that occurred */
    errors: string[];
}

export interface ScenarioMetrics {
    // Accuracy
    /** Was the final EQ within expected range? */
    finalScoreInRange: boolean;
    /** Was struggle detected correctly? (TP/TN check) */
    detectedStruggle: boolean;
    /** Was the recommended action correct? */
    correctAction: boolean;

    // Timing
    /** Time until EQ first exceeded struggle threshold (ms) */
    timeToDetection: number | null;
    /** Time spent with EQ >= threshold when no struggle expected */
    falsePositiveTime: number;

    // EQ stats (0.0–1.0 scale)
    maxScore: number;
    minScore: number;
    avgScore: number;
    finalScore: number;
}

/**
 * Aggregated report for the entire test suite
 */
export interface TestSuiteReport {
    /** When the suite was run */
    timestamp: Date;
    /** Duration in ms */
    duration: number;

    // Summary
    totalScenarios: number;
    passed: number;
    failed: number;

    // Confusion Matrix for binary classification
    confusionMatrix: {
        truePositive: number;   // Struggle detected, was struggle
        trueNegative: number;   // No struggle detected, was no struggle
        falsePositive: number;  // Struggle detected, was no struggle
        falseNegative: number;  // No struggle detected, was struggle
    };

    // ML Metrics
    precision: number;
    recall: number;
    f1Score: number;
    accuracy: number;

    // By category
    byDifficulty: {
        obvious: CategoryResult;
        subtle: CategoryResult;
        'edge-case': CategoryResult;
    };

    // Individual results
    results: ScenarioResult[];
}

export interface CategoryResult {
    total: number;
    passed: number;
    failed: number;
    avgScore: number;
}
