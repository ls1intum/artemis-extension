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

/**
 * Whole-line hover: the fuller message + Open chat / Hide inline / Dismiss command links (spec §4.1, §5.2).
 * `message` is server-provided (the LLM gate's hint), so trust is scoped to ONLY these three intervention
 * commands — a hint carrying its own `command:` link can never execute arbitrary VS Code commands from this
 * trusted hover. Hide inline just removes the editor cue (no backoff); Dismiss removes it AND feeds backoff.
 */
export function buildHoverMarkdown(message: string): vscode.MarkdownString {
    const md = new vscode.MarkdownString(`${message}\n\n[Open chat](command:iris.intervention.inlineOpen) · [Hide inline](command:iris.intervention.inlineHide) · [Dismiss](command:iris.intervention.inlineDismiss)`);
    md.isTrusted = { enabledCommands: ['iris.intervention.inlineOpen', 'iris.intervention.inlineHide', 'iris.intervention.inlineDismiss'] };
    return md;
}
