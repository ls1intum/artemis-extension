/**
 * Pure functions that reconstruct ErrorSnapshots from serialized recording data.
 *
 * Mirrors the helpers in compileEquivalentEmitter.ts but operates on
 * SerializedDiagnostic (from recorded JSONL) instead of vscode.Diagnostic.
 */

import type { ErrorSnapshot } from '../types';
import type { SerializedDiagnostic, BuildResultEvent } from '../recording/types';
import { LINT_SOURCE_DENYLIST } from '../eventPipeline/lintDenylist';

/**
 * Check if a serialized diagnostic is a compiler diagnostic (not lint).
 * Mirrors isCompilerDiagnostic — severity 0 = vscode.DiagnosticSeverity.Error.
 */
export function isCompilerDiagnosticSerialized(d: SerializedDiagnostic): boolean {
    const source = (d.source ?? '').toLowerCase();
    return d.severity === 0 && !LINT_SOURCE_DENYLIST.has(source);
}

/**
 * Get error family string from a serialized diagnostic.
 * Mirrors getErrorFamily — returns "source:code".
 */
export function getErrorFamilySerialized(d: SerializedDiagnostic): string {
    const source = d.source ?? 'unknown';
    const code = String(d.code ?? 'unknown');
    return `${source}:${code}`;
}

/**
 * Build an ErrorSnapshot from accumulated diagnostic state.
 * Iterates all URIs in the diagnostic state map, filtering for compiler errors.
 */
export function createSnapshotFromDiagnosticState(
    state: Map<string, SerializedDiagnostic[]>,
    timestamp: number,
    exerciseRoot?: string,
): ErrorSnapshot {
    const errorFamilies = new Set<string>();
    let errorCount = 0;

    for (const [uri, diagnostics] of state.entries()) {
        if (exerciseRoot && !uri.startsWith(exerciseRoot)) {
            continue;
        }
        for (const d of diagnostics) {
            if (isCompilerDiagnosticSerialized(d)) {
                errorFamilies.add(getErrorFamilySerialized(d));
                errorCount++;
            }
        }
    }

    return {
        timestamp,
        hasErrors: errorCount > 0,
        errorFamilies,
        errorCount,
    };
}

/**
 * Build an ErrorSnapshot from a recorded BuildResultEvent.
 * buildFailed=true → compiler-error (hasErrors=true).
 * Otherwise → hasErrors=false (test-failure or success).
 */
export function createSnapshotFromBuildEvent(event: BuildResultEvent): ErrorSnapshot {
    if (event.buildFailed) {
        const errorFamilies = event.buildErrorFamilies?.length
            ? new Set<string>(event.buildErrorFamilies)
            : new Set<string>(['build:compiler-error']);
        return {
            timestamp: event.timestamp,
            hasErrors: true,
            errorFamilies,
            errorCount: errorFamilies.size,
        };
    }

    return {
        timestamp: event.timestamp,
        hasErrors: false,
        errorFamilies: new Set(),
        errorCount: 0,
    };
}
