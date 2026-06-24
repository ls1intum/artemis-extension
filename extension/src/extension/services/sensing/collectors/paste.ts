// extension/src/extension/services/sensing/collectors/paste.ts
/**
 * Manual-paste heuristic (sensing collector).
 *
 * Distinguishes a user-initiated multi-line paste from formatter/refactoring
 * rewrites and Copilot/snippet insertions. Moved verbatim from the (since
 * removed) v1 compile-equivalent emitter; consumers pass their own minimum
 * line count where configured.
 *
 * Must stay free of module-load side effects: vitest logic tests import this
 * file with a partial vscode mock (type-only vscode usage is fine).
 */
import type * as vscode from 'vscode';

import type { PasteSignal, TextChangeSignal } from '@extension/services/sensing/types';

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

/**
 * Engine-v2 paste rule (N1 boundary input), per change of one textChange event:
 * a change qualifies if its inserted text is LONG (>= 11 chars, "Textlaenge > 10",
 * any line count) OR passes the manual multi-line paste heuristic. Mirrors the
 * study pipeline's paste_events derivation (long inserts united with multiline
 * triggers), made deterministic and cooldown-free — declared causal deviation,
 * see the PR 2b plan, Decision 4.
 */
const PASTE_LONG_MIN_CHARS = 11;

export function detectPastes(signal: TextChangeSignal): PasteSignal[] {
    const out: PasteSignal[] = [];
    for (const change of signal.event.contentChanges) {
        const text = change.text;
        if (text.length === 0) {
            continue;
        }
        if (text.length >= PASTE_LONG_MIN_CHARS || isLikelyManualPaste(change)) {
            out.push({
                ts: signal.ts,
                uri: signal.event.document.uri,
                chars: text.length,
                lines: text.split('\n').length,
            });
        }
    }
    return out;
}
