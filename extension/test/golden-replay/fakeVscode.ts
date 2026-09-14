/**
 * Minimal `vscode` object shims for the golden-replay harness.
 *
 * The replay harness drives the struggle engine off recorded events. The engine
 * (and the shared uriFilter) only read a tiny surface of the VS Code object
 * graph, so these factories build just that surface rather than full mocks:
 *
 *   - uriFilter.shouldRecordUri reads `uri.scheme` and `uri.fsPath`.
 *   - The engine's onDidChangeTextDocument reads `document.uri` (+ `.toString()`
 *     for the shadow key), `document.getText()`, and per-change `rangeLength` /
 *     `text` / `range.start.line`.
 *   - onDidOpenTextDocument reads `document.uri` and `document.getText()`.
 *   - onDidChangeTextEditorSelection / VisibleRanges read
 *     `textEditor.document.uri` and `selections[0].end.line`.
 *
 * Recorded URIs are standard `vscode.Uri.toString()` strings such as
 * "file:///Users/x/exercise/src/Foo.java". `makeUri` reuses the test vscode
 * stub's `Uri.parse`, which derives `scheme` from the protocol, `path`/`fsPath`
 * from the decoded pathname, and preserves the original string via toString().
 *
 * Casts to the real vscode types are localized here and deliberate: these are
 * structural test shims, and the real interfaces carry far more members than
 * the engine ever touches.
 */
import * as vscode from 'vscode';

/**
 * Build a `vscode.Uri` from a recorded URI string. Round-trips scheme/path/
 * fsPath and toString() such that `shouldRecordUri` treats a normal workspace
 * file:// URI as recordable.
 */
export function makeUri(recordedUriString: string): vscode.Uri {
    return vscode.Uri.parse(recordedUriString) as unknown as vscode.Uri;
}

/** Build a minimal `vscode.TextDocument` exposing `uri` and `getText()`. */
export function makeDocument(uri: vscode.Uri, getText: () => string): vscode.TextDocument {
    return { uri, getText } as unknown as vscode.TextDocument;
}

/**
 * Build a minimal `vscode.TextEditor` exposing `document.uri`, `selections`
 * (the engine reads `selections[0].end.line`) and `visibleRanges`.
 */
export function makeEditor(
    uri: vscode.Uri,
    selections: { end: { line: number } }[],
    visibleRanges?: { start: { line: number }; end: { line: number } }[],
): vscode.TextEditor {
    return {
        document: { uri },
        selections,
        visibleRanges: visibleRanges ?? [],
    } as unknown as vscode.TextEditor;
}
