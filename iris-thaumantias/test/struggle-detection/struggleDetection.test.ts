/**
 * Struggle Detection Test Suite
 * 
 * Entry point for running all struggle detection scenarios.
 * Uses real telemetry services with Sinon.js time simulation.
 */

import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import { StruggleTestRunner } from './StruggleTestRunner';
import { ScenarioLoader, createScenario } from './ScenarioLoader';
import { EvaluationEngine } from './EvaluationEngine';
import { ReportGenerator } from './ReportGenerator';
import { StruggleScenario } from './types';

suite('Struggle Detection Test Suite', () => {
    let runner: StruggleTestRunner;
    let loader: ScenarioLoader;
    let evaluator: EvaluationEngine;
    let reportGenerator: ReportGenerator;
    let projectRoot: string;

    suiteSetup(() => {
        runner = new StruggleTestRunner();
        // __dirname is out/test/struggle-detection, but scenarios are in test/struggle-detection/scenarios
        // Go up 3 levels to project root, then into test/struggle-detection/scenarios
        projectRoot = path.join(__dirname, '..', '..', '..');
        const scenariosPath = path.join(projectRoot, 'test', 'struggle-detection', 'scenarios');
        loader = new ScenarioLoader(scenariosPath);
        evaluator = new EvaluationEngine();
        reportGenerator = new ReportGenerator();

        // Ensure reports directory exists
        const reportsDir = path.join(projectRoot, 'test', 'struggle-detection', 'reports');
        if (!fs.existsSync(reportsDir)) {
            fs.mkdirSync(reportsDir, { recursive: true });
        }
    });

    suiteTeardown(() => {
        runner.dispose();
    });

    // =========================================================================
    // Full Suite Test (runs all scenarios)
    // =========================================================================

    test('Full Suite - All Scenarios', async function () {
        this.timeout(120000); // 2 minutes for full suite

        const startTime = new Date();
        const scenarios = await loader.loadAllScenarios();

        if (scenarios.length === 0) {
            // Fail explicitly when no scenarios are found - this is a configuration error
            assert.fail('No scenarios found in test/struggle-detection/scenarios/. This is a configuration error.');
        }

        console.log(`\nLoaded ${scenarios.length} scenarios`);

        const results = await runner.runScenarios(scenarios);
        const report = evaluator.generateReport(results, startTime);

        // Print short console report
        console.log(evaluator.formatConsoleReport(report));

        // Generate comprehensive report file
        const timestamp = startTime.toISOString().replace(/[:.]/g, '-').substring(0, 19);
        const reportPath = path.join(projectRoot, 'test', 'struggle-detection', 'reports', `report-${timestamp}.md`);
        const latestReportPath = path.join(projectRoot, 'test', 'struggle-detection', 'reports', 'LATEST-REPORT.md');

        reportGenerator.generateAndSave(report, reportPath);
        reportGenerator.generateAndSave(report, latestReportPath);

        // CRITICAL: Actually assert on failures so CI catches regressions
        const passRate = report.passed / report.totalScenarios;
        console.log(`\nℹ️  Pass rate: ${(passRate * 100).toFixed(1)}%`);
        console.log(`   Full report: test/struggle-detection/reports/LATEST-REPORT.md`);

        // Assert that all scenarios passed
        assert.strictEqual(
            report.failed,
            0,
            `${report.failed} scenario(s) failed. Check LATEST-REPORT.md for details. ` +
            `Failed: ${results.filter(r => !r.passed).map(r => r.scenario.id).join(', ')}`
        );
    });

    // =========================================================================
    // Category Tests
    // =========================================================================

    suite('Obvious Struggle Scenarios', () => {
        test('should detect obvious struggle', async function () {
            this.timeout(60000);

            const scenarios = await loader.loadByCategory('obvious');
            if (scenarios.length === 0) {
                this.skip();
                return;
            }

            const results = await runner.runScenarios(scenarios);

            for (const result of results) {
                // Check detection
                assert.ok(
                    result.metrics.detectedStruggle,
                    `Scenario ${result.scenario.id} should detect struggle but got score ${result.metrics.finalScore}`
                );

                // Check score range
                assert.ok(
                    result.metrics.finalScoreInRange,
                    `Scenario ${result.scenario.id} score ${result.metrics.finalScore} outside expected range ` +
                    `${result.scenario.expectedOutcome.expectedScore.min}-${result.scenario.expectedOutcome.expectedScore.max}`
                );

                // Check action
                assert.ok(
                    result.metrics.correctAction,
                    `Scenario ${result.scenario.id} expected action ${result.scenario.expectedOutcome.expectedAction} ` +
                    `but got ${result.scoreTimeline[result.scoreTimeline.length - 1]?.score.recommendedAction}`
                );
            }
        });
    });

    suite('No-Struggle Scenarios (False Positive Prevention)', () => {
        test('should NOT detect struggle in normal development', async function () {
            this.timeout(60000);

            const scenarios = await loader.loadByCategory('no-struggle');
            if (scenarios.length === 0) {
                this.skip();
                return;
            }

            const results = await runner.runScenarios(scenarios);

            for (const result of results) {
                // Check no detection
                assert.ok(
                    !result.metrics.detectedStruggle,
                    `Scenario ${result.scenario.id} should NOT detect struggle but got score ${result.metrics.finalScore}`
                );

                // Check score range
                assert.ok(
                    result.metrics.finalScoreInRange,
                    `Scenario ${result.scenario.id} score ${result.metrics.finalScore} outside expected range ` +
                    `${result.scenario.expectedOutcome.expectedScore.min}-${result.scenario.expectedOutcome.expectedScore.max}`
                );

                // Check action is 'none'
                assert.ok(
                    result.metrics.correctAction,
                    `Scenario ${result.scenario.id} expected action ${result.scenario.expectedOutcome.expectedAction} ` +
                    `but got ${result.scoreTimeline[result.scoreTimeline.length - 1]?.score.recommendedAction}`
                );
            }
        });
    });

    // =========================================================================
    // Inline Scenarios (for quick testing without files)
    // =========================================================================

    /** Struggle detection threshold - scores >= this indicate struggle */
    const STRUGGLE_THRESHOLD = 35;

    suite('Inline Scenarios', () => {
        test('Basic persistent error detection', async function () {
            this.timeout(30000);

            const scenario: StruggleScenario = createScenario({
                id: 'inline-persistent-error',
                name: 'Inline: Persistent Error',
                events: [
                    {
                        type: 'diagnostic',
                        timestamp: 0,
                        action: 'add',
                        diagnostics: [{
                            file: 'Test.java',
                            line: 1,
                            severity: 'error',
                            code: 'test-error',
                            message: 'Test error message',
                        }],
                    },
                    { type: 'wait', duration: 60000 },  // 1 minute
                    { type: 'wait', duration: 60000 },  // 2 minutes total
                    { type: 'wait', duration: 60000 },  // 3 minutes total
                    { type: 'wait', duration: 60000 },  // 4 minutes total  
                    { type: 'wait', duration: 60000 },  // 5 minutes total - should trigger giving-up
                    { type: 'wait', duration: 60000 },  // 6 minutes total
                ],
                expectedOutcome: {
                    shouldDetectStruggle: true,
                    expectedScore: { min: 35, max: 100 },
                    expectedAction: 'subtle',
                },
            });

            const result = await runner.runScenario(scenario);

            console.log(`\nInline test result:`);
            console.log(`  Final score: ${result.metrics.finalScore}`);
            console.log(`  Detected struggle: ${result.metrics.detectedStruggle}`);
            console.log(`  Passed: ${result.passed}`);

            // Check that detection matches expectation
            assert.strictEqual(
                result.metrics.detectedStruggle,
                scenario.expectedOutcome.shouldDetectStruggle,
                `Expected struggle detection to be ${scenario.expectedOutcome.shouldDetectStruggle} but got ${result.metrics.detectedStruggle} (score: ${result.metrics.finalScore})`
            );

            // Check score is in expected range
            assert.ok(
                result.metrics.finalScoreInRange,
                `Score ${result.metrics.finalScore} outside expected range ${scenario.expectedOutcome.expectedScore.min}-${scenario.expectedOutcome.expectedScore.max}`
            );
        });

        test('Basic inactivity detection', async function () {
            this.timeout(30000);

            const scenario: StruggleScenario = createScenario({
                id: 'inline-inactivity',
                name: 'Inline: Inactivity',
                events: [
                    {
                        type: 'edit',
                        timestamp: 0,
                        file: 'Test.java',
                        content: '// initial',
                    },
                    { type: 'wait', duration: 60000 },   // 1 min: thinking
                    { type: 'wait', duration: 60000 },   // 2 min: still thinking
                    { type: 'wait', duration: 60000 },   // 3 min: confusion
                    { type: 'wait', duration: 60000 },   // 4 min: confusion
                    { type: 'wait', duration: 60000 },   // 5 min: giving-up
                    { type: 'wait', duration: 60000 },   // 6 min: giving-up
                ],
                expectedOutcome: {
                    shouldDetectStruggle: false, // Inactivity alone without errors shouldn't trigger
                    expectedScore: { min: 0, max: 34 },
                    expectedAction: 'none',
                },
            });

            const result = await runner.runScenario(scenario);

            console.log(`\nInactivity test result:`);
            console.log(`  Final score: ${result.metrics.finalScore}`);
            console.log(`  Score timeline:`);
            for (const snapshot of result.scoreTimeline) {
                console.log(`    ${snapshot.timestamp / 1000}s: score=${snapshot.score.combined}, pattern=${snapshot.score.local.inactivityPattern}`);
            }

            // After 6 minutes of inactivity without errors, score should be elevated but not struggle
            assert.ok(
                result.metrics.finalScore >= 15 && result.metrics.finalScore < STRUGGLE_THRESHOLD,
                `Expected inactivity to increase score to 15-34, got ${result.metrics.finalScore}`
            );
        });

        test('Build failure tracking', async function () {
            this.timeout(30000);

            const scenario: StruggleScenario = createScenario({
                id: 'inline-build-failures',
                name: 'Inline: Build Failures',
                events: [
                    { type: 'build', timestamp: 0, success: false, errors: ['error1'], failedTests: ['test1'] },
                    { type: 'wait', duration: 10000 },
                    { type: 'build', timestamp: 10000, success: false, errors: ['error1'], failedTests: ['test1'] },
                    { type: 'wait', duration: 10000 },
                    { type: 'build', timestamp: 20000, success: false, errors: ['error1'], failedTests: ['test1'] },
                    { type: 'wait', duration: 10000 },
                    { type: 'build', timestamp: 30000, success: false, errors: ['error1'], failedTests: ['test1'] },
                    { type: 'wait', duration: 10000 },
                    { type: 'build', timestamp: 40000, success: false, errors: ['error1'], failedTests: ['test1'] },
                ],
                expectedOutcome: {
                    shouldDetectStruggle: false, // 5 failures alone without time passing shouldn't trigger
                    expectedScore: { min: 15, max: 34 },
                    expectedAction: 'none',
                },
            });

            const result = await runner.runScenario(scenario);

            console.log(`\nBuild failure test result:`);
            console.log(`  Final score: ${result.metrics.finalScore}`);
            console.log(`  Consecutive failures: ${result.scoreTimeline[result.scoreTimeline.length - 1]?.score.server.consecutiveBuildFailures}`);

            // Build failures should increase score but not necessarily trigger struggle alone
            assert.ok(
                result.metrics.finalScore >= 15,
                `Expected build failures to increase score to at least 15, got ${result.metrics.finalScore}`
            );

            // Check consecutive failures are tracked
            const lastSnapshot = result.scoreTimeline[result.scoreTimeline.length - 1];
            assert.ok(
                lastSnapshot?.score.server.consecutiveBuildFailures >= 4,
                `Expected at least 4 consecutive failures tracked, got ${lastSnapshot?.score.server.consecutiveBuildFailures}`
            );
        });

        test('Build success resets consecutive failures', async function () {
            this.timeout(30000);

            const scenario: StruggleScenario = createScenario({
                id: 'inline-build-success-reset',
                name: 'Inline: Build Success Reset',
                events: [
                    { type: 'build', timestamp: 0, success: false, errors: ['error1'], failedTests: [] },
                    { type: 'wait', duration: 5000 },
                    { type: 'build', timestamp: 5000, success: false, errors: ['error1'], failedTests: [] },
                    { type: 'wait', duration: 5000 },
                    { type: 'build', timestamp: 10000, success: false, errors: ['error1'], failedTests: [] },
                    { type: 'wait', duration: 5000 },
                    // Success should reset counter
                    { type: 'build', timestamp: 15000, success: true, errors: [], failedTests: [] },
                    { type: 'wait', duration: 5000 },
                ],
                expectedOutcome: {
                    shouldDetectStruggle: false,
                    expectedScore: { min: 0, max: 20 },
                    expectedAction: 'none',
                },
            });

            const result = await runner.runScenario(scenario);

            console.log(`\nBuild success reset test:`);
            console.log(`  Final score: ${result.metrics.finalScore}`);

            // After success, consecutive failures should be 0
            const lastSnapshot = result.scoreTimeline[result.scoreTimeline.length - 1];
            assert.strictEqual(
                lastSnapshot?.score.server.consecutiveBuildFailures,
                0,
                `Expected consecutive failures to reset to 0 after success, got ${lastSnapshot?.score.server.consecutiveBuildFailures}`
            );
        });
    });
});
