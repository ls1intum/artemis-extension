/**
 * Struggle Detection Test Suite — EQ-based
 *
 * Entry point for running all struggle detection scenarios.
 * Uses the real ErrorQuotientEngine with Sinon.js time simulation.
 */

import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

import { EvaluationEngine } from './EvaluationEngine';
import { ReportGenerator } from './ReportGenerator';
import { createScenario, ScenarioLoader } from './ScenarioLoader';
import { StruggleTestRunner } from './StruggleTestRunner';
import { StruggleScenario } from './types';

suite('Struggle Detection Test Suite (EQ)', () => {
    let runner: StruggleTestRunner;
    let loader: ScenarioLoader;
    let evaluator: EvaluationEngine;
    let reportGenerator: ReportGenerator;
    let projectRoot: string;

    suiteSetup(() => {
        runner = new StruggleTestRunner();
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

    test('Full Suite - All Scenarios', async function() {
        this.timeout(120000);

        const startTime = new Date();
        const scenarios = await loader.loadAllScenarios();

        if (scenarios.length === 0) {
            console.log('No scenarios found. Running inline test scenarios instead.');
            return;
        }

        console.log(`\nLoaded ${scenarios.length} scenarios`);

        const results = await runner.runScenarios(scenarios);
        const report = evaluator.generateReport(results, startTime);

        console.log(evaluator.formatConsoleReport(report));

        const timestamp = startTime.toISOString().replace(/[:.]/g, '-').substring(0, 19);
        const reportPath = path.join(projectRoot, 'test', 'struggle-detection', 'reports', `report-${timestamp}.md`);
        const latestReportPath = path.join(projectRoot, 'test', 'struggle-detection', 'reports', 'LATEST-REPORT.md');

        reportGenerator.generateAndSave(report, reportPath);
        reportGenerator.generateAndSave(report, latestReportPath);

        const passRate = report.passed / report.totalScenarios;
        console.log(`\nPass rate: ${(passRate * 100).toFixed(1)}%`);
        console.log(`   Full report: test/struggle-detection/reports/LATEST-REPORT.md`);
    });

    // =========================================================================
    // Category Tests
    // =========================================================================

    suite('Obvious Struggle Scenarios', () => {
        test('should detect obvious struggle', async function() {
            this.timeout(60000);

            const scenarios = await loader.loadByCategory('obvious');
            if (scenarios.length === 0) {
                this.skip();
                return;
            }

            const results = await runner.runScenarios(scenarios);

            for (const result of results) {
                const expected = result.scenario.expectedOutcome.shouldDetectStruggle;
                assert.strictEqual(
                    result.metrics.detectedStruggle,
                    expected,
                    `Scenario ${result.scenario.id}: expected detectedStruggle=${expected} but got EQ ${result.metrics.finalScore.toFixed(3)}`
                );
            }
        });
    });

    suite('No-Struggle Scenarios (False Positive Prevention)', () => {
        test('should NOT detect struggle in normal development', async function() {
            this.timeout(60000);

            const scenarios = await loader.loadByCategory('no-struggle');
            if (scenarios.length === 0) {
                this.skip();
                return;
            }

            const results = await runner.runScenarios(scenarios);

            for (const result of results) {
                assert.ok(
                    !result.metrics.detectedStruggle,
                    `Scenario ${result.scenario.id} should NOT detect struggle but got EQ ${result.metrics.finalScore.toFixed(3)}`
                );
            }
        });
    });

    suite('EQ-Specific Scenarios', () => {
        test('should match EQ-specific expectations', async function() {
            this.timeout(60000);

            const scenarios = await loader.loadByCategory('eq-specific');
            if (scenarios.length === 0) {
                this.skip();
                return;
            }

            const results = await runner.runScenarios(scenarios);

            for (const result of results) {
                assert.ok(
                    result.metrics.finalScoreInRange,
                    `Scenario ${result.scenario.id}: EQ ${result.metrics.finalScore.toFixed(3)} not in expected range [${result.scenario.expectedOutcome.expectedEQ.min}, ${result.scenario.expectedOutcome.expectedEQ.max}]`
                );
            }
        });
    });

    // =========================================================================
    // Inline Scenarios (quick EQ tests without scenario files)
    // =========================================================================

    suite('Inline EQ Scenarios', () => {
        test('All-clean saves → EQ = 0.0', async function() {
            this.timeout(30000);

            // 8 saves with no errors → all pairs score 0 → EQ = 0.0
            const scenario: StruggleScenario = createScenario({
                id: 'inline-all-clean',
                name: 'Inline: All Clean Saves',
                events: [
                    { type: 'save', timestamp: 0, file: 'Main.java' },
                    { type: 'wait', duration: 6000 },
                    { type: 'save', timestamp: 6000, file: 'Main.java' },
                    { type: 'wait', duration: 6000 },
                    { type: 'save', timestamp: 12000, file: 'Main.java' },
                    { type: 'wait', duration: 6000 },
                    { type: 'save', timestamp: 18000, file: 'Main.java' },
                    { type: 'wait', duration: 6000 },
                    { type: 'save', timestamp: 24000, file: 'Main.java' },
                    { type: 'wait', duration: 6000 },
                    { type: 'save', timestamp: 30000, file: 'Main.java' },
                    { type: 'wait', duration: 6000 },
                    { type: 'save', timestamp: 36000, file: 'Main.java' },
                    { type: 'wait', duration: 6000 },
                    { type: 'save', timestamp: 42000, file: 'Main.java' },
                ],
                expectedOutcome: {
                    shouldDetectStruggle: false,
                    expectedEQ: { min: 0.0, max: 0.0 },
                    expectedAction: 'none',
                },
            });

            const result = await runner.runScenario(scenario);
            console.log(`\nAll-clean: EQ=${result.metrics.finalScore.toFixed(3)}`);
            assert.strictEqual(result.metrics.finalScore, 0.0, 'All-clean saves should produce EQ=0.0');
        });

        test('All-same-error saves → EQ = 1.0', async function() {
            this.timeout(30000);

            // Add error, then 8 saves with same error → all pairs = 11/11 → EQ = 1.0
            const scenario: StruggleScenario = createScenario({
                id: 'inline-all-same-error',
                name: 'Inline: All Same Error',
                events: [
                    {
                        type: 'diagnostic', timestamp: 0, action: 'add',
                        diagnostics: [{ file: 'Main.java', line: 1, severity: 'error', code: 'ts2304', message: 'Cannot find name' }],
                    },
                    { type: 'save', timestamp: 100, file: 'Main.java' },
                    { type: 'wait', duration: 6000 },
                    { type: 'save', timestamp: 6100, file: 'Main.java' },
                    { type: 'wait', duration: 6000 },
                    { type: 'save', timestamp: 12100, file: 'Main.java' },
                    { type: 'wait', duration: 6000 },
                    { type: 'save', timestamp: 18100, file: 'Main.java' },
                    { type: 'wait', duration: 6000 },
                    { type: 'save', timestamp: 24100, file: 'Main.java' },
                    { type: 'wait', duration: 6000 },
                    { type: 'save', timestamp: 30100, file: 'Main.java' },
                    { type: 'wait', duration: 6000 },
                    { type: 'save', timestamp: 36100, file: 'Main.java' },
                    { type: 'wait', duration: 6000 },
                    { type: 'save', timestamp: 42100, file: 'Main.java' },
                ],
                expectedOutcome: {
                    shouldDetectStruggle: true,
                    expectedEQ: { min: 1.0, max: 1.0 },
                    expectedAction: 'proactive',
                },
            });

            const result = await runner.runScenario(scenario);
            console.log(`\nAll-same-error: EQ=${result.metrics.finalScore.toFixed(3)}`);
            assert.strictEqual(result.metrics.finalScore, 1.0, 'All-same-error should produce EQ=1.0');
        });

        test('Mixed clean and error saves → EQ near 0', async function() {
            this.timeout(30000);

            // Alternating: error-save, clear, clean-save → pairs alternate between (error,clean) and (clean,error) → all 0
            const scenario: StruggleScenario = createScenario({
                id: 'inline-mixed',
                name: 'Inline: Mixed Clean/Error',
                events: [
                    // error save
                    { type: 'diagnostic', timestamp: 0, action: 'add', diagnostics: [{ file: 'Main.java', line: 1, severity: 'error', code: 'e1', message: 'err' }] },
                    { type: 'save', timestamp: 100, file: 'Main.java' },
                    { type: 'wait', duration: 6000 },
                    // clean save
                    { type: 'diagnostic', timestamp: 6100, action: 'clear' },
                    { type: 'save', timestamp: 6200, file: 'Main.java' },
                    { type: 'wait', duration: 6000 },
                    // error save
                    { type: 'diagnostic', timestamp: 12200, action: 'add', diagnostics: [{ file: 'Main.java', line: 1, severity: 'error', code: 'e2', message: 'err2' }] },
                    { type: 'save', timestamp: 12300, file: 'Main.java' },
                    { type: 'wait', duration: 6000 },
                    // clean save
                    { type: 'diagnostic', timestamp: 18300, action: 'clear' },
                    { type: 'save', timestamp: 18400, file: 'Main.java' },
                    { type: 'wait', duration: 6000 },
                    // error save
                    { type: 'diagnostic', timestamp: 24400, action: 'add', diagnostics: [{ file: 'Main.java', line: 1, severity: 'error', code: 'e3', message: 'err3' }] },
                    { type: 'save', timestamp: 24500, file: 'Main.java' },
                    { type: 'wait', duration: 6000 },
                    // clean save
                    { type: 'diagnostic', timestamp: 30500, action: 'clear' },
                    { type: 'save', timestamp: 30600, file: 'Main.java' },
                    { type: 'wait', duration: 6000 },
                    // error save
                    { type: 'diagnostic', timestamp: 36600, action: 'add', diagnostics: [{ file: 'Main.java', line: 1, severity: 'error', code: 'e4', message: 'err4' }] },
                    { type: 'save', timestamp: 36700, file: 'Main.java' },
                    { type: 'wait', duration: 6000 },
                    // clean save
                    { type: 'diagnostic', timestamp: 42700, action: 'clear' },
                    { type: 'save', timestamp: 42800, file: 'Main.java' },
                ],
                expectedOutcome: {
                    shouldDetectStruggle: false,
                    expectedEQ: { min: 0.0, max: 0.0 },
                    expectedAction: 'none',
                },
            });

            const result = await runner.runScenario(scenario);
            console.log(`\nMixed: EQ=${result.metrics.finalScore.toFixed(3)}`);
            assert.strictEqual(result.metrics.finalScore, 0.0, 'Alternating clean/error should produce EQ=0.0');
        });

        test('Build compiler errors feed EQ', async function() {
            this.timeout(30000);

            // Multiple build failures with compiler errors → EQ rises
            const scenario: StruggleScenario = createScenario({
                id: 'inline-build-compiler-errors',
                name: 'Inline: Build Compiler Errors',
                events: [
                    { type: 'build', timestamp: 0, success: false, buildFailed: true, errors: ['syntax-error'] },
                    { type: 'wait', duration: 6000 },
                    { type: 'build', timestamp: 6000, success: false, buildFailed: true, errors: ['syntax-error'] },
                    { type: 'wait', duration: 6000 },
                    { type: 'build', timestamp: 12000, success: false, buildFailed: true, errors: ['syntax-error'] },
                    { type: 'wait', duration: 6000 },
                    { type: 'build', timestamp: 18000, success: false, buildFailed: true, errors: ['syntax-error'] },
                    { type: 'wait', duration: 6000 },
                    { type: 'build', timestamp: 24000, success: false, buildFailed: true, errors: ['syntax-error'] },
                    { type: 'wait', duration: 6000 },
                    { type: 'build', timestamp: 30000, success: false, buildFailed: true, errors: ['syntax-error'] },
                    { type: 'wait', duration: 6000 },
                    { type: 'build', timestamp: 36000, success: false, buildFailed: true, errors: ['syntax-error'] },
                    { type: 'wait', duration: 6000 },
                    { type: 'build', timestamp: 42000, success: false, buildFailed: true, errors: ['syntax-error'] },
                ],
                expectedOutcome: {
                    shouldDetectStruggle: true,
                    expectedEQ: { min: 1.0, max: 1.0 },
                    expectedAction: 'proactive',
                },
            });

            const result = await runner.runScenario(scenario);
            console.log(`\nBuild compiler errors: EQ=${result.metrics.finalScore.toFixed(3)}`);
            assert.strictEqual(result.metrics.finalScore, 1.0, 'Repeated same compiler errors should produce EQ=1.0');
        });

        test('Build test failures → EQ = 0 (not compiler errors)', async function() {
            this.timeout(30000);

            // Test failures (not buildFailed) → hasErrors=false → EQ stays 0
            const scenario: StruggleScenario = createScenario({
                id: 'inline-build-test-failures',
                name: 'Inline: Build Test Failures',
                events: [
                    { type: 'build', timestamp: 0, success: false, buildFailed: false, failedTests: ['test1'] },
                    { type: 'wait', duration: 6000 },
                    { type: 'build', timestamp: 6000, success: false, buildFailed: false, failedTests: ['test1'] },
                    { type: 'wait', duration: 6000 },
                    { type: 'build', timestamp: 12000, success: false, buildFailed: false, failedTests: ['test1'] },
                    { type: 'wait', duration: 6000 },
                    { type: 'build', timestamp: 18000, success: false, buildFailed: false, failedTests: ['test1'] },
                    { type: 'wait', duration: 6000 },
                    { type: 'build', timestamp: 24000, success: false, buildFailed: false, failedTests: ['test1'] },
                    { type: 'wait', duration: 6000 },
                    { type: 'build', timestamp: 30000, success: false, buildFailed: false, failedTests: ['test1'] },
                    { type: 'wait', duration: 6000 },
                    { type: 'build', timestamp: 36000, success: false, buildFailed: false, failedTests: ['test1'] },
                    { type: 'wait', duration: 6000 },
                    { type: 'build', timestamp: 42000, success: false, buildFailed: false, failedTests: ['test1'] },
                ],
                expectedOutcome: {
                    shouldDetectStruggle: false,
                    expectedEQ: { min: 0.0, max: 0.0 },
                    expectedAction: 'none',
                },
            });

            const result = await runner.runScenario(scenario);
            console.log(`\nBuild test failures: EQ=${result.metrics.finalScore.toFixed(3)}`);
            assert.strictEqual(result.metrics.finalScore, 0.0, 'Test failures (not compiler) should produce EQ=0.0');
        });
    });
});
