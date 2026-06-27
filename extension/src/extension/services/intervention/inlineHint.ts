import * as vscode from 'vscode';
import * as path from 'path';

/** The after-line cue text: bulb + the Socratic hint (spec §4.1). */
export function buildCueText(inlineHint: string): string {
    return ` 💡 ${inlineHint}`;
}

/** Repo-relative, forward-slash path of a document relative to the exercise root (portable across OSes). */
function relPath(root: vscode.Uri, uri: vscode.Uri): string {
    return path.relative(root.fsPath, uri.fsPath).split(path.sep).join('/');
}

/** The visible editor whose document is exactly `anchorFile` (repo-relative to the exercise root), or undefined. */
export function resolveAnchorEditor(editors: readonly vscode.TextEditor[], anchorFile: string, exerciseRoot: vscode.Uri): vscode.TextEditor | undefined {
    return editors.find(e => relPath(exerciseRoot, e.document.uri) === anchorFile);
}

/** Live = the anchored file is a visible editor AND the (1-based) line sits in a visible range. */
export function isAnchorLive(anchorFile: string, anchorLine: number, editors: readonly vscode.TextEditor[], exerciseRoot: vscode.Uri | undefined): boolean {
    if (!exerciseRoot) {
        return false;
    }
    const ed = resolveAnchorEditor(editors, anchorFile, exerciseRoot);
    if (!ed) {
        return false;
    }
    const line = anchorLine - 1;
    return ed.visibleRanges.some(r => line >= r.start.line && line <= r.end.line);
}

/** Whole-line hover content: the fuller message (action links are added in Slice 4). */
export function buildHoverMarkdown(message: string): vscode.MarkdownString {
    return new vscode.MarkdownString(message);
}
