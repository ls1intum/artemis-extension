/**
 * Struggle Detection Test Framework - Type Definitions
 *
 * EQ-based types (Jadud 2006). Scenarios generate ErrorSnapshots
 * from save/build events and verify the resulting EQ value.
 */

import { EQConfidence, RecommendedAction } from '@extension/services/telemetry/types';

export interface StruggleScenario {
    id: string;
    name: string;
    description: string;

    expectedOutcome: ExpectedOutcome;

    /** Timeline of events to simulate */
    events: ScenarioEvent[];

    tags: string[];
    difficulty: 'obvious' | 'subtle' | 'edge-case';
}

/**
 * Ground truth: what the detection is expected to produce.
 * expectedEQ is on a 0.0-1.0 scale.
 */
export interface ExpectedOutcome {
    /** Struggle counts as detected at EQ >= 0.15 with medium+ confidence. */
    shouldDetectStruggle: boolean;
    expectedEQ: { min: number; max: number };
    expectedAction: RecommendedAction;
    expectedMinConfidence?: EQConfidence;
    /** Expected time until detection, in ms. */
    expectedTimeToDetection?: number;
}

export type ScenarioEvent =
    | DiagnosticEvent
    | EditEvent
    | SaveEvent
    | BuildResultEvent
    | WaitEvent;

/** Adds, removes, or clears VS Code diagnostics. */
export interface DiagnosticEvent {
    type: 'diagnostic';
    /** Relative timestamp in ms */
    timestamp: number;
    action: 'add' | 'remove' | 'clear';
    /** Only read when action is 'add'. */
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

/** Changes document content, which also feeds inactivity tracking. */
export interface EditEvent {
    type: 'edit';
    /** Relative timestamp in ms */
    timestamp: number;
    file: string;
    content: string;
}

/**
 * Triggers a compile-equivalent event: the runner creates an ErrorSnapshot
 * from the current diagnostics.
 */
export interface SaveEvent {
    type: 'save';
    /** Relative timestamp in ms */
    timestamp: number;
    file: string;
}

/**
 * Simulated Artemis build result.
 * For EQ: buildFailed=true → hasErrors=true; test-failure/success → hasErrors=false.
 */
export interface BuildResultEvent {
    type: 'build';
    /** Relative timestamp in ms */
    timestamp: number;
    success: boolean;
    /** Whether the build itself failed (compiler error). Defaults to !success. */
    buildFailed?: boolean;
    errors?: string[];
    failedTests?: string[];
}

export interface WaitEvent {
    type: 'wait';
    /** Duration to wait in ms (simulated via Sinon) */
    duration: number;
}

export interface ScoreSnapshot {
    timestamp: number;
    /** Current EQ value (0.0-1.0) */
    eq: number;
    confidence: EQConfidence;
    recommendedAction: RecommendedAction;
    /** Event type that preceded this snapshot */
    eventType: string;
}

export interface ScenarioResult {
    scenario: StruggleScenario;
    passed: boolean;

    metrics: ScenarioMetrics;

    scoreTimeline: ScoreSnapshot[];

    errors: string[];
}

export interface ScenarioMetrics {
    finalScoreInRange: boolean;
    detectedStruggle: boolean;
    correctAction: boolean;

    /** Time until EQ first exceeded the struggle threshold (ms) */
    timeToDetection: number | null;
    /** Time spent with EQ >= threshold when no struggle was expected */
    falsePositiveTime: number;

    // EQ stats (0.0-1.0 scale)
    maxScore: number;
    minScore: number;
    avgScore: number;
    finalScore: number;
}

/**
 * Aggregated report for the entire test suite
 */
export interface TestSuiteReport {
    timestamp: Date;
    /** Duration in ms */
    duration: number;

    totalScenarios: number;
    passed: number;
    failed: number;

    confusionMatrix: {
        truePositive: number;   // Struggle detected, was struggle
        trueNegative: number;   // No struggle detected, was no struggle
        falsePositive: number;  // Struggle detected, was no struggle
        falseNegative: number;  // No struggle detected, was struggle
    };

    precision: number;
    recall: number;
    f1Score: number;
    accuracy: number;

    byDifficulty: {
        obvious: CategoryResult;
        subtle: CategoryResult;
        'edge-case': CategoryResult;
    };

    results: ScenarioResult[];
}

export interface CategoryResult {
    total: number;
    passed: number;
    failed: number;
    avgScore: number;
}
