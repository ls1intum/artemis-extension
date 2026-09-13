/**
 * Struggle Detection Test Runner (EQ-based)
 *
 * Runs scenarios against the ErrorQuotientEngine.
 * Save events create ErrorSnapshots from active diagnostics.
 * Build events create ErrorSnapshots from build classification.
 * Uses Sinon.js for time simulation.
 */

import * as sinon from 'sinon';

import { ErrorQuotientEngine } from '@extension/services/telemetry/metrics/errorQuotientEngine';
import { EQConfidence, ErrorSnapshot, RecommendedAction } from '@extension/services/telemetry/types';

import {
    BuildResultEvent,
    DiagnosticDefinition,
    DiagnosticEvent,
    SaveEvent,
    ScenarioEvent,
    ScenarioMetrics,
    ScenarioResult,
    ScoreSnapshot,
    StruggleScenario,
} from './types';

/** Mirrors the lint-source denylist in the production code. */
const LINT_SOURCE_DENYLIST = new Set([
    'eslint', 'tslint', 'stylelint', 'checkstyle', 'pmd', 'spotbugs', 'sonarlint',
]);

/** Mirrors the EQ struggle threshold in TelemetryManager. */
const EQ_STRUGGLE_THRESHOLD = 0.15;

/** Mirrors the recommended-action thresholds in InterventionDecisionEngine. */
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

    // Real EQ engine, instantiated fresh for each scenario
    private eqEngine: ErrorQuotientEngine | undefined;

    private activeDiagnostics: Map<string, DiagnosticDefinition[]> = new Map();

    async runScenario(scenario: StruggleScenario): Promise<ScenarioResult> {
        const errors: string[] = [];
        const scoreSnapshots: ScoreSnapshot[] = [];

        try {
            // Install the fake timers BEFORE creating any service.
            this.clock = sinon.useFakeTimers({
                now: 0,
                toFake: ['Date', 'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval'],
                shouldClearNativeTimers: true,
            });

            this.eqEngine = new ErrorQuotientEngine();
            this.activeDiagnostics.clear();

            let currentTime = 0;
            for (const event of scenario.events) {
                try {
                    if (event.type === 'wait') {
                        this.clock.tick(event.duration);
                        currentTime += event.duration;
                    } else {
                        const eventTimestamp = (event as { timestamp?: number }).timestamp ?? currentTime;
                        if (eventTimestamp > currentTime) {
                            this.clock.tick(eventTimestamp - currentTime);
                            currentTime = eventTimestamp;
                        }

                        this.applyEvent(event);
                    }

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
            this.eqEngine?.dispose();
            this.eqEngine = undefined;
            this.activeDiagnostics.clear();
            this.clock?.restore();
            this.clock = undefined;
        }

        return this.evaluateScenario(scenario, scoreSnapshots, errors);
    }

    async runScenarios(scenarios: StruggleScenario[]): Promise<ScenarioResult[]> {
        const results: ScenarioResult[] = [];

        for (const scenario of scenarios) {
            console.log(`Running scenario: ${scenario.id}`);
            const result = await this.runScenario(scenario);
            results.push(result);
        }

        return results;
    }

    private applyEvent(event: ScenarioEvent): void {
        switch (event.type) {
            case 'diagnostic':
                this.applyDiagnosticEvent(event);
                break;
            case 'edit':
                // Edits do not affect EQ; they only change file state.
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
     * Updates the active diagnostics state. Does NOT create an EQ snapshot;
     * only a save or build event does.
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
     * Creates an ErrorSnapshot from the active diagnostics and feeds it to the
     * EQ engine. This is the primary compile-equivalent event.
     */
    private applySaveEvent(_event: SaveEvent): void {
        const snapshot = this.createSnapshotFromDiagnostics();
        this.eqEngine!.addSnapshot(snapshot);
    }

    /**
     * Creates an ErrorSnapshot from the build classification.
     * buildFailed → hasErrors=true (compiler error).
     * test-failure or success → hasErrors=false.
     */
    private applyBuildEvent(event: BuildResultEvent): void {
        const buildFailed = event.buildFailed ?? !event.success;

        // Only compiler errors count as "errors" for EQ
        const hasErrors = buildFailed;

        const errorFamilies = new Set<string>();
        if (buildFailed && event.errors) {
            for (const err of event.errors) {
                errorFamilies.add(`build:${err}`);
            }
        }
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

        let timeToDetection: number | null = null;
        for (const snapshot of snapshots) {
            if (isStruggling(snapshot.eq, snapshot.confidence)) {
                timeToDetection = snapshot.timestamp;
                break;
            }
        }

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
