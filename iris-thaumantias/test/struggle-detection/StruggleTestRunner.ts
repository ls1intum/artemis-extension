/**
 * Struggle Detection Test Runner — EQ-based
 *
 * Runs scenarios against the ErrorQuotientEngine.
 * Save events create ErrorSnapshots from active diagnostics.
 * Build events create ErrorSnapshots from build classification.
 * Uses Sinon.js for time simulation.
 */

import * as sinon from 'sinon';

import { ErrorQuotientEngine } from '../../src/services/telemetry/metrics/errorQuotientEngine';
import { ErrorSnapshot, EQConfidence, RecommendedAction } from '../../src/services/telemetry/types';

import {
    StruggleScenario,
    ScenarioEvent,
    ScenarioResult,
    ScoreSnapshot,
    ScenarioMetrics,
    DiagnosticEvent,
    DiagnosticDefinition,
    EditEvent,
    SaveEvent,
    BuildResultEvent,
} from './types';

/** LINT_SOURCE_DENYLIST — matches the production code */
const LINT_SOURCE_DENYLIST = new Set([
    'eslint', 'tslint', 'stylelint', 'checkstyle', 'pmd', 'spotbugs', 'sonarlint',
]);

/** EQ struggle threshold — matches TelemetryManager */
const EQ_STRUGGLE_THRESHOLD = 0.15;

/**
 * EQ thresholds for recommended action — matches InterventionDecisionEngine.
 */
function getRecommendedAction(eq: number, confidence: EQConfidence): RecommendedAction {
    if (confidence === 'insufficient') {
        return 'none';
    }
    if (eq >= 0.60) { return 'proactive'; }
    if (eq >= 0.35) { return 'notification'; }
    if (eq >= 0.15) { return 'subtle'; }
    return 'none';
}

function isStruggling(eq: number, confidence: EQConfidence): boolean {
    return confidence !== 'insufficient' && eq >= EQ_STRUGGLE_THRESHOLD;
}

/**
 * Test runner that executes scenarios against the ErrorQuotientEngine.
 * Time is controlled via Sinon.js fake timers.
 */
export class StruggleTestRunner {
    private clock: sinon.SinonFakeTimers | undefined;

    // Real EQ engine — instantiated fresh for each scenario
    private eqEngine: ErrorQuotientEngine | undefined;

    // Active diagnostics state (simulated)
    private activeDiagnostics: Map<string, DiagnosticDefinition[]> = new Map();

    /**
     * Run a single scenario and return the result
     */
    async runScenario(scenario: StruggleScenario): Promise<ScenarioResult> {
        const errors: string[] = [];
        const scoreSnapshots: ScoreSnapshot[] = [];

        try {
            // 1. Setup: Install fake timers BEFORE creating services
            this.clock = sinon.useFakeTimers({
                now: 0,
                toFake: ['Date', 'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval'],
                shouldClearNativeTimers: true,
            });

            // 2. Initialize EQ engine
            this.eqEngine = new ErrorQuotientEngine();
            this.activeDiagnostics.clear();

            // 3. Execute events and record EQ
            let currentTime = 0;
            for (const event of scenario.events) {
                try {
                    // For wait events, advance time by the duration
                    if (event.type === 'wait') {
                        this.clock.tick(event.duration);
                        currentTime += event.duration;
                    } else {
                        // For other events, advance time to the event's timestamp
                        const eventTimestamp = (event as { timestamp?: number }).timestamp ?? currentTime;
                        if (eventTimestamp > currentTime) {
                            this.clock.tick(eventTimestamp - currentTime);
                            currentTime = eventTimestamp;
                        }

                        // Apply the event
                        this.applyEvent(event);
                    }

                    // Record EQ snapshot
                    const { eq, confidence } = this.eqEngine.getCurrentEQ();
                    const action = getRecommendedAction(eq, confidence);
                    scoreSnapshots.push({
                        timestamp: Date.now(),
                        eq,
                        confidence,
                        recommendedAction: action,
                        eventType: event.type,
                    });
                } catch (err) {
                    errors.push(`Event ${event.type} failed: ${err}`);
                }
            }

        } catch (err) {
            errors.push(`Scenario setup failed: ${err}`);
        } finally {
            // Cleanup
            this.eqEngine?.dispose();
            this.eqEngine = undefined;
            this.activeDiagnostics.clear();
            this.clock?.restore();
            this.clock = undefined;
        }

        // Evaluate result
        return this.evaluateScenario(scenario, scoreSnapshots, errors);
    }

    /**
     * Run multiple scenarios and return aggregated report
     */
    async runScenarios(scenarios: StruggleScenario[]): Promise<ScenarioResult[]> {
        const results: ScenarioResult[] = [];

        for (const scenario of scenarios) {
            console.log(`Running scenario: ${scenario.id}`);
            const result = await this.runScenario(scenario);
            results.push(result);
        }

        return results;
    }

    /**
     * Apply an event to the EQ engine
     */
    private applyEvent(event: ScenarioEvent): void {
        switch (event.type) {
            case 'diagnostic':
                this.applyDiagnosticEvent(event);
                break;
            case 'edit':
                // Edits don't directly affect EQ — they just change file state.
                // Kept for backward compatibility with existing scenarios.
                break;
            case 'save':
                this.applySaveEvent(event);
                break;
            case 'build':
                this.applyBuildEvent(event);
                break;
            case 'wait':
                // Time advancement is handled in runScenario
                break;
        }
    }

    /**
     * Apply a diagnostic event — updates the active diagnostics state.
     * Does NOT create an EQ snapshot; only a save or build event does.
     */
    private applyDiagnosticEvent(event: DiagnosticEvent): void {
        if (event.action === 'clear') {
            this.activeDiagnostics.clear();
            return;
        }

        if (event.action === 'add' && event.diagnostics) {
            for (const diag of event.diagnostics) {
                const key = diag.file;
                const existing = this.activeDiagnostics.get(key) ?? [];
                existing.push(diag);
                this.activeDiagnostics.set(key, existing);
            }
        }

        if (event.action === 'remove') {
            this.activeDiagnostics.clear();
        }
    }

    /**
     * Apply a save event — create ErrorSnapshot from active diagnostics and feed to EQ engine.
     * This is the primary compile-equivalent event.
     */
    private applySaveEvent(_event: SaveEvent): void {
        const snapshot = this.createSnapshotFromDiagnostics();
        this.eqEngine!.addSnapshot(snapshot);
    }

    /**
     * Apply a build event — create ErrorSnapshot from build classification.
     * buildFailed → hasErrors=true (compiler error).
     * test-failure or success → hasErrors=false.
     */
    private applyBuildEvent(event: BuildResultEvent): void {
        const buildFailed = event.buildFailed ?? !event.success;
        const hasTestFailure = !event.success && !buildFailed && (event.failedTests?.length ?? 0) > 0;

        // Only compiler errors count as "errors" for EQ
        const hasErrors = buildFailed;

        const errorFamilies = new Set<string>();
        if (buildFailed && event.errors) {
            for (const err of event.errors) {
                errorFamilies.add(`build:${err}`);
            }
        }
        // If buildFailed but no specific errors listed, add a generic one
        if (buildFailed && errorFamilies.size === 0) {
            errorFamilies.add('build:compiler-error');
        }

        const snapshot: ErrorSnapshot = {
            timestamp: Date.now(),
            hasErrors,
            errorFamilies,
            errorCount: hasErrors ? Math.max(1, event.errors?.length ?? 1) : 0,
        };

        this.eqEngine!.addSnapshot(snapshot);
    }

    /**
     * Create an ErrorSnapshot from the current active diagnostics.
     * Filters: severity=error, not in lint denylist.
     */
    private createSnapshotFromDiagnostics(): ErrorSnapshot {
        const errorFamilies = new Set<string>();
        let errorCount = 0;

        for (const [_file, diagnostics] of this.activeDiagnostics) {
            for (const diag of diagnostics) {
                if (diag.severity !== 'error') {
                    continue;
                }
                const source = diag.source ?? 'compiler';
                if (LINT_SOURCE_DENYLIST.has(source.toLowerCase())) {
                    continue;
                }
                errorFamilies.add(`${source}:${diag.code}`);
                errorCount++;
            }
        }

        return {
            timestamp: Date.now(),
            hasErrors: errorFamilies.size > 0,
            errorFamilies,
            errorCount,
        };
    }

    /**
     * Evaluate scenario result against expected outcome
     */
    private evaluateScenario(
        scenario: StruggleScenario,
        snapshots: ScoreSnapshot[],
        errors: string[]
    ): ScenarioResult {
        const metrics = this.calculateMetrics(scenario, snapshots);

        const passed = errors.length === 0 &&
            metrics.finalScoreInRange &&
            metrics.detectedStruggle === scenario.expectedOutcome.shouldDetectStruggle &&
            metrics.correctAction;

        return {
            scenario,
            passed,
            metrics,
            scoreTimeline: snapshots,
            errors,
        };
    }

    /**
     * Calculate detailed metrics from EQ timeline
     */
    private calculateMetrics(
        scenario: StruggleScenario,
        snapshots: ScoreSnapshot[]
    ): ScenarioMetrics {
        if (snapshots.length === 0) {
            return {
                finalScoreInRange: false,
                detectedStruggle: false,
                correctAction: false,
                timeToDetection: null,
                falsePositiveTime: 0,
                maxScore: 0,
                minScore: 0,
                avgScore: 0,
                finalScore: 0,
            };
        }

        const eqs = snapshots.map(s => s.eq);
        const finalSnapshot = snapshots[snapshots.length - 1];
        const finalEQ = finalSnapshot.eq;
        const finalConfidence = finalSnapshot.confidence;
        const expected = scenario.expectedOutcome;

        // Find time to detection
        let timeToDetection: number | null = null;
        for (const snapshot of snapshots) {
            if (isStruggling(snapshot.eq, snapshot.confidence)) {
                timeToDetection = snapshot.timestamp;
                break;
            }
        }

        // Calculate false positive time
        let falsePositiveTime = 0;
        if (!expected.shouldDetectStruggle) {
            let lastTimestamp = 0;
            for (const snapshot of snapshots) {
                if (isStruggling(snapshot.eq, snapshot.confidence)) {
                    falsePositiveTime += snapshot.timestamp - lastTimestamp;
                }
                lastTimestamp = snapshot.timestamp;
            }
        }

        return {
            finalScoreInRange: finalEQ >= expected.expectedEQ.min &&
                finalEQ <= expected.expectedEQ.max,
            detectedStruggle: isStruggling(finalEQ, finalConfidence),
            correctAction: finalSnapshot.recommendedAction === expected.expectedAction,
            timeToDetection,
            falsePositiveTime,
            maxScore: Math.max(...eqs),
            minScore: Math.min(...eqs),
            avgScore: eqs.reduce((a, b) => a + b, 0) / eqs.length,
            finalScore: finalEQ,
        };
    }

    dispose(): void {
        // Nothing to dispose
    }
}
