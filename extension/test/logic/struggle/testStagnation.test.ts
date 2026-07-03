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

/** Feed a sequence of (passed,total) builds; return the per-build fire flags.
 *  A [null, null] build models a compile-error / failed build. */
function run(builds: Array<[number | null, number | null]>, n = 3): boolean[] {
    const t = new TestStagnationTracker(n);
    return builds.map(([p, tot]) => t.ingest(cls(p, tot)));
}

describe('TestStagnationTracker (no-progress streak)', () => {
    it('never fires on the first test build', () => {
        expect(run([[2, 5]])).toEqual([false]);
    });

    it('fires on the 3rd consecutive build without a new high', () => {
        expect(run([[2, 5], [2, 5], [2, 5]])).toEqual([false, false, true]);
    });

    it('keeps firing while the stagnation persists (cooldown spaces them downstream)', () => {
        expect(run([[2, 5], [2, 5], [2, 5], [2, 5]])).toEqual([false, false, true, true]);
    });

    it('a strict new high resets the streak (the gaining build does not count)', () => {
        // 2 -> 3 is real progress (reset to 0); the three flat 3s then fire on build 5.
        expect(run([[2, 5], [3, 5], [3, 5], [3, 5], [3, 5]])).toEqual([false, false, false, false, true]);
    });

    it('continuous improvement never stagnates', () => {
        expect(run([[2, 5], [3, 5], [4, 5], [5, 5]])).toEqual([false, false, false, false]);
    });

    it('a new high mid-streak fully resets the count', () => {
        // 2,2 (streak 2), 3 = new high (reset), 2,2 -> only 2 no-progress builds after, no fire.
        expect(run([[2, 5], [2, 5], [3, 5], [2, 5], [2, 5]])).toEqual([false, false, false, false, false]);
    });

    it('a regression counts as no progress and does NOT reset', () => {
        // 5,4,3 -> none beats the 5 high, so the 3rd build fires; keeps firing after.
        expect(run([[5, 10], [4, 10], [3, 10], [2, 10]])).toEqual([false, false, true, true]);
    });

    it('oscillating below the best counts as stuck (3->2->3 never beats 3)', () => {
        expect(run([[3, 5], [2, 5], [3, 5]])).toEqual([false, false, true]);
    });

    it('a failed build counts as no progress', () => {
        // 2/5, BUILD FAILED, 2/5 -> the failure is a no-progress build, fires on the 3rd.
        expect(run([[2, 5], [null, null], [2, 5]])).toEqual([false, false, true]);
    });

    it('three failed builds in a row stagnate even with no prior baseline', () => {
        expect(run([[null, null], [null, null], [null, null]])).toEqual([false, false, true]);
    });

    it('a failed build after a baseline keeps the streak running', () => {
        expect(run([[2, 5], [null, null], [null, null]])).toEqual([false, false, true]);
    });

    it('reaching a test-bearing build after only failures restarts the plateau', () => {
        // fail,fail establish a streak; the first real build is a fresh baseline, not a fire.
        expect(run([[null, null], [null, null], [2, 5], [2, 5]])).toEqual([false, false, false, false]);
    });

    it('a denominator change starts a fresh plateau (no false stagnation)', () => {
        // passed flat at 5 but the test suite grows: never a 3-build run at one denominator.
        expect(run([[5, 10], [5, 20], [5, 30]])).toEqual([false, false, false]);
    });

    it('a denominator change mid-streak kills the running streak', () => {
        // 5/10 twice (streak 2), then the suite grows: the old streak must NOT carry over.
        expect(run([[5, 10], [5, 10], [5, 20], [5, 20]])).toEqual([false, false, false, false]);
    });

    it('a partial-null count pair is malformed, not a failed build (transparent skip)', () => {
        // only one count present -> incomplete data, skipped with no state change.
        expect(run([[2, 5], [3, null], [2, 5], [2, 5]])).toEqual([false, false, false, true]);
    });

    it('a 0/0 build is not test-bearing and never stagnates', () => {
        expect(run([[0, 0], [0, 0], [0, 0]])).toEqual([false, false, false]);
    });

    it('a malformed passed>total build is skipped transparently', () => {
        expect(run([[2, 5], [9, 5], [2, 5], [2, 5]])).toEqual([false, false, false, true]);
    });

    it('reset() clears the baseline and streak', () => {
        const t = new TestStagnationTracker(3);
        expect(t.ingest(cls(2, 5))).toBe(false);
        expect(t.ingest(cls(2, 5))).toBe(false);
        t.reset();
        // After reset the next build is a fresh baseline -> streak restarts.
        expect(t.ingest(cls(2, 5))).toBe(false);
        expect(t.ingest(cls(2, 5))).toBe(false);
        expect(t.ingest(cls(2, 5))).toBe(true);
    });

    it('exposes the live streak and N as telemetry getters', () => {
        const t = new TestStagnationTracker(3);
        expect(t.n).toBe(3);
        expect(t.streak).toBe(0);
        t.ingest(cls(2, 5));        // baseline -> streak 1
        expect(t.streak).toBe(1);
        t.ingest(cls(2, 5));        // flat -> streak 2
        expect(t.streak).toBe(2);
        t.ingest(cls(3, 5));        // strict new high -> reset
        expect(t.streak).toBe(0);
        t.reset();
        expect(t.streak).toBe(0);
    });
});
