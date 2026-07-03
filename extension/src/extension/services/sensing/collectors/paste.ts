// extension/src/extension/services/sensing/collectors/paste.ts
/**
 * Paste detection (sensing collector) for the N1 boundary.
 *
 * Rule ([L] Pu 2025, "User pastes code that's more than 1 line" - their most effective
 * proactive trigger at 73.1%): a paste is a single-change, non-undo, non-formatter text
 * change inserting >= 2 lines whose content MATCHES THE CLIPBOARD (normalized for the
 * auto-indent VS Code applies on paste). The clipboard check is what separates real pastes
 * from Copilot/snippet/completion insertions, which are metadata-identical to a paste.
 * The comparison is a pure in-memory equality: clipboard content is never stored or sent.
 *
 * When the clipboard cannot be read (rejection), detection falls back to the shape-only
 * {@link isLikelyManualPaste} heuristic (multi-line, guarded against formatter and
 * Copilot/snippet shapes).
 *
 * Declared misses: single-line pastes (no literature basis for a char threshold; the study
 * pipeline's `len > 10` branch was a workaround for the old recorder only seeing multi-line
 * paste triggers, and mostly caught completion false positives), drag-and-drop text (no
 * clipboard involvement), paste providers that rewrite pasted text beyond indentation, and
 * multi-cursor paste (multi-change events are excluded).
 *
 * History: until 2026-07 the rule was `inserted length >= 11 chars OR multi-line heuristic`,
 * mirroring the study pipeline's paste_events derivation. Retired as a documented deviation -
 * see the N1 note in services/struggle/config.ts.
 *
 * Must stay free of module-load side effects: vitest logic tests import this file with a
 * partial vscode mock (type-only vscode usage is fine).
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
 * Plain-data snapshot of a paste candidate. Deliberately contains NO vscode object references,
 * so the caller can safely hold it across the async clipboard read (the vscode change event
 * must not be retained past the handler).
 */
export interface PasteCandidate {
    readonly ts: number;
    readonly uri: vscode.Uri;
    readonly text: string;
    readonly chars: number;
    readonly lines: number;
    readonly rangeLength: number;
    readonly rangeIsEmpty: boolean;
    readonly rangeIsSingleLine: boolean;
}

/**
 * Normalize text for the paste-vs-clipboard comparison: VS Code's auto-indent rewrites the
 * leading whitespace of pasted lines, so it must not defeat the match. CRLF -> LF, strip
 * leading whitespace per line, trim trailing whitespace of the whole string.
 */
export function normalizePasteText(text: string): string {
    return text
        .replace(/\r\n/g, '\n')
        .split('\n')
        .map(line => line.replace(/^\s+/, ''))
        .join('\n')
        .replace(/\s+$/, '');
}

/**
 * Sync candidate gate (steps 1-4 of the N1 rule): multi-line insert (>= 2 lines, Pu 2025 -
 * no char minimum: the study's recorder-confirmed pastes have a 9-char median), not undo/redo,
 * a single-change event, not a formatter rewrite. Returns a plain-data snapshot for the
 * qualification step, or null when the event cannot be a paste (keystrokes and all
 * single-line changes never reach the async clipboard hop).
 */
export function snapshotPasteCandidate(signal: TextChangeSignal): PasteCandidate | null {
    // Undo/redo replays old edits; reason is undefined for normal typing/paste.
    if (signal.event.reason !== undefined) {
        return null;
    }
    // A real paste is one contentChange; formatter batches, refactorings and auto-import
    // combos come as several. (Declared trade-off: multi-cursor paste is excluded too.)
    if (signal.event.contentChanges.length !== 1) {
        return null;
    }
    const change = signal.event.contentChanges[0];
    const text = change.text;
    if (text.length === 0 || text.split('\n').length < 2) {
        return null;
    }
    if (change.rangeLength > FORMATTER_CHAR_THRESHOLD) {
        return null;
    }
    return {
        ts: signal.ts,
        uri: signal.event.document.uri,
        text,
        chars: text.length,
        lines: text.split('\n').length,
        rangeLength: change.rangeLength,
        rangeIsEmpty: change.range.isEmpty,
        rangeIsSingleLine: change.range.isSingleLine,
    };
}

/**
 * Sync qualification (step 5): clipboard confirmation, or the shape heuristic when the
 * clipboard could not be read.
 *
 * @param clipboardText the clipboard content at event time; `undefined` means the read FAILED
 *   (rejection). An empty string is a normal successful read and never matches.
 */
export function qualifyPasteCandidate(
    candidate: PasteCandidate,
    clipboardText: string | undefined,
): PasteSignal | null {
    let qualifies: boolean;
    if (clipboardText !== undefined) {
        const normalized = normalizePasteText(candidate.text);
        qualifies = normalized.length > 0 && normalized === normalizePasteText(clipboardText);
    } else {
        // Clipboard unreadable: fall back to the shape-only heuristic, evaluated on the
        // snapshot fields (same guards as isLikelyManualPaste; the size + formatter gates
        // already passed in snapshotPasteCandidate).
        qualifies = candidate.rangeIsEmpty || !candidate.rangeIsSingleLine;
    }
    if (!qualifies) {
        return null;
    }
    return {
        ts: candidate.ts,
        uri: candidate.uri,
        chars: candidate.chars,
        lines: candidate.lines,
    };
}

/**
 * Full N1 paste detection over one textChange event (thin composition of snapshot +
 * qualification; the live hub calls the two halves separately around its clipboard read).
 */
export function detectPastes(signal: TextChangeSignal, clipboardText: string | undefined): PasteSignal[] {
    const candidate = snapshotPasteCandidate(signal);
    if (candidate === null) {
        return [];
    }
    const paste = qualifyPasteCandidate(candidate, clipboardText);
    return paste ? [paste] : [];
}
