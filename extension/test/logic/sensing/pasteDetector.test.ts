import { describe, expect, it } from 'vitest';

import { detectPastes, normalizePasteText } from '@extension/services/sensing/collectors/paste';
import type { TextChangeSignal } from '@extension/services/sensing/types';

function signal(
    changes: Array<{ text: string; rangeLength?: number; singleLine?: boolean }>,
    opts: { uri?: string; reason?: number } = {},
): TextChangeSignal {
    return {
        ts: 1000,
        event: {
            document: { uri: { toString: () => opts.uri ?? 'file:///ws/Main.java' } },
            reason: opts.reason,
            contentChanges: changes.map(c => ({
                text: c.text,
                rangeLength: c.rangeLength ?? 0,
                range: {
                    isEmpty: (c.rangeLength ?? 0) === 0,
                    isSingleLine: c.singleLine ?? true,
                },
            })),
        },
    } as unknown as TextChangeSignal;
}

describe('detectPastes (N1 rule: clipboard-confirmed paste of >= 2 lines, Pu 2025)', () => {
    // ---- completion false positives that must not fire ----

    it('IntelliSense accept (single-line prefix replace, long identifier) is NOT a paste', () => {
        const out = detectPastes(signal([{ text: 'calculateOptimalPayment', rangeLength: 9 }]), 'unrelated clipboard');
        expect(out).toHaveLength(0);
    });

    it('Copilot single-line inline accept (pure insert, 40 chars) is NOT a paste', () => {
        const out = detectPastes(signal([{ text: 'x'.repeat(40) }]), 'unrelated clipboard');
        expect(out).toHaveLength(0);
    });

    it('Copilot MULTI-line accept (pure insert, 3 lines, clipboard unrelated) is NOT a paste', () => {
        const out = detectPastes(signal([{ text: 'if (a) {\n    doIt();\n}' }]), 'something else entirely');
        expect(out).toHaveLength(0);
    });

    // ---- the Pu-alignment trade-off, pinned ----

    it('a REAL single-line paste (clipboard match, 20 chars) is NOT a paste (>= 2 lines required)', () => {
        const text = 'return a > b && c;xx';
        expect(detectPastes(signal([{ text }]), text)).toHaveLength(0);
    });

    // ---- real pastes that must fire ----

    it('a small 2-line paste (9 chars, clipboard match) IS a paste - no char floor (study median)', () => {
        const text = 'a();\nb();';
        const out = detectPastes(signal([{ text }]), text);
        expect(out).toHaveLength(1);
        expect(out[0]).toMatchObject({ ts: 1000, chars: 9, lines: 2 });
    });

    it('a multi-line paste reindented by auto-indent still matches the clipboard', () => {
        const out = detectPastes(signal([{ text: '    a();\n      b();' }]), 'a();\n  b();');
        expect(out).toHaveLength(1);
    });

    it('a multi-line paste OVER a selection (non-empty range, clipboard match) IS a paste', () => {
        const text = 'first();\nsecond();';
        const out = detectPastes(signal([{ text, rangeLength: 30, singleLine: false }]), text);
        expect(out).toHaveLength(1);
    });

    it('clipboard beats shape: multi-line paste over a SINGLE-line selection IS a paste', () => {
        // Same shape as a Copilot/snippet expansion (single-line range -> multi-line text),
        // which the heuristic fallback excludes - but a clipboard match proves it is a real
        // paste, and the clipboard-confirmed path deliberately ignores range shape.
        const text = 'first();\nsecond();';
        const out = detectPastes(signal([{ text, rangeLength: 8, singleLine: true }]), text);
        expect(out).toHaveLength(1);
    });

    // ---- guards ----

    it('undo is NOT a paste even with a clipboard match', () => {
        const text = 'a();\nb();';
        expect(detectPastes(signal([{ text }], { reason: 1 }), text)).toHaveLength(0);
    });

    it('a multi-change event is NOT a paste even when one change is paste-shaped', () => {
        const text = 'a();\nb();';
        expect(detectPastes(signal([{ text }, { text: 'import x;' }]), text)).toHaveLength(0);
    });

    it('a formatter rewrite (rangeLength > 1000) is NOT a paste even with a clipboard match', () => {
        const text = 'a();\nb();';
        expect(detectPastes(signal([{ text, rangeLength: 1001, singleLine: false }]), text)).toHaveLength(0);
    });

    it('pure deletions (empty text) never fire', () => {
        expect(detectPastes(signal([{ text: '', rangeLength: 50 }]), '')).toHaveLength(0);
    });

    // ---- clipboard semantics ----

    it('an EMPTY clipboard (successful read) never matches and does NOT fall back', () => {
        expect(detectPastes(signal([{ text: 'a();\nb();' }]), '')).toHaveLength(0);
    });

    it('whitespace-only insert + whitespace-only clipboard do not match (normalized-empty)', () => {
        expect(detectPastes(signal([{ text: '  \n  ' }]), '\n  ')).toHaveLength(0);
    });

    it('clipboard read FAILURE (undefined) falls back to the multi-line heuristic', () => {
        const out = detectPastes(signal([{ text: 'a();\nb();' }]), undefined);
        expect(out).toHaveLength(1);
    });

    it('clipboard read failure + single-line long insert stays NOT a paste', () => {
        expect(detectPastes(signal([{ text: 'x'.repeat(20) }]), undefined)).toHaveLength(0);
    });

    it('clipboard read failure + multi-line COPILOT-shaped replacement (single-line range) is NOT a paste (heuristic guard)', () => {
        // Single-line range replaced by multi-line output = Copilot/snippet shape, excluded by isLikelyManualPaste.
        expect(detectPastes(signal([{ text: 'a();\nb();', rangeLength: 5, singleLine: true }]), undefined)).toHaveLength(0);
    });
});

describe('normalizePasteText', () => {
    it('normalizes CRLF to LF', () => {
        expect(normalizePasteText('a\r\nb')).toBe('a\nb');
    });
    it('strips leading whitespace per line (auto-indent on paste)', () => {
        expect(normalizePasteText('    a\n\t  b')).toBe('a\nb');
    });
    it('trims trailing whitespace of the whole string', () => {
        expect(normalizePasteText('a\nb  \n')).toBe('a\nb');
    });
    it('whitespace-only input normalizes to the empty string', () => {
        expect(normalizePasteText(' \n \t ')).toBe('');
    });
});
