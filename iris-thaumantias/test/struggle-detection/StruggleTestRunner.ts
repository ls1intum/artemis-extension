/**
 * Struggle Detection Test Runner
 * 
 * Runs scenarios against the REAL telemetry services in VS Code Extension Host.
 * Uses Sinon.js for time simulation - no code changes to services needed.
 */

import * as vscode from 'vscode';
import * as sinon from 'sinon';

import { DiagnosticPersistenceService } from '../../src/services/telemetry/diagnosticPersistenceService';
import { InactivityService } from '../../src/services/telemetry/inactivityService';
import { ThrashingDetector } from '../../src/services/telemetry/thrashingDetector';
import { BuildResultTracker } from '../../src/services/telemetry/buildResultTracker';
import { StruggleScoreService } from '../../src/services/telemetry/struggleScoreService';
import { TrackedDiagnostic } from '../../src/services/telemetry/types';

import {
    StruggleScenario,
    ScenarioEvent,
    ScenarioResult,
    ScoreSnapshot,
    ScenarioMetrics,
    DiagnosticEvent,
    EditEvent,
    BuildResultEvent,
} from './types';

/** Threshold for "struggle detected" */
const STRUGGLE_THRESHOLD = 35;

/**
 * Test runner that executes scenarios against real services.
 * Time is controlled via Sinon.js fake timers.
 */
export class StruggleTestRunner implements vscode.Disposable {
    private clock: sinon.SinonFakeTimers | undefined;
    private diagnosticCollection: vscode.DiagnosticCollection;
    
    // Real services - instantiated fresh for each scenario
    private diagnosticService: DiagnosticPersistenceService | undefined;
    private inactivityService: InactivityService | undefined;
    private thrashingDetector: ThrashingDetector | undefined;
    private buildTracker: BuildResultTracker | undefined;
    private scoreService: StruggleScoreService | undefined;
    
    // Test file tracking
    private testFileUri: vscode.Uri | undefined;
    private testDocument: vscode.TextDocument | undefined;
    
    constructor() {
        this.diagnosticCollection = vscode.languages.createDiagnosticCollection('struggle-test');
    }
    
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
            
            // 2. Initialize real services (they'll use faked time)
            this.initializeServices();
            
            // 3. Create test file
            await this.setupTestFile(scenario);
            
            // 4. Execute events and record scores
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
                        await this.applyEvent(event);
                    }
                    
                    // Record score snapshot
                    const score = this.scoreService!.calculateScore();
                    scoreSnapshots.push({
                        timestamp: Date.now(),
                        score,
                        eventType: event.type,
                    });
                } catch (err) {
                    errors.push(`Event ${event.type} failed: ${err}`);
                }
            }
            
        } catch (err) {
            errors.push(`Scenario setup failed: ${err}`);
        } finally {
            // 5. Cleanup
            await this.cleanup();
        }
        
        // 6. Evaluate result
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
            
            // Small delay between scenarios to ensure clean state
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        
        return results;
    }
    
    /**
     * Initialize fresh instances of all telemetry services
     */
    private initializeServices(): void {
        this.diagnosticService = new DiagnosticPersistenceService();
        this.inactivityService = new InactivityService();
        this.thrashingDetector = new ThrashingDetector();
        this.buildTracker = new BuildResultTracker();
        
        this.scoreService = new StruggleScoreService(
            this.diagnosticService,
            this.inactivityService,
            this.thrashingDetector,
            this.buildTracker,
        );
    }
    
    /**
     * Setup a test file for the scenario
     */
    private async setupTestFile(scenario: StruggleScenario): Promise<void> {
        // Find first edit event to determine file name
        const firstEdit = scenario.events.find((e): e is EditEvent => e.type === 'edit');
        const fileName = firstEdit?.file ?? 'TestFile.java';
        
        // Create a URI for the test file (in-memory)
        this.testFileUri = vscode.Uri.parse(`untitled:${fileName}`);
        
        // Create the document
        this.testDocument = await vscode.workspace.openTextDocument(this.testFileUri);
    }
    
    /**
     * Apply an event to the real services
     */
    private async applyEvent(event: ScenarioEvent): Promise<void> {
        switch (event.type) {
            case 'diagnostic':
                await this.applyDiagnosticEvent(event);
                break;
            case 'edit':
                await this.applyEditEvent(event);
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
     * Apply a diagnostic event - add/remove diagnostics
     */
    private async applyDiagnosticEvent(event: DiagnosticEvent): Promise<void> {
        if (event.action === 'clear') {
            this.diagnosticService?._testClearAllDiagnostics();
            this.diagnosticCollection.clear();
            return;
        }
        
        if (event.action === 'add' && event.diagnostics) {
            // Group by file
            const byFile = new Map<string, vscode.Diagnostic[]>();
            
            for (const diag of event.diagnostics) {
                const uri = vscode.Uri.file(`/test/${diag.file}`);
                const uriString = uri.toString();
                
                if (!byFile.has(uriString)) {
                    byFile.set(uriString, []);
                }
                
                const vsDiag = new vscode.Diagnostic(
                    new vscode.Range(diag.line, 0, diag.line, 100),
                    diag.message,
                    diag.severity === 'error'
                        ? vscode.DiagnosticSeverity.Error
                        : vscode.DiagnosticSeverity.Warning
                );
                vsDiag.code = diag.code;
                
                byFile.get(uriString)!.push(vsDiag);
                
                // Also inject into the DiagnosticPersistenceService for testing
                const id = `test-${uriString}-${diag.line}-${diag.code ?? 'unknown'}`;
                this.diagnosticService?._testInjectDiagnostic({
                    id,
                    uri: uriString,
                    range: {
                        startLine: diag.line,
                        startCharacter: 0,
                        endLine: diag.line,
                        endCharacter: 100,
                    },
                    code: diag.code,
                    message: diag.message,
                    severity: diag.severity === 'error'
                        ? vscode.DiagnosticSeverity.Error
                        : vscode.DiagnosticSeverity.Warning,
                    firstSeen: Date.now(),
                    lastSeen: Date.now(),
                    occurrences: 1,
                    resolved: false,
                });
            }
            
            // Set diagnostics per file
            for (const [uriString, diagnostics] of byFile) {
                const uri = vscode.Uri.parse(uriString);
                this.diagnosticCollection.set(uri, diagnostics);
            }
        }
        
        if (event.action === 'remove') {
            this.diagnosticService?._testClearAllDiagnostics();
            this.diagnosticCollection.clear();
        }
    }
    
    /**
     * Apply an edit event - simulates typing
     */
    private async applyEditEvent(event: EditEvent): Promise<void> {
        // Always record the edit directly to the thrashing detector for testing
        // This ensures thrashing detection works even when document editing fails
        this.thrashingDetector?.recordEdit(
            `/test/${event.file}`,
            event.content
        );
        
        // Try to also update the actual document for visual feedback
        if (this.testDocument) {
            try {
                const editor = await vscode.window.showTextDocument(this.testDocument, {
                    preview: false,
                    preserveFocus: true,
                });
                
                await editor.edit(editBuilder => {
                    const fullRange = new vscode.Range(
                        0, 0,
                        this.testDocument!.lineCount, 0
                    );
                    editBuilder.replace(fullRange, event.content);
                });
            } catch {
                // Document editing failed (common in test environments)
                // The thrashing detector has already been updated above
            }
        }
    }
    
    /**
     * Apply a build result event
     */
    private applyBuildEvent(event: BuildResultEvent): void {
        this.buildTracker?.recordBuildResult({
            timestamp: Date.now(),
            success: event.success,
            errorCount: event.errors?.length ?? 0,
            failedTests: event.failedTests ?? [],
            buildLog: undefined,
            submissionId: undefined,
        });
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
     * Calculate detailed metrics from score timeline
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
        
        const scores = snapshots.map(s => s.score.combined);
        const finalSnapshot = snapshots[snapshots.length - 1];
        const finalScore = finalSnapshot.score.combined;
        const expected = scenario.expectedOutcome;
        
        // Find time to detection (first time score >= threshold)
        let timeToDetection: number | null = null;
        for (const snapshot of snapshots) {
            if (snapshot.score.combined >= STRUGGLE_THRESHOLD) {
                timeToDetection = snapshot.timestamp;
                break;
            }
        }
        
        // Calculate false positive time (time with score >= threshold when no struggle expected)
        let falsePositiveTime = 0;
        if (!expected.shouldDetectStruggle) {
            let lastTimestamp = 0;
            for (const snapshot of snapshots) {
                if (snapshot.score.combined >= STRUGGLE_THRESHOLD) {
                    falsePositiveTime += snapshot.timestamp - lastTimestamp;
                }
                lastTimestamp = snapshot.timestamp;
            }
        }
        
        return {
            finalScoreInRange: finalScore >= expected.expectedScore.min &&
                              finalScore <= expected.expectedScore.max,
            detectedStruggle: finalScore >= STRUGGLE_THRESHOLD,
            correctAction: finalSnapshot.score.recommendedAction === expected.expectedAction,
            timeToDetection,
            falsePositiveTime,
            maxScore: Math.max(...scores),
            minScore: Math.min(...scores),
            avgScore: scores.reduce((a, b) => a + b, 0) / scores.length,
            finalScore,
        };
    }
    
    /**
     * Cleanup after scenario
     */
    private async cleanup(): Promise<void> {
        // Dispose services
        this.diagnosticService?.dispose();
        this.inactivityService?.dispose();
        this.thrashingDetector?.dispose();
        this.buildTracker?.dispose();
        this.scoreService?.dispose();
        
        this.diagnosticService = undefined;
        this.inactivityService = undefined;
        this.thrashingDetector = undefined;
        this.buildTracker = undefined;
        this.scoreService = undefined;
        
        // Restore real timers
        this.clock?.restore();
        this.clock = undefined;
        
        // Clear test diagnostics
        this.diagnosticCollection.clear();
        
        // Close test document
        if (this.testDocument) {
            // Try to close the document
            try {
                await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
            } catch {
                // Ignore errors when closing
            }
        }
        this.testDocument = undefined;
        this.testFileUri = undefined;
    }
    
    /**
     * Dispose the test runner
     */
    dispose(): void {
        this.diagnosticCollection.dispose();
    }
}
