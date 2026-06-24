import { describe, expect, it } from 'vitest';

import { FileTextState } from './textReconstruction';

const URI = 'file:///Users/x/exercise/src/Foo.java';

describe('FileTextState', () => {
    it('returns undefined and has()===false for a URI that was never seeded', () => {
        const state = new FileTextState();
        expect(state.has(URI)).toBe(false);
        expect(state.getText(URI)).toBeUndefined();
    });

    it('seeds a snapshot and reports it as current text', () => {
        const state = new FileTextState();
        state.seedSnapshot(URI, 'abc\ndef');
        expect(state.has(URI)).toBe(true);
        expect(state.getText(URI)).toBe('abc\ndef');
    });

    it('applies a single insert at a given rangeOffset', () => {
        const state = new FileTextState();
        state.seedSnapshot(URI, 'abc\ndef');
        // Insert "XY" after "abc\n" (offset 4), inserting nothing replaced.
        state.applyChanges(URI, [{ rangeOffset: 4, rangeLength: 0, text: 'XY' }]);
        expect(state.getText(URI)).toBe('abc\nXYdef');
    });

    it('applies a single replace at a given rangeOffset', () => {
        const state = new FileTextState();
        state.seedSnapshot(URI, 'abc\ndef');
        // Replace "abc" (offset 0, length 3) with "ZZZZ".
        state.applyChanges(URI, [{ rangeOffset: 0, rangeLength: 3, text: 'ZZZZ' }]);
        expect(state.getText(URI)).toBe('ZZZZ\ndef');
    });

    it('applies a multi-change event in ARRAY ORDER (VS Code descending-position delivery)', () => {
        const state = new FileTextState();
        state.seedSnapshot(URI, 'abc\ndef');
        // VS Code delivers contentChanges sorted by DESCENDING position: the
        // later array entry has the smaller offset. Applying in array order
        // keeps earlier (higher-offset) edits from invalidating later ones.
        //   entry 0: replace "def" (offset 4, len 3) -> "ghi"
        //   entry 1: replace "abc" (offset 0, len 3) -> "AB"
        state.applyChanges(URI, [
            { rangeOffset: 4, rangeLength: 3, text: 'ghi' },
            { rangeOffset: 0, rangeLength: 3, text: 'AB' },
        ]);
        expect(state.getText(URI)).toBe('AB\nghi');
    });

    it('accumulates across multiple applyChanges calls', () => {
        const state = new FileTextState();
        state.seedSnapshot(URI, 'abc');
        state.applyChanges(URI, [{ rangeOffset: 3, rangeLength: 0, text: 'def' }]);
        state.applyChanges(URI, [{ rangeOffset: 6, rangeLength: 0, text: 'ghi' }]);
        expect(state.getText(URI)).toBe('abcdefghi');
    });

    it('throws on a negative rangeOffset', () => {
        const state = new FileTextState();
        state.seedSnapshot(URI, 'abc\ndef');
        expect(() => state.applyChanges(URI, [{ rangeOffset: -1, rangeLength: 0, text: 'X' }]))
            .toThrow(/rangeOffset/);
    });

    it('throws on a rangeOffset beyond the current length', () => {
        const state = new FileTextState();
        state.seedSnapshot(URI, 'abc\ndef');
        // length is 7; offset 8 is out of bounds.
        expect(() => state.applyChanges(URI, [{ rangeOffset: 8, rangeLength: 0, text: 'X' }]))
            .toThrow(/exceeds/);
    });

    it('throws on a range that extends past the current length', () => {
        const state = new FileTextState();
        state.seedSnapshot(URI, 'abc\ndef');
        // offset 5 + length 5 = 10 > 7.
        expect(() => state.applyChanges(URI, [{ rangeOffset: 5, rangeLength: 5, text: 'X' }]))
            .toThrow(/exceeds/);
    });

    it('throws when applying changes to a URI that was never seeded', () => {
        const state = new FileTextState();
        expect(() => state.applyChanges(URI, [{ rangeOffset: 0, rangeLength: 0, text: 'X' }]))
            .toThrow(/never seeded|not seeded|seed/i);
    });
});
