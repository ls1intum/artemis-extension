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
    
    test('Full Suite - All Scenarios', async function() {
        this.timeout(120000); // 2 minutes for full suite
        
        const startTime = new Date();
        const scenarios = await loader.loadAllScenarios();
        
        if (scenarios.length === 0) {
            console.log('No scenarios found. Running inline test scenarios instead.');
            return;
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
        
        // Note: We don't fail on pass rate here - the report itself is the value
        const passRate = report.passed / report.totalScenarios;
        console.log(`\nℹ️  Pass rate: ${(passRate * 100).toFixed(1)}%`);
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
                // Check against the scenario's expected outcome, not a blanket expectation
                const expected = result.scenario.expectedOutcome.shouldDetectStruggle;
                assert.strictEqual(
                    result.metrics.detectedStruggle,
                    expected,
                    `Scenario ${result.scenario.id}: expected detectedStruggle=${expected} but got score ${result.metrics.finalScore}`
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
                    `Scenario ${result.scenario.id} should NOT detect struggle but got score ${result.metrics.finalScore}`
                );
            }
        });
    });
    
    // =========================================================================
    // Inline Scenarios (for quick testing without files)
    // =========================================================================
    
    suite('Inline Scenarios', () => {
        test('Basic persistent error detection', async function() {
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
                    { type: 'wait', duration: 30000 },  // 30 seconds
                    { type: 'wait', duration: 60000 },  // 1 minute
                    { type: 'wait', duration: 60000 },  // 2 minutes total
                    { type: 'wait', duration: 60000 },  // 3 minutes total
                ],
                expectedOutcome: {
                    shouldDetectStruggle: true,
                    expectedScore: { min: 20, max: 100 },
                    expectedAction: 'none',
                },
            });
            
            const result = await runner.runScenario(scenario);
            
            console.log(`\nInline test result:`);
            console.log(`  Final score: ${result.metrics.finalScore}`);
            console.log(`  Detected struggle: ${result.metrics.detectedStruggle}`);
            console.log(`  Passed: ${result.passed}`);
            
            // With new graduated persistence scoring:
            // 1 error at severe level (3min) = 20 * 1.0 * 0.35 = 7 points
            // Confusion pattern (3min inactive) = 60 * 0.25 = 15 points
            // Total ≈ 22 points
            assert.ok(
                result.metrics.finalScore >= 20,
                `Expected score >= 20 for persistent error with confusion, got ${result.metrics.finalScore}`
            );
        });
        
        test('Basic inactivity detection', async function() {
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
                    shouldDetectStruggle: true,
                    expectedScore: { min: 20, max: 100 },
                    expectedAction: 'subtle',
                },
            });
            
            const result = await runner.runScenario(scenario);
            
            console.log(`\nInactivity test result:`);
            console.log(`  Final score: ${result.metrics.finalScore}`);
            console.log(`  Score timeline:`);
            for (const snapshot of result.scoreTimeline) {
                console.log(`    ${snapshot.timestamp / 1000}s: score=${snapshot.score.combined}, pattern=${snapshot.score.local.inactivityPattern}`);
            }
            
            // After 5+ minutes of inactivity, score should increase
            assert.ok(
                result.metrics.finalScore >= 15,
                `Expected inactivity to increase score, got ${result.metrics.finalScore}`
            );
        });
        
        test('Build failure tracking', async function() {
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
                    shouldDetectStruggle: true,
                    expectedScore: { min: 15, max: 100 },
                    expectedAction: 'subtle',
                },
            });
            
            const result = await runner.runScenario(scenario);
            
            console.log(`\nBuild failure test result:`);
            console.log(`  Final score: ${result.metrics.finalScore}`);
            console.log(`  Consecutive failures: ${result.scoreTimeline[result.scoreTimeline.length - 1]?.score.server.consecutiveBuildFailures}`);
            
            assert.ok(
                result.metrics.finalScore >= 15,
                `Expected build failures to increase score, got ${result.metrics.finalScore}`
            );
        });
    });
});
