/**
 * Struggle Detection Test Framework - Type Definitions
 * 
 * These types define the scenario format and evaluation results.
 */

import { CombinedStruggleScore, RecommendedAction } from '../../src/services/telemetry/types';

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
    difficulty: 'obvious' | 'subtle' | 'edge-case' | 'no-struggle';
}

/**
 * Ground truth: what we expect the detection to produce
 */
export interface ExpectedOutcome {
    /** Should struggle be detected? (score >= 35) */
    shouldDetectStruggle: boolean;
    /** Expected final score range (tolerant) */
    expectedScore: { min: number; max: number };
    /** Expected recommended action */
    expectedAction: RecommendedAction;
    /** Optional: expected time until detection (ms) */
    expectedTimeToDetection?: number;
}

// ============================================================================
// Event Types
// ============================================================================

export type ScenarioEvent =
    | DiagnosticEvent
    | EditEvent
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
}

/**
 * Edit event - change document content (triggers thrashing/inactivity tracking)
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
 * Build result event - simulate Artemis build result
 */
export interface BuildResultEvent {
    type: 'build';
    /** Relative timestamp in ms */
    timestamp: number;
    /** Whether build succeeded */
    success: boolean;
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
 * Score snapshot at a point in time
 */
export interface ScoreSnapshot {
    /** Timestamp when score was taken */
    timestamp: number;
    /** The calculated score */
    score: CombinedStruggleScore;
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

    /** Full score timeline for debugging */
    scoreTimeline: ScoreSnapshot[];

    /** Any errors that occurred */
    errors: string[];
}

export interface ScenarioMetrics {
    // Accuracy
    /** Was the final score within expected range? */
    finalScoreInRange: boolean;
    /** Was struggle detected correctly? (TP/TN check) */
    detectedStruggle: boolean;
    /** Was the recommended action correct? */
    correctAction: boolean;

    // Timing
    /** Time until score first exceeded threshold (ms) */
    timeToDetection: number | null;
    /** Time spent with score >= threshold when no struggle expected */
    falsePositiveTime: number;

    // Score stats
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
        'no-struggle': CategoryResult;
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
