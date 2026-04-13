import * as vscode from 'vscode';
import {
    ErrorSnapshot,
    CompileEquivalentEvent,
    BuildResultClassification,
    EQConfig,
    DEFAULT_EQ_CONFIG,
    SessionResettable,
    SessionStartContext,
} from '../types';
import { ResultDTO } from '../../../types';

import { shouldDedupSnapshot } from '../metrics/snapshotDedup';
import { LINT_SOURCE_DENYLIST } from './lintDenylist';
export { LINT_SOURCE_DENYLIST };

/**
 * Emits CompileEquivalentEvents from save events and build results.
 *
 * [ADAPTATION] Paper: "Compilation Event" = student clicks Compile in BlueJ.
 * VS Code: save event (with 500ms LS delay) or Artemis build result.
 */
export class CompileEquivalentEmitter implements vscode.Disposable, SessionResettable {
    /** Delay after save for Language Server to update diagnostics [Engineering choice] */
    private static readonly LS_SETTLE_DELAY_MS = 500;

    private readonly _disposables: vscode.Disposable[] = [];
    private readonly _config: EQConfig;
    private _exerciseRoot: vscode.Uri | undefined;
    private _lastSnapshot: ErrorSnapshot | undefined;
    private _saveTimeout: NodeJS.Timeout | undefined;

    private readonly _onDidEmitCompileEquivalent = new vscode.EventEmitter<CompileEquivalentEvent>();
    public readonly onDidEmitCompileEquivalent = this._onDidEmitCompileEquivalent.event;

    constructor(config: EQConfig = DEFAULT_EQ_CONFIG) {
        this._config = config;
    }

    public dispose(): void {
        if (this._saveTimeout) {
            clearTimeout(this._saveTimeout);
            this._saveTimeout = undefined;
        }
        while (this._disposables.length > 0) {
            this._disposables.pop()?.dispose();
        }
        this._onDidEmitCompileEquivalent.dispose();
    }

    /**
     * Handle a save event — delays 500ms for LS to update diagnostics,
     * then creates an ErrorSnapshot from current diagnostics.
     */
    public handleSaveEvent(doc: vscode.TextDocument): void {
        // Only handle file-scheme documents
        if (doc.uri.scheme !== 'file') {
            return;
        }

        // Clear any pending save timeout (coalesce rapid saves)
        if (this._saveTimeout) {
            clearTimeout(this._saveTimeout);
        }

        // 500ms delay for Language Server to process [Engineering choice]
        this._saveTimeout = setTimeout(() => {
            this._saveTimeout = undefined;
            const snapshot = this.createErrorSnapshotFromDiagnostics();
            if (this._shouldAddSnapshot(snapshot)) {
                this._lastSnapshot = snapshot;
                this._onDidEmitCompileEquivalent.fire({
                    timestamp: snapshot.timestamp,
                    source: 'save',
                    snapshot,
                });
            }
        }, CompileEquivalentEmitter.LS_SETTLE_DELAY_MS);
    }

    /**
     * Handle a build result from Artemis WebSocket.
     * Returns the CompileEquivalentEvent if emitted (for direct use by TelemetryManager).
     */
    public handleBuildResult(result: ResultDTO): CompileEquivalentEvent | null {
        const snapshot = this.createErrorSnapshotFromBuildResult(result);
        if (!this._shouldAddSnapshot(snapshot)) {
            return null;
        }

        this._lastSnapshot = snapshot;
        const event: CompileEquivalentEvent = {
            timestamp: snapshot.timestamp,
            source: 'build',
            snapshot,
        };
        this._onDidEmitCompileEquivalent.fire(event);
        return event;
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
    }

    /**
     * Reset state for exercise switch.
     */
    public reset(): void {
        this._lastSnapshot = undefined;
        if (this._saveTimeout) {
            clearTimeout(this._saveTimeout);
            this._saveTimeout = undefined;
        }
    }

    /**
     * Create an ErrorSnapshot from current VS Code diagnostics.
     * Filters to exercise files, severity=Error, and excludes lint sources.
     */
    public createErrorSnapshotFromDiagnostics(): ErrorSnapshot {
        const allDiagnostics = vscode.languages.getDiagnostics();
        const errorFamilies = new Set<string>();
        let errorCount = 0;

        for (const [uri, diagnostics] of allDiagnostics) {
            // Exercise scoping: only include files under exercise root
            if (this._exerciseRoot && !uri.fsPath.startsWith(this._exerciseRoot.fsPath)) {
                continue;
            }

            for (const d of diagnostics) {
                if (isCompilerDiagnostic(d)) {
                    const family = getErrorFamily(d);
                    errorFamilies.add(family);
                    errorCount++;
                }
            }
        }

        return {
            timestamp: Date.now(),
            hasErrors: errorCount > 0,
            errorFamilies,
            errorCount,
        };
    }

    /**
     * Create an ErrorSnapshot from a build result.
     * Compiler-error → hasErrors=true; test-failure/success → hasErrors=false.
     * [ADAPTATION] Test-failures are NOT compilation errors in the Jadud sense.
     */
    public createErrorSnapshotFromBuildResult(result: ResultDTO): ErrorSnapshot {
        const classification = classifyBuildResult(result);

        if (classification === 'compiler-error') {
            // Build failed → treat as having errors
            const errorFamilies = new Set<string>();
            // Use feedbacks to extract error families if available
            if (result.feedbacks) {
                for (const feedback of result.feedbacks) {
                    if (feedback.positive === false && feedback.text) {
                        errorFamilies.add(`build:${feedback.text.substring(0, 50)}`);
                    }
                }
            }
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
// Constants
// ============================================================================

/** Character threshold above which a replaced range is likely formatter/refactoring, not paste */
const FORMATTER_CHAR_THRESHOLD = 1000;

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
export function isCompilerDiagnostic(d: vscode.Diagnostic): boolean {
    const source = (d.source ?? '').toLowerCase();
    return d.severity === vscode.DiagnosticSeverity.Error
        && !LINT_SOURCE_DENYLIST.has(source);
}

/**
 * Get error family string from a diagnostic.
 * MVP: source:code (1:1 mapping, conservative).
 * [ADAPTATION] Paper had single error type; VS Code has hundreds of error codes.
 */
export function getErrorFamily(d: vscode.Diagnostic): string {
    const source = d.source ?? 'unknown';
    const code = typeof d.code === 'object' ? String(d.code.value) : String(d.code ?? 'unknown');
    return `${source}:${code}`;
}

/**
 * Detect if a text change is likely a manual paste (not formatter/copilot/snippet).
 * [Engineering heuristic — not paper-validated]
 *
 * From MVP Edge Case 3 (lines 739-758).
 */
export function isLikelyManualPaste(change: vscode.TextDocumentContentChangeEvent): boolean {
    const insertedLines = change.text.split('\n').length;
    if (insertedLines < 2) {
        return false;
    }

    // Formatter/refactoring: replaces large text range (>1000 chars)
    if (change.rangeLength > FORMATTER_CHAR_THRESHOLD) {
        return false;
    }

    // Copilot/snippet: replaces text on a single line with multi-line output
    if (!change.range.isEmpty && change.range.isSingleLine) {
        return false;
    }

    // Pure insert (range.isEmpty) → likely paste (Ctrl+V)
    // Multi-line replacement (range spans multiple lines, ≤1000 chars) → likely paste-over-selection
    return true;
}
