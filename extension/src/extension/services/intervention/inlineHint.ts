import * as vscode from 'vscode';
import * as path from 'path';

/** The after-line cue text: bulb + the Socratic hint (spec §4.1). No leading space, so the pill's
 *  left/right padding stays symmetric; the gap from the code comes from the decoration's margin. */
export function buildCueText(inlineHint: string): string {
    return `💡 ${inlineHint}`;
}

/** Repo-relative, forward-slash path of a document relative to the exercise root (portable across OSes). */
export function anchorRelPath(root: vscode.Uri, uri: vscode.Uri): string {
    return path.relative(root.fsPath, uri.fsPath).split(path.sep).join('/');
}

/** The visible editor whose document is exactly `anchorFile` (repo-relative to the exercise root), or undefined. */
export function resolveAnchorEditor(editors: readonly vscode.TextEditor[], anchorFile: string, exerciseRoot: vscode.Uri): vscode.TextEditor | undefined {
    return editors.find(e => anchorRelPath(exerciseRoot, e.document.uri) === anchorFile);
}

/** True when `doc` is the anchored file (repo-relative to the exercise root), visible or not. */
export function isAnchorDocument(doc: vscode.TextDocument, anchorFile: string, exerciseRoot: vscode.Uri): boolean {
    return anchorRelPath(exerciseRoot, doc.uri) === anchorFile;
}

/** Structural shape of a TextDocumentContentChangeEvent (keeps the line math testable without vscode). */
export interface AnchorLineChange {
    range: { start: { line: number; character: number }; end: { line: number; character: number } };
    text: string;
}

/**
 * New 1-based anchor line after an edit, mirroring how VS Code moves a whole-line decoration:
 * an edit entirely above shifts the anchor by its net line delta, an edit swallowing the anchor
 * line clamps to the edit's start line, and an edit on or below the anchor leaves it in place.
 */
export function shiftAnchorLine(line: number, change: AnchorLineChange): number {
    const idx = line - 1; // 0-based anchor line
    const { start, end } = change.range;
    if (start.line > idx) {
        return line;
    }
    const added = change.text.split('\n').length - 1;
    const removed = end.line - start.line;
    // The edit ends before the anchor line's first character: the line itself is untouched, shift it.
    if (end.line < idx || (end.line === idx && end.character === 0)) {
        return line + added - removed;
    }
    // The edit starts above and reaches into the anchor line.
    if (start.line < idx) {
        // Ends on the anchor line (end.character > 0 here; the col-0 case is handled above): the
        // anchor line's surviving tail merges onto start.line + added.
        if (end.line === idx) {
            return start.line + added + 1;
        }
        // Ends below the anchor line: the anchor line is fully deleted, so there is no remainder to
        // follow. Clamp to the edit's start line.
        return start.line + 1;
    }
    // The edit starts on the anchor line: the line keeps its position.
    return line;
}

/**
 * Whole-line hover: the fuller message + Open chat / Dismiss command links (spec §4.1, §5.2).
 * `message` is server-provided (the LLM gate's hint), so trust is scoped to ONLY these two intervention
 * commands — a hint carrying its own `command:` link can never execute arbitrary VS Code commands from this
 * trusted hover. Dismiss removes the editor cue (the hint stays in the chat).
 */
export function buildHoverMarkdown(message: string): vscode.MarkdownString {
    const md = new vscode.MarkdownString(`${message}\n\n[Open chat](command:iris.intervention.inlineOpen) · [Dismiss](command:iris.intervention.inlineDismiss)`);
    md.isTrusted = { enabledCommands: ['iris.intervention.inlineOpen', 'iris.intervention.inlineDismiss'] };
    return md;
}
