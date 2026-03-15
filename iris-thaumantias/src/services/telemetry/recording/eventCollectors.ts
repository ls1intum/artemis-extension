/**
 * Pure extraction functions that convert VS Code event objects to RecordedEvent payloads.
 * All functions are stateless — they take an event and return a typed payload.
 */

import * as vscode from 'vscode';
import type { ResultDTO } from '../../../types';
import type {
    SerializedRange,
    SerializedSelection,
    SerializedDiagnostic,
    TextChangeEvent,
    SaveEvent,
    SelectionEvent,
    VisibleRangesEvent,
    FileSwitchEvent,
    FileOpenEvent,
    FileCloseEvent,
    DiagnosticsEvent,
    BuildResultEvent,
    WindowFocusEvent,
} from './types';

// ── Serialization helpers ─────────────────────────────────────────────

export function serializeRange(range: vscode.Range): SerializedRange {
    return {
        startLine: range.start.line,
        startCharacter: range.start.character,
        endLine: range.end.line,
        endCharacter: range.end.character,
    };
}

export function serializeSelection(selection: vscode.Selection): SerializedSelection {
    return {
        anchor: { line: selection.anchor.line, character: selection.anchor.character },
        active: { line: selection.active.line, character: selection.active.character },
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

export function collectSelection(event: vscode.TextEditorSelectionChangeEvent): SelectionEvent {
    return {
        type: 'selection',
        timestamp: Date.now(),
        uri: event.textEditor.document.uri.toString(),
        selections: event.selections.map(serializeSelection),
        kind: event.kind,
    };
}

export function collectVisibleRanges(event: vscode.TextEditorVisibleRangesChangeEvent): VisibleRangesEvent {
    return {
        type: 'visibleRanges',
        timestamp: Date.now(),
        uri: event.textEditor.document.uri.toString(),
        ranges: event.visibleRanges.map(serializeRange),
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

export function collectFileOpen(doc: vscode.TextDocument): FileOpenEvent {
    return {
        type: 'fileOpen',
        timestamp: Date.now(),
        uri: doc.uri.toString(),
        languageId: doc.languageId,
    };
}

export function collectFileClose(doc: vscode.TextDocument): FileCloseEvent {
    return {
        type: 'fileClose',
        timestamp: Date.now(),
        uri: doc.uri.toString(),
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

export function collectBuildResult(result: ResultDTO): BuildResultEvent {
    const failedTests: string[] = [];
    if (result.feedbacks) {
        for (const fb of result.feedbacks) {
            if (!fb.positive && fb.detailText) {
                failedTests.push(fb.detailText);
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
    };
}

export function collectWindowFocus(state: vscode.WindowState): WindowFocusEvent {
    return {
        type: 'windowFocus',
        timestamp: Date.now(),
        focused: state.focused,
    };
}
