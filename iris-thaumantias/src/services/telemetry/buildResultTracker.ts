import * as vscode from 'vscode';
import { BuildResult } from './types';
import { ResultDTO, WebSocketMessageHandler } from '../../types';

/**
 * Service that tracks server-side build results from Artemis.
 * Monitors consecutive failures and build patterns.
 */
export class BuildResultTracker implements vscode.Disposable, WebSocketMessageHandler {
    private readonly _disposables: vscode.Disposable[] = [];
    private readonly _buildHistory: BuildResult[] = [];
    private _consecutiveFailures: number = 0;

    /** Maximum number of builds to keep in history */
    private static readonly HISTORY_SIZE = 10;

    private readonly _onDidReceiveBuildResult = new vscode.EventEmitter<BuildResult>();
    public readonly onDidReceiveBuildResult = this._onDidReceiveBuildResult.event;

    constructor() {
        // WebSocket service will be set via setter injection
    }

    public dispose(): void {
        while (this._disposables.length > 0) {
            const disposable = this._disposables.pop();
            disposable?.dispose();
        }

        this._onDidReceiveBuildResult.dispose();
        this._buildHistory.length = 0;
    }

    /**
     * Handle new result from WebSocket (implements WebSocketMessageHandler)
     */
    public onNewResult(result: ResultDTO): void {
        this._processResult(result);
    }

    /**
     * Process a build result from Artemis
     */
    private _processResult(result: ResultDTO): void {
        const buildResult: BuildResult = {
            timestamp: Date.now(),
            success: result.successful ?? false,
            errorCount: (result.testCaseCount ?? 0) - (result.passedTestCaseCount ?? 0),
            failedTests: this._extractFailedTests(result),
            buildLog: undefined, // Build log comes separately
            submissionId: result.submission?.id,
        };

        this._addBuildResult(buildResult);
    }

    /**
     * Extract failed test names from result
     */
    private _extractFailedTests(result: ResultDTO): string[] {
        const failedTests: string[] = [];

        if (result.feedbacks) {
            for (const feedback of result.feedbacks) {
                if (feedback.positive === false && feedback.text) {
                    failedTests.push(feedback.text);
                }
            }
        }

        return failedTests;
    }

    /**
     * Add a build result to history
     */
    private _addBuildResult(result: BuildResult): void {
        // Add to history
        this._buildHistory.push(result);

        // Maintain history size
        while (this._buildHistory.length > BuildResultTracker.HISTORY_SIZE) {
            this._buildHistory.shift();
        }

        // Update consecutive failures count
        if (result.success) {
            this._consecutiveFailures = 0;
        } else {
            this._consecutiveFailures++;
        }

        this._onDidReceiveBuildResult.fire(result);
    }

    /**
     * Manually record a build result (for testing or manual tracking)
     */
    public recordBuildResult(result: BuildResult): void {
        this._addBuildResult(result);
    }

    /**
     * Get number of consecutive build failures
     */
    public getConsecutiveFailures(): number {
        return this._consecutiveFailures;
    }

    /**
     * Get recent build pattern analysis
     */
    public getRecentBuildPattern(): {
        totalBuilds: number;
        failureRate: number;
        averageErrorCount: number;
        commonFailingTests: string[];
    } {
        if (this._buildHistory.length === 0) {
            return {
                totalBuilds: 0,
                failureRate: 0,
                averageErrorCount: 0,
                commonFailingTests: [],
            };
        }

        const failures = this._buildHistory.filter(b => !b.success).length;
        const totalErrors = this._buildHistory.reduce((sum, b) => sum + b.errorCount, 0);

        // Count test failure occurrences
        const testFailureCounts = new Map<string, number>();
        for (const build of this._buildHistory) {
            for (const test of build.failedTests) {
                testFailureCounts.set(test, (testFailureCounts.get(test) ?? 0) + 1);
            }
        }

        // Get most common failing tests
        const commonFailingTests = Array.from(testFailureCounts.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([test]) => test);

        return {
            totalBuilds: this._buildHistory.length,
            failureRate: failures / this._buildHistory.length,
            averageErrorCount: totalErrors / this._buildHistory.length,
            commonFailingTests,
        };
    }

    /**
     * Get the most recent build result
     */
    public getLastBuildResult(): BuildResult | undefined {
        return this._buildHistory[this._buildHistory.length - 1];
    }

    /**
     * Get all build history
     */
    public getBuildHistory(): BuildResult[] {
        return [...this._buildHistory];
    }

    /**
     * Reset tracking state
     */
    public reset(): void {
        this._buildHistory.length = 0;
        this._consecutiveFailures = 0;
    }
}
