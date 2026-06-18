/**
 * Pure extraction functions that convert VS Code event objects to RecordedEvent payloads.
 * All functions are stateless — they take an event and return a typed payload.
 */

import * as vscode from 'vscode';

import { buildErrorFamiliesFromFeedbacks } from '@extension/services/telemetry/metrics/buildErrorFamily';
import { shouldRecordUri } from '@extension/services/telemetry/uriFilter';
import type { ResultDTO } from '@extension/types';

import type {
    BreakpointChangeEvent,
    BuildResultEvent,
    DebugSessionEvent,
    DiagnosticsEvent,
    FileSwitchEvent,
    SaveEvent,
    SelectionChangeEvent,
    SerializedDiagnostic,
    SerializedRange,
    TextChangeEvent,
    VisibleRangeChangeEvent,
    WindowFocusEvent,
} from './types';

// ── Serialization helpers ─────────────────────────────────────────────

function serializeRange(range: vscode.Range): SerializedRange {
    return {
        startLine: range.start.line,
        startCharacter: range.start.character,
        endLine: range.end.line,
        endCharacter: range.end.character,
    };
}

function serializeDiagnostic(diag: vscode.Diagnostic): SerializedDiagnostic {
    const code = typeof diag.code === 'object' && diag.code !== null
        ? (diag.code as { value: string | number }).value
        : diag.code;
    return {
        code: code as string | number | undefined,
        message: diag.message,
        severity: diag.severity,
        range: serializeRange(diag.range),
        source: diag.source,
    };
}

// ── Collector functions ───────────────────────────────────────────────

export function collectTextChange(event: vscode.TextDocumentChangeEvent): TextChangeEvent {
    return {
        type: 'textChange',
        timestamp: Date.now(),
        uri: event.document.uri.toString(),
        changes: event.contentChanges.map(change => ({
            range: serializeRange(change.range),
            rangeOffset: change.rangeOffset,
            rangeLength: change.rangeLength,
            text: change.text,
        })),
    };
}

export function collectSave(doc: vscode.TextDocument): SaveEvent {
    return {
        type: 'save',
        timestamp: Date.now(),
        uri: doc.uri.toString(),
    };
}

export function collectFileSwitch(
    prev: string | undefined,
    next: vscode.TextEditor | undefined,
): FileSwitchEvent {
    return {
        type: 'fileSwitch',
        timestamp: Date.now(),
        fromUri: prev,
        toUri: next?.document.uri.toString(),
    };
}

export function collectDiagnostics(uri: vscode.Uri): DiagnosticsEvent {
    const diagnostics = vscode.languages.getDiagnostics(uri);
    return {
        type: 'diagnostics',
        timestamp: Date.now(),
        uri: uri.toString(),
        diagnostics: diagnostics.map(serializeDiagnostic),
    };
}

export function collectBuildResult(result: ResultDTO, activeExerciseId?: number): BuildResultEvent {
    const failedTests: string[] = [];
    const failedTestDetails: { testName: string; detail: string }[] = [];
    if (result.feedbacks) {
        for (const fb of result.feedbacks) {
            // Unified predicate: explicit false only (undefined = not yet graded, positive = passing).
            if (fb.positive === false) {
                // Legacy flat list: keep detailText for backwards compat consumers.
                failedTests.push(fb.detailText ?? '');
                // Structured details: carry both test name and failure message.
                failedTestDetails.push({ testName: fb.text ?? 'unknown', detail: fb.detailText ?? '' });
            }
        }
    }
    // Shared builder: same families (and truncation) as the live EQ path, so replay matches live.
    const buildErrorFamilies = buildErrorFamiliesFromFeedbacks(result.feedbacks);
    return {
        type: 'buildResult',
        timestamp: Date.now(),
        successful: result.successful,
        errorCount: (result.testCaseCount ?? 0) - (result.passedTestCaseCount ?? 0),
        failedTests,
        buildFailed: result.submission?.buildFailed ?? false,
        buildErrorFamilies: buildErrorFamilies.length > 0 ? buildErrorFamilies : undefined,
        exerciseId: activeExerciseId,
        participationId: result.participation?.id,
        submissionId: result.submission?.id,
        failedTestDetails: failedTestDetails.length > 0 ? failedTestDetails : undefined,
    };
}

export function collectWindowFocus(state: vscode.WindowState): WindowFocusEvent {
    return {
        type: 'windowFocus',
        timestamp: Date.now(),
        focused: state.focused,
    };
}

const SELECTION_KIND_MAP: Record<number, 'keyboard' | 'mouse' | 'command'> = {
    1: 'keyboard',
    2: 'mouse',
    3: 'command',
};

export function collectSelectionChange(
    editor: vscode.TextEditor,
    kind: vscode.TextEditorSelectionChangeKind | undefined,
): SelectionChangeEvent {
    return {
        type: 'selectionChange',
        timestamp: Date.now(),
        uri: editor.document.uri.toString(),
        selections: editor.selections.map(serializeRange),
        kind: kind ? SELECTION_KIND_MAP[kind] : undefined,
    };
}

export function collectVisibleRangeChange(editor: vscode.TextEditor): VisibleRangeChangeEvent {
    return {
        type: 'visibleRangeChange',
        timestamp: Date.now(),
        uri: editor.document.uri.toString(),
        visibleRanges: editor.visibleRanges.map(serializeRange),
    };
}

// ── Debugger collectors ───────────────────────────────────────────────

/**
 * Build a debugSession event. Session fields are populated from the session
 * when present, and left undefined when activeChanged fires with no active
 * session (so JSON.stringify omits them). Inherited from vscode.DebugSession.
 */
export function collectDebugSession(
    action: 'started' | 'terminated' | 'activeChanged',
    session: vscode.DebugSession | undefined,
): DebugSessionEvent {
    return {
        type: 'debugSession',
        timestamp: Date.now(),
        action,
        sessionId: session?.id,
        sessionName: session?.name,
        sessionType: session?.type,
        parentSessionId: session?.parentSession?.id,
    };
}

/**
 * Keep only source breakpoints (the only kind with a file location) whose URI
 * is inside the exercise root. Function breakpoints have no URI and are dropped.
 */
export function filterRecordableSourceBreakpoints(
    breakpoints: readonly vscode.Breakpoint[],
    exerciseRoot: vscode.Uri | undefined,
): vscode.SourceBreakpoint[] {
    return breakpoints.filter(
        (bp): bp is vscode.SourceBreakpoint =>
            bp instanceof vscode.SourceBreakpoint
            && shouldRecordUri(bp.location.uri, exerciseRoot),
    );
}

/**
 * Map already-filtered source breakpoints to a BreakpointChangeEvent.
 * `line`/`column` are 0-based (raw Position values), consistent with
 * SerializedRange; the viewer adds +1 for display. `id`, `enabled`,
 * `condition`, `hitCondition` and `logMessage` are inherited from the base
 * vscode.Breakpoint. `timestamp` defaults to now; the startup snapshot passes
 * the captured session-start time instead.
 */
export function collectBreakpointChange(
    action: 'added' | 'removed' | 'changed',
    breakpoints: readonly vscode.SourceBreakpoint[],
    timestamp: number = Date.now(),
): BreakpointChangeEvent {
    return {
        type: 'breakpointChange',
        timestamp,
        action,
        breakpoints: breakpoints.map(bp => ({
            id: bp.id,
            uri: bp.location.uri.toString(),
            line: bp.location.range.start.line,
            column: bp.location.range.start.character,
            enabled: bp.enabled,
            condition: bp.condition,
            hitCondition: bp.hitCondition,
            logMessage: bp.logMessage,
        })),
    };
}

/**
 * Build the session-start breakpoint snapshot from the current workspace-global
 * breakpoints. Returns null when no in-root source breakpoints exist (so the
 * caller emits nothing). The provided timestamp is used so the snapshot aligns
 * with the startup event sequence.
 */
export function collectInitialBreakpointSnapshot(
    breakpoints: readonly vscode.Breakpoint[],
    exerciseRoot: vscode.Uri | undefined,
    timestamp: number,
): BreakpointChangeEvent | null {
    const source = filterRecordableSourceBreakpoints(breakpoints, exerciseRoot);
    if (source.length === 0) {
        return null;
    }
    return collectBreakpointChange('added', source, timestamp);
}
