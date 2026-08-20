import * as vscode from 'vscode';

import { buildErrorFamiliesFromFeedbacks } from '@extension/services/telemetry/metrics/buildErrorFamily';
import { shouldDedupSnapshot } from '@extension/services/telemetry/metrics/snapshotDedup';
import {
    BuildResultClassification,
    CompileEquivalentEvent,
    DEFAULT_EQ_CONFIG,
    DEFAULT_TRIGGER_CONFIG,
    EQConfig,
    ErrorSnapshot,
    SessionResettable,
    SessionStartContext,
} from '@extension/services/telemetry/types';
import { shouldRecordUri } from '@extension/services/telemetry/uriFilter';
import { ResultDTO } from '@extension/types';

import { LINT_SOURCE_DENYLIST } from './lintDenylist';

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

    /** Snapshots diagnostics after the LS settle delay. */
    public handleSaveEvent(doc: vscode.TextDocument): void {
        // Recordable documents only (file: scheme, not git/output/etc.).
        if (!shouldRecordUri(doc.uri)) {
            return;
        }

        // Coalesce rapid saves.
        if (this._saveTimeout) {
            clearTimeout(this._saveTimeout);
        }

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

    /** Fires only when the resulting snapshot is novel (not deduped). */
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

    /** Scopes diagnostic collection to this root. */
    public setExerciseRoot(uri: vscode.Uri | undefined): void {
        this._exerciseRoot = uri;
    }

    public onSessionStart(context: SessionStartContext): void {
        this.reset();
        this.setExerciseRoot(context.exerciseRoot);
    }

    public reset(): void {
        this._lastSnapshot = undefined;
        if (this._saveTimeout) {
            clearTimeout(this._saveTimeout);
            this._saveTimeout = undefined;
        }
    }

    /**
     * Counts only exercise files, severity=Error, and non-lint sources.
     */
    public createErrorSnapshotFromDiagnostics(): ErrorSnapshot {
        const allDiagnostics = vscode.languages.getDiagnostics();
        const errorFamilies = new Set<string>();
        let errorCount = 0;

        for (const [uri, diagnostics] of allDiagnostics) {
            if (!shouldRecordUri(uri, this._exerciseRoot)) {
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
            // Families come from the shared builder so the live EQ matches the
            // recorded/replayed families.
            const errorFamilies = new Set<string>(buildErrorFamiliesFromFeedbacks(result.feedbacks));
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

    /** Skips a snapshot inside the dedup window with the same error families. */
    private _shouldAddSnapshot(newSnapshot: ErrorSnapshot): boolean {
        if (!this._lastSnapshot) {
            return true;
        }
        return !shouldDedupSnapshot(newSnapshot, this._lastSnapshot, this._config.DEDUP_WINDOW_MS);
    }
}

/** Character threshold above which a replaced range is likely formatter/refactoring, not paste */
const FORMATTER_CHAR_THRESHOLD = 1000;

export function classifyBuildResult(result: ResultDTO): BuildResultClassification {
    if (result.submission?.buildFailed === true) {
        return 'compiler-error';
    }

    if (result.testCaseCount !== undefined && result.passedTestCaseCount !== undefined) {
        if (result.passedTestCaseCount < result.testCaseCount) {
            return 'test-failure';
        }
    }

    // Server reports failure but buildFailed/testCases are missing: treat as
    // test-failure to avoid a silent false-success classification.
    if (result.successful === false) {
        return 'test-failure';
    }

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

/**
 * Detect if a text change is likely a manual paste (not formatter/copilot/snippet).
 * [Engineering heuristic, not paper-validated]
 */
export function isLikelyManualPaste(
    change: vscode.TextDocumentContentChangeEvent,
    minLines: number = DEFAULT_TRIGGER_CONFIG.MULTILINE_PASTE_MIN_LINES,
): boolean {
    const insertedLines = change.text.split('\n').length;
    if (insertedLines < minLines) {
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
