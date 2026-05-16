/**
 * Pure extraction functions that convert VS Code event objects to RecordedEvent payloads.
 * All functions are stateless — they take an event and return a typed payload.
 */

import * as vscode from 'vscode';

import type { ResultDTO } from '@extension/types';

import type {
    BuildResultEvent,
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
    const buildErrorFamilies: string[] = [];
    if (result.feedbacks) {
        for (const fb of result.feedbacks) {
            // Unified predicate: explicit false only (undefined = not yet graded, positive = passing).
            if (fb.positive === false) {
                // Legacy flat list: keep detailText for backwards compat consumers.
                failedTests.push(fb.detailText ?? '');
                // Structured details: carry both test name and failure message.
                failedTestDetails.push({ testName: fb.text ?? 'unknown', detail: fb.detailText ?? '' });
                if (fb.text) {
                    // 200 chars to differentiate similar errors; previously 50 caused family-merging.
                    buildErrorFamilies.push(`build:${fb.text.substring(0, 200)}`);
                }
            }
        }
    }
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
