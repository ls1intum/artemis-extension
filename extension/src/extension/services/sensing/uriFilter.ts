/**
 * Central URI filter of the sensing layer, shared by every consumer that
 * scopes itself to exercise files (sensing collectors, session
 * recorder, replay).
 *
 *   1. Scheme disparity: subtly-different per-listener guards make it easy to
 *      record git://, output:// or vscode-userdata:// documents by accident.
 *
 *   2. Prefix bug: a naive `startsWith(exerciseRoot)` test accepts
 *      `/workspace/ex10/File.java` when the exercise root is `/workspace/ex1`.
 *
 * V1 records only `file:` scheme URIs. Untitled, notebook, and remote URIs are
 * follow-up items.
 */

import * as vscode from 'vscode';
import * as path from 'path';

/**
 * URI schemes that are always excluded from recording, regardless of exercise
 * root. These are VS Code internal / VCS / output pseudo-documents that are
 * never student-authored files.
 */
const BLACKLIST_SCHEMES = new Set([
    'git',
    'output',
    'vscode-userdata',
    'search-result',
    'vscode-scm',
    'vscode-settings',
    'vscode-terminal',
    'vscode-chat-input',
]);

/**
 * Returns true if the given URI should be included in recording.
 *
 * Rules (applied in order):
 *   1. Blacklisted schemes → false.
 *   2. Non-`file:` scheme → false (V1 only records file:// URIs).
 *   3. No exerciseRoot provided → true (accept all file-scheme URIs).
 *   4. Prefix-safe check: uri.fsPath must equal rootPath OR start with
 *      rootPath + path.sep (avoids the /ex1 vs /ex10 prefix bug).
 *
 * @param exerciseRoot When omitted, no directory-scoping is applied.
 */
export function shouldRecordUri(uri: vscode.Uri, exerciseRoot?: vscode.Uri): boolean {
    if (BLACKLIST_SCHEMES.has(uri.scheme)) {
        return false;
    }
    // V1: only file: scheme. untitled, notebook and vscode-remote are
    // deliberate follow-ups.
    if (uri.scheme !== 'file') {
        return false;
    }
    if (!exerciseRoot) {
        return true;
    }
    const rootPath = exerciseRoot.fsPath;
    const uriPath = uri.fsPath;
    return uriPath === rootPath || uriPath.startsWith(rootPath + path.sep);
}

/**
 * String-based variant for code paths where URIs are already serialized (e.g.
 * replay / snapshot reconstruction working on JSONL without a live editor
 * context). Parses both strings and delegates to `shouldRecordUri` so the same
 * scheme blacklist and prefix-safe check apply.
 */
export function shouldRecordUriString(uriString: string, exerciseRootString?: string): boolean {
    const uri = vscode.Uri.parse(uriString);
    const root = exerciseRootString ? vscode.Uri.parse(exerciseRootString) : undefined;
    return shouldRecordUri(uri, root);
}
