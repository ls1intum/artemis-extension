import { describe, expect, it } from 'vitest';

import { alignLines, N2Tracker, normalizeDiagnosticCode } from '@extension/services/struggle/signals/errorDistance';

describe('alignLines (order-preserving min-distance alignment)', () => {
    it('pairs equal-length lists in order', () => {
        expect(alignLines([3, 10], [4, 11])).toEqual([[0, 0], [1, 1]]);
    });
    it('forms min(m,n) pairs, skipping the surplus to minimize total distance', () => {
        expect(alignLines([5], [1, 5, 9])).toEqual([[0, 1]]);
        expect(alignLines([1, 5, 9], [5])).toEqual([[1, 0]]);
    });
    it('never crosses pairs (order preserved)', () => {
        // naive nearest-match would pair 10->9 and 11->12 crossing 10->12;
        // order-preserving optimum is (10->9),(11->12)
        expect(alignLines([10, 11], [9, 12])).toEqual([[0, 0], [1, 1]]);
    });
    it('empty sides produce no pairs', () => {
        expect(alignLines([], [1])).toEqual([]);
        expect(alignLines([1], [])).toEqual([]);
    });
});

describe('normalizeDiagnosticCode (one shared identity normalization)', () => {
    it('matches the offline reference: missing -> "None", numbers/strings/objects -> value string', () => {
        expect(normalizeDiagnosticCode(undefined)).toBe('None');
        expect(normalizeDiagnosticCode(null)).toBe('None');
        expect(normalizeDiagnosticCode(1234)).toBe('1234');
        expect(normalizeDiagnosticCode('compiler.err.x')).toBe('compiler.err.x');
        expect(normalizeDiagnosticCode({ value: 'E42' })).toBe('E42');
    });
});

describe('N2Tracker (far long-lived error vs cursor)', () => {
    const URI = 'file:///F.java';
    function err(line: number, code = 'E1', message = 'msg'): { line: number; code: string; message: string } {
        return { line, code, message };
    }

    it('fires only after 60 s of continuous activity, > 3 lines from the cursor, same uri', () => {
        const n2 = new N2Tracker();
        n2.ingestSnapshot(10, URI, [err(20)]);
        n2.ingestSelection(15, URI, 10);              // distance |20-10| = 10 > 3
        expect(n2.activeAt(60)).toBe(false);           // 60 - 10 = 50 <= 60
        expect(n2.activeAt(70.001)).toBe(true);        // > 60 strictly
        expect(n2.activeAt(70)).toBe(false);           // exactly 60: NOT > 60
    });
    it('near errors (<= 3 lines) never fire', () => {
        const n2 = new N2Tracker();
        n2.ingestSnapshot(10, URI, [err(12)]);
        n2.ingestSelection(15, URI, 10);               // distance 2
        expect(n2.activeAt(100)).toBe(false);
    });
    it('cursor in another file never fires', () => {
        const n2 = new N2Tracker();
        n2.ingestSnapshot(10, URI, [err(20)]);
        n2.ingestSelection(15, 'file:///G.java', 0);
        expect(n2.activeAt(100)).toBe(false);
    });
    it('no cursor position -> 0 (missing handling, spec §0)', () => {
        const n2 = new N2Tracker();
        n2.ingestSnapshot(10, URI, [err(20)]);
        expect(n2.activeAt(100)).toBe(false);
    });
    it('an empty snapshot resolves instances (causal: inactive from removal on)', () => {
        const n2 = new N2Tracker();
        n2.ingestSnapshot(10, URI, [err(20)]);
        n2.ingestSelection(15, URI, 10);
        n2.ingestSnapshot(50, URI, []);
        expect(n2.activeAt(120)).toBe(false);
    });
    it('line shifts keep t_first (alignment) and use line_first for distance', () => {
        const n2 = new N2Tracker();
        n2.ingestSnapshot(10, URI, [err(20)]);
        n2.ingestSnapshot(40, URI, [err(23)]);         // same identity, shifted
        n2.ingestSelection(45, URI, 18);               // |line_first 20 - 18| = 2 <= 3 -> near
        expect(n2.activeAt(120)).toBe(false);
        n2.ingestSelection(125, URI, 10);              // |20 - 10| = 10 > 3, t_first = 10
        expect(n2.activeAt(130)).toBe(true);
    });
    it('a new identity resets t_first', () => {
        const n2 = new N2Tracker();
        n2.ingestSnapshot(10, URI, [err(20, 'E1')]);
        n2.ingestSnapshot(50, URI, [err(20, 'E2')]);   // different code: new instance
        n2.ingestSelection(55, URI, 10);
        expect(n2.activeAt(100)).toBe(false);          // 100 - 50 = 50 <= 60
        expect(n2.activeAt(115)).toBe(true);
    });
});
