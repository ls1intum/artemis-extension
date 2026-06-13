import { describe, expect, it } from 'vitest';

import { detectPastes } from '@extension/services/sensing/collectors/paste';
import type { TextChangeSignal } from '@extension/services/sensing/types';

function signal(changes: Array<{ text: string; rangeLength?: number; singleLine?: boolean }>, uri = 'file:///ws/Main.java'): TextChangeSignal {
    return {
        ts: 1000,
        event: {
            document: { uri: { toString: () => uri } },
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

describe('detectPastes (v2 paste rule: long insert OR manual multi-line paste)', () => {
    it('emits for a long single-line insert (>= 11 chars)', () => {
        const out = detectPastes(signal([{ text: 'x'.repeat(11) }]));
        expect(out).toHaveLength(1);
        expect(out[0]).toMatchObject({ ts: 1000, chars: 11, lines: 1 });
    });
    it('does not emit for a short single-line insert (10 chars)', () => {
        expect(detectPastes(signal([{ text: 'x'.repeat(10) }]))).toHaveLength(0);
    });
    it('emits for a short multi-line manual paste (3 chars, 2 lines)', () => {
        const out = detectPastes(signal([{ text: 'a\nb' }]));
        expect(out).toHaveLength(1);
        expect(out[0]).toMatchObject({ chars: 3, lines: 2 });
    });
    it('does not emit for a formatter rewrite (multi-line, rangeLength > 1000)', () => {
        expect(detectPastes(signal([{ text: 'a\nb', rangeLength: 1001, singleLine: false }]))).toHaveLength(0);
    });
    it('emits once for a change qualifying under BOTH rules (no duplicate)', () => {
        expect(detectPastes(signal([{ text: 'line one is long\nline two' }]))).toHaveLength(1);
    });
    it('emits per qualifying change within one event', () => {
        const out = detectPastes(signal([{ text: 'x'.repeat(20) }, { text: 'short' }, { text: 'a\nb\nc' }]));
        expect(out).toHaveLength(2);
    });
    it('ignores empty-text changes (pure deletions)', () => {
        expect(detectPastes(signal([{ text: '', rangeLength: 50 }]))).toHaveLength(0);
    });
});
