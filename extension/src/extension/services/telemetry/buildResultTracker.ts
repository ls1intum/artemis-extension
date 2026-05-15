import * as vscode from 'vscode';
import { BuildResult, SessionResettable, SessionStartContext } from './types';
import { ResultDTO } from '../../types';

/**
 * Service that tracks server-side build results from Artemis.
 * Monitors consecutive failures and build patterns.
 */
export class BuildResultTracker implements vscode.Disposable, SessionResettable {
    private readonly _buildHistory: BuildResult[] = [];
    private _consecutiveFailures: number = 0;

    /** Maximum number of builds to keep in history */
    private static readonly HISTORY_SIZE = 10;

    private readonly _onDidReceiveBuildResult = new vscode.EventEmitter<BuildResult>();
    public readonly onDidReceiveBuildResult = this._onDidReceiveBuildResult.event;

    public dispose(): void {
        this._onDidReceiveBuildResult.dispose();
        this._buildHistory.length = 0;
    }

    /**
     * Handle a new build result, hand-dispatched by {@link TelemetryManager}.
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
            rawBuildFailed: result.submission?.buildFailed,
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
     * Get number of consecutive build failures
     */
    public getConsecutiveFailures(): number {
        return this._consecutiveFailures;
    }

    /**
     * SessionResettable — reset build history when a new exercise session starts.
     */
    public onSessionStart(_context: SessionStartContext): void {
        this.reset();
    }

    /**
     * Reset tracking state
     */
    public reset(): void {
        this._buildHistory.length = 0;
        this._consecutiveFailures = 0;
    }
}
