import { describe, expect, it } from 'vitest';

import { rebaseAnchorLine } from '@extension/services/intervention/anchorRebase';

/** Build a file body from lines (join on \n, matching the mapper's split). */
const f = (...lines: string[]): string => lines.join('\n');

describe('rebaseAnchorLine', () => {
    it('returns the same line when the file is unchanged', () => {
        const body = f('a', 'b', 'c');
        expect(rebaseAnchorLine(body, body, 2)).toBe(2);
    });

    it('shifts the anchor down when a line is inserted above it', () => {
        const baseline = f('a', 'b', 'TARGET', 'c');
        const current = f('a', 'NEW', 'b', 'TARGET', 'c');
        // TARGET moves from 1-based line 3 to line 4.
        expect(rebaseAnchorLine(baseline, current, 3)).toBe(4);
    });

    it('shifts the anchor up when a line is deleted above it', () => {
        const baseline = f('a', 'DEL', 'TARGET', 'c');
        const current = f('a', 'TARGET', 'c');
        // TARGET moves from line 3 to line 2.
        expect(rebaseAnchorLine(baseline, current, 3)).toBe(2);
    });

    it('leaves the anchor in place when only lines below it change', () => {
        const baseline = f('a', 'TARGET', 'b', 'c');
        const current = f('a', 'TARGET', 'b', 'CHANGED');
        expect(rebaseAnchorLine(baseline, current, 2)).toBe(2);
    });

    it('returns undefined when the anchored line itself was rewritten', () => {
        const baseline = f('a', 'TARGET', 'c');
        const current = f('a', 'DIFFERENT', 'c');
        expect(rebaseAnchorLine(baseline, current, 2)).toBeUndefined();
    });

    it('re-finds the anchor by exact text inside the changed band, never the head duplicate', () => {
        // A bare `return 0;` guard sits in the common head; the real anchor return is inside the
        // changed band. The band-only search must map to the band occurrence, not the guard.
        const baseline = f('return 0;', 'x();', 'return 0;', 'y();');
        const current = f('return 0;', 'xx();', 'return 0;', 'yy();');
        expect(rebaseAnchorLine(baseline, current, 3)).toBe(3);
    });

    it('follows the final return past an inserted line (duplicate guard stays in the head)', () => {
        const baseline = f('if (x) return 0;', 'foo();', 'bar();', 'return 0;', '}');
        const current = f('if (x) return 0;', 'foo();', 'bar();', 'baz();', 'return 0;', '}');
        // The final `return 0;` shifts from line 4 to line 5; the guard on line 1 is untouched.
        expect(rebaseAnchorLine(baseline, current, 4)).toBe(5);
    });

    it('breaks a nearest-position tie deterministically toward the lowest index', () => {
        // Both current `T` lines are equidistant (dist 1) from the expected position: pick the lower.
        const baseline = f('A', 'B', 'T', 'C', 'D');
        const current = f('A', 'T', 'X', 'T', 'D');
        expect(rebaseAnchorLine(baseline, current, 3)).toBe(2);
    });

    it('returns undefined for an anchor line outside the snapshot', () => {
        expect(rebaseAnchorLine(f('a', 'b'), f('a', 'b'), 5)).toBeUndefined();
        expect(rebaseAnchorLine(f('a', 'b'), f('a', 'b'), 0)).toBeUndefined();
    });
});
