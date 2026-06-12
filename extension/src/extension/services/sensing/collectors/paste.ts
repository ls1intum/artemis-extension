// extension/src/extension/services/sensing/collectors/paste.ts
/**
 * Manual-paste heuristic (sensing collector).
 *
 * Distinguishes a user-initiated multi-line paste from formatter/refactoring
 * rewrites and Copilot/snippet insertions. Moved verbatim from the v1
 * compileEquivalentEmitter (PR 2a); consumers pass their own minimum line
 * count where configured.
 *
 * Must stay free of module-load side effects: vitest logic tests import this
 * file with a partial vscode mock (type-only vscode usage is fine).
 */
import type * as vscode from 'vscode';

/** Replacements larger than this are treated as formatter/refactoring output. */
const FORMATTER_CHAR_THRESHOLD = 1000;

/**
 * Detect if a text change is likely a manual paste (not formatter/copilot/snippet).
 * [Engineering heuristic — not paper-validated]
 *
 * From MVP Edge Case 3 (lines 739-758).
 */
export function isLikelyManualPaste(
    change: vscode.TextDocumentContentChangeEvent,
    minLines: number = 2,
): boolean {
    const insertedLines = change.text.split('\n').length;
    if (insertedLines < minLines) {
        return false;
    }

    // Formatter/refactoring: replaces large text range (>1000 chars)
    if (change.rangeLength > FORMATTER_CHAR_THRESHOLD) {
        return false;
    }

    // Copilot/snippet: replaces text on a single line with multi-line output
    if (!change.range.isEmpty && change.range.isSingleLine) {
        return false;
    }

    // Pure insert (range.isEmpty) → likely paste (Ctrl+V)
    // Multi-line replacement (range spans multiple lines, ≤1000 chars) → likely paste-over-selection
    return true;
}
