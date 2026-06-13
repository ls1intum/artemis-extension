import * as vscode from 'vscode';

import { type DiagnosticsSettledSignal, nextSensorSeq } from '@extension/services/sensing';
import { shouldRecordUri } from '@extension/services/sensing/uriFilter';
// Interim (PR 2a): the session-lifecycle contracts stay in telemetry/types
// until PR 2c dissolves services/telemetry and relocates them.
import { SessionResettable, SessionStartContext } from '@extension/services/telemetry/types';
import { ResultDTO } from '@extension/types';

import { buildErrorFamiliesFromFeedbacks } from './buildErrorFamily';
import { LINT_SOURCE_DENYLIST } from './lintDenylist';
import { shouldDedupSnapshot } from './snapshotDedup';
import {
    BuildResultClassification,
    CompileEquivalentEvent,
    DEFAULT_EQ_CONFIG,
    EQConfig,
    ErrorSnapshot,
} from './types';

/**
 * Emits CompileEquivalentEvents from settled diagnostics dumps and build results.
 *
 * [ADAPTATION] Paper: "Compilation Event" = student clicks Compile in BlueJ.
 * VS Code: save event (500ms LS settle, handled by the sensing layer) or
 * Artemis build result.
 */
export class CompileEquivalentEmitter implements vscode.Disposable, SessionResettable {
    private readonly _config: EQConfig;
    private _exerciseRoot: vscode.Uri | undefined;
    private _lastSnapshot: ErrorSnapshot | undefined;
    private _sessionStartSeq = 0;

    private readonly _onDidEmitCompileEquivalent = new vscode.EventEmitter<CompileEquivalentEvent>();
    public readonly onDidEmitCompileEquivalent = this._onDidEmitCompileEquivalent.event;

    constructor(config: EQConfig = DEFAULT_EQ_CONFIG) {
        this._config = config;
    }

    public dispose(): void {
        this._onDidEmitCompileEquivalent.dispose();
    }

    /**
     * Handle a settled diagnostics dump from the sensing layer (save-triggered,
     * 500 ms LS settle; see sensing/collectors/diagnosticsSettle.ts). Fires
     * onDidEmitCompileEquivalent when the snapshot is novel.
     */
    public handleDiagnosticsSettled(signal: DiagnosticsSettledSignal): void {
        if (signal.savedSeq < this._sessionStartSeq) {
            // The triggering save belongs to the previous session; v1 cleared
            // its pending save timer at this boundary (decision log #1b).
            return;
        }
        const snapshot = this.createErrorSnapshotFromDiagnostics(signal.entries, signal.ts);
        if (!this._shouldAddSnapshot(snapshot)) {
            return;
        }
        this._lastSnapshot = snapshot;
        this._onDidEmitCompileEquivalent.fire({
            timestamp: snapshot.timestamp,
            source: 'save',
            snapshot,
        });
    }

    /**
     * Handle a build result from Artemis WebSocket. Fires onDidEmitCompileEquivalent
     * when the snapshot is novel; subscribers are the sole consumers.
     */
    public handleBuildResult(result: ResultDTO): void {
        const snapshot = this.createErrorSnapshotFromBuildResult(result);
        if (!this._shouldAddSnapshot(snapshot)) {
            return;
        }

        this._lastSnapshot = snapshot;
        this._onDidEmitCompileEquivalent.fire({
            timestamp: snapshot.timestamp,
            source: 'build',
            snapshot,
        });
    }

    /**
     * Set exercise root for diagnostic scoping.
     */
    public setExerciseRoot(uri: vscode.Uri | undefined): void {
        this._exerciseRoot = uri;
    }

    /**
     * SessionResettable — resets state and updates exercise root.
     */
    public onSessionStart(context: SessionStartContext): void {
        this.reset();
        this.setExerciseRoot(context.exerciseRoot);
        this._sessionStartSeq = nextSensorSeq();
    }

    /**
     * Reset state for exercise switch.
     */
    public reset(): void {
        this._lastSnapshot = undefined;
    }

    /**
     * Create an ErrorSnapshot from a settled diagnostics dump (sensor event).
     * Filters to exercise files, severity=Error, and excludes lint sources.
     */
    private createErrorSnapshotFromDiagnostics(
        entries: ReadonlyArray<[vscode.Uri, vscode.Diagnostic[]]>,
        timestamp: number,
    ): ErrorSnapshot {
        const errorFamilies = new Set<string>();
        let errorCount = 0;

        for (const [uri, diagnostics] of entries) {
            if (!shouldRecordUri(uri, this._exerciseRoot)) {
                continue;
            }
            for (const d of diagnostics) {
                if (isCompilerDiagnostic(d)) {
                    errorFamilies.add(getErrorFamily(d));
                    errorCount++;
                }
            }
        }

        return { timestamp, hasErrors: errorCount > 0, errorFamilies, errorCount };
    }

    /**
     * Create an ErrorSnapshot from a build result.
     * Compiler-error → hasErrors=true; test-failure/success → hasErrors=false.
     * [ADAPTATION] Test-failures are NOT compilation errors in the Jadud sense.
     */
    public createErrorSnapshotFromBuildResult(result: ResultDTO): ErrorSnapshot {
        const classification = classifyBuildResult(result);

        if (classification === 'compiler-error') {
            // Build failed → treat as having errors. Families come from the shared
            // builder so the live EQ matches the recorded/replayed families.
            const errorFamilies = new Set<string>(buildErrorFamiliesFromFeedbacks(result.feedbacks));
            // At minimum, mark as having a build error
            if (errorFamilies.size === 0) {
                errorFamilies.add('build:compiler-error');
            }

            return {
                timestamp: Date.now(),
                hasErrors: true,
                errorFamilies,
                errorCount: errorFamilies.size,
            };
        }

        // test-failure or success → hasErrors = false for EQ purposes
        return {
            timestamp: Date.now(),
            hasErrors: false,
            errorFamilies: new Set(),
            errorCount: 0,
        };
    }

    /**
     * Check dedup: skip if within window AND same error families.
     */
    private _shouldAddSnapshot(newSnapshot: ErrorSnapshot): boolean {
        if (!this._lastSnapshot) {
            return true;
        }
        return !shouldDedupSnapshot(newSnapshot, this._lastSnapshot, this._config.DEDUP_WINDOW_MS);
    }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Classify a build result as compiler-error, test-failure, or success.
 * Uses ResultDTO fields from src/types/artemis.ts.
 */
export function classifyBuildResult(result: ResultDTO): BuildResultClassification {
    // 1. Compiler-error: build failed completely
    if (result.submission?.buildFailed === true) {
        return 'compiler-error';
    }

    // 2. Test-failure: build compiled but tests failed
    if (result.testCaseCount !== undefined && result.passedTestCaseCount !== undefined) {
        if (result.passedTestCaseCount < result.testCaseCount) {
            return 'test-failure';
        }
    }

    // 3. Fallback: if server reports failure but buildFailed/testCases are missing,
    //    treat as test-failure to avoid silent false-success classification
    if (result.successful === false) {
        return 'test-failure';
    }

    // 4. Success
    return 'success';
}

/**
 * Check if a diagnostic is a compiler diagnostic (not lint).
 * [ADAPTATION] Paper had no linter; denylist filter is engineering-necessary.
 */
function isCompilerDiagnostic(d: vscode.Diagnostic): boolean {
    const source = (d.source ?? '').toLowerCase();
    return d.severity === vscode.DiagnosticSeverity.Error
        && !LINT_SOURCE_DENYLIST.has(source);
}

/**
 * Get error family string from a diagnostic.
 * MVP: source:code (1:1 mapping, conservative).
 * [ADAPTATION] Paper had single error type; VS Code has hundreds of error codes.
 */
function getErrorFamily(d: vscode.Diagnostic): string {
    const source = d.source ?? 'unknown';
    const code = typeof d.code === 'object' ? String(d.code.value) : String(d.code ?? 'unknown');
    return `${source}:${code}`;
}

