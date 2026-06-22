import { describe, expect, it } from 'vitest';

import type { BuildClassification } from '@extension/services/struggle/signals/buildDelta';
import { TestStagnationTracker } from '@extension/services/struggle/signals/testStagnation';

/** Minimal BuildClassification — the tracker reads ONLY passed/testCaseCount. */
function cls(passed: number | null, total: number | null): BuildClassification {
    return {
        tsS: 0, delta: 'first', failedCount: null, isFM: false, isFMPlus: false,
        improved: false, passedTestCaseCount: passed, testCaseCount: total,
    };
}

/** Feed a sequence of (passed,total) builds; return the per-build fire flags. */
function run(builds: Array<[number | null, number | null]>, n = 3): boolean[] {
    const t = new TestStagnationTracker(n);
    return builds.map(([p, tot]) => t.ingest(cls(p, tot)));
}

describe('TestStagnationTracker (plateau, denominator-aware)', () => {
    it('never fires on the first test build', () => {
        expect(run([[2, 5]])).toEqual([false]);
    });

    it('fires on the 3rd consecutive identical (passed,total) build', () => {
        expect(run([[2, 5], [2, 5], [2, 5]])).toEqual([false, false, true]);
    });

    it('keeps firing while the plateau persists (cooldown spaces them downstream)', () => {
        expect(run([[2, 5], [2, 5], [2, 5], [2, 5]])).toEqual([false, false, true, true]);
    });

    it('progress resets the streak (a new plateau)', () => {
        // 2,3,3,3 -> the three 3s start at build 2; fires on build 4.
        expect(run([[2, 5], [3, 5], [3, 5], [3, 5]])).toEqual([false, false, false, true]);
    });

    it('regression resets the streak and never fires on worsening builds', () => {
        expect(run([[5, 10], [4, 10], [3, 10], [2, 10]])).toEqual([false, false, false, false]);
    });

    it('a denominator change resets the plateau (no false stagnation)', () => {
        // passed flat at 5 but the test suite grows: never 3 identical in a row.
        expect(run([[5, 10], [5, 20], [5, 30]])).toEqual([false, false, false]);
    });

    it('a compile-error build is skipped (does not break or advance the streak)', () => {
        // 2/5, compile-error, 2/5, 2/5 -> the skip is transparent, fires on the 3rd test build.
        expect(run([[2, 5], [null, null], [2, 5], [2, 5]])).toEqual([false, false, false, true]);
    });

    it('a 0/0 build is not test-bearing and never stagnates', () => {
        expect(run([[0, 0], [0, 0], [0, 0]])).toEqual([false, false, false]);
    });

    it('a malformed passed>total build is skipped', () => {
        expect(run([[2, 5], [9, 5], [2, 5], [2, 5]])).toEqual([false, false, false, true]);
    });

    it('reset() clears the plateau and streak', () => {
        const t = new TestStagnationTracker(3);
        expect(t.ingest(cls(2, 5))).toBe(false);
        expect(t.ingest(cls(2, 5))).toBe(false);
        t.reset();
        // After reset the next build is "first" again -> streak restarts.
        expect(t.ingest(cls(2, 5))).toBe(false);
        expect(t.ingest(cls(2, 5))).toBe(false);
        expect(t.ingest(cls(2, 5))).toBe(true);
    });
});
