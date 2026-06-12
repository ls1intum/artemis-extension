/**
 * Central URI filter of the sensing layer, shared by every consumer that
 * scopes itself to exercise files (sensing collectors, EQ pipeline, session
 * recorder, replay).
 *
 * ## Design rationale
 *
 * Previously every listener performed its own `uri.scheme !== 'file'` check in
 * isolation. That scattered guard had two problems:
 *
 *   1. **Scheme disparity** — different listeners could (and did) apply
 *      subtly-different guards, making it easy to accidentally record git://,
 *      output://, or vscode-userdata:// documents.
 *
 *   2. **Prefix-bug** — a naïve `startsWith(exerciseRoot)` test incorrectly
 *      accepts `/workspace/ex10/File.java` when the exercise root is
 *      `/workspace/ex1`, because `/workspace/ex10` starts-with `/workspace/ex1`.
 *
 * This module provides a single `shouldRecordUri` function that both guards are
 * folded into. V1 records only `file:` scheme URIs. Untitled, notebook, and
 * remote URIs are explicitly left as follow-up items (see plan).
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
 *      rootPath + path.sep (fixes the /ex1 vs /ex10 prefix-bug).
 *
 * @param uri          The URI to evaluate.
 * @param exerciseRoot Optional exercise root URI. When omitted, no
 *                     directory-scoping is applied.
 */
export function shouldRecordUri(uri: vscode.Uri, exerciseRoot?: vscode.Uri): boolean {
    if (BLACKLIST_SCHEMES.has(uri.scheme)) {
        return false;
    }
    // V1: only file: scheme. untitled, notebook, vscode-remote etc. are
    // intentionally left as future follow-ups in the robustness plan.
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
 * String-based variant for code paths where URIs are already serialized to
 * strings (e.g. replay / snapshot reconstruction code that works on JSONL
 * without a live VS Code editor context).
 *
 * Delegates to `shouldRecordUri` after parsing both strings through
 * `vscode.Uri.parse` so the same scheme-blacklist and prefix-bug-safe logic
 * applies consistently.
 *
 * @param uriString          Serialized URI string (e.g. "file:///workspace/ex1/Main.java").
 * @param exerciseRootString Optional serialized exercise root URI string.
 */
export function shouldRecordUriString(uriString: string, exerciseRootString?: string): boolean {
    const uri = vscode.Uri.parse(uriString);
    const root = exerciseRootString ? vscode.Uri.parse(exerciseRootString) : undefined;
    return shouldRecordUri(uri, root);
}
