// extension/src/extension/services/struggle/signals/testStagnation.ts
/**
 * Test-Stagnation (Engine v3 add-on, Schicht 2 signal). Detects a student who
 * keeps submitting but is not getting any further: N consecutive builds WITHOUT
 * a new high in passed test cases fire on the Nth. "No progress" is broad — a
 * build counts as no-progress when the passed count does NOT strictly exceed the
 * best seen so far, i.e. it stayed flat, REGRESSED, or the build FAILED outright.
 * Only a strict new high (more tests passing than ever before in this plateau)
 * resets the streak. A denominator change (5/10 -> 5/20 — a different test set)
 * starts a fresh baseline, since passed counts are no longer comparable.
 *
 * This deliberately folds compile-error/failed builds and regressions INTO the
 * stagnation signal (Liam's V1 definition): repeatedly failing to move the test
 * needle — whether by staying flat, going backwards, or breaking the build — is
 * the same "stuck" behaviour. (A single worsening build also raises FM on the
 * edit path; the shared cooldown keeps the two from double-firing.)
 *
 * Engineering add-on — NOT in the validated alerts_full_u reference, so it has
 * no golden and is gated by an ablation flag on the DecisionEngine. N defaults
 * to 3 (-> config TUNING in WS4).
 *
 * Eligibility: a FAILED build (counts nulled by BuildClassification) is a valid
 * no-progress event and DOES advance the streak, but never updates the best-so-
 * far baseline. A MALFORMED build (testCaseCount <= 0, or passed out of [0,total])
 * is skipped with NO state change — the skip is transparent to the streak.
 */
import type { BuildClassification } from '@extension/services/struggle/signals/buildDelta';

export class TestStagnationTracker {
    private readonly _n: number;
    private _bestPassed: number | null = null;
    private _refTotal: number | null = null;
    private _streak = 0;

    constructor(n = 3) {
        this._n = n;
    }

    /** Ingest a build classification; return whether THIS build is a stagnation fire. */
    ingest(c: BuildClassification): boolean {
        const passed = c.passedTestCaseCount;
        const total = c.testCaseCount;

        // Failed build: BOTH counts null (compile-error, per BuildClassification)
        // -> no test info -> no progress. Advances the streak, but cannot move the
        // baseline (we don't know how many tests passed).
        if (passed === null && total === null) {
            this._streak += 1;
            return this._streak >= this._n;
        }
        // Incomplete (exactly one count null) or malformed (out-of-range) -> skip,
        // no state change. A half-null pair is not a real build outcome, so it must
        // not be mistaken for a failed build and advance the streak.
        if (passed === null || total === null || total <= 0 || passed < 0 || passed > total) {
            return false;
        }
        // A different test set: the passed counts are no longer comparable, so
        // start a fresh baseline (drop the old high before establishing below).
        if (this._refTotal !== null && total !== this._refTotal) {
            this._bestPassed = null;
            this._refTotal = null;
        }
        // First test-bearing build with no prior baseline (the very first build, OR
        // the first comparable build after only failed ones): establish the baseline
        // and start the clock at 1 (N=3 = "3 builds at this level without a new high").
        // This discards a failure-only prefix — reaching a test-bearing state from
        // nothing is progress, not stagnation. Once a baseline exists, later failures
        // keep advancing the streak instead (handled by the failed-build branch above).
        if (this._bestPassed === null) {
            this._bestPassed = passed;
            this._refTotal = total;
            this._streak = 1;
            return this._streak >= this._n;
        }
        // A strict new high is real progress: reset the streak; the gaining build
        // itself does not count toward the next stagnation.
        if (passed > this._bestPassed) {
            this._bestPassed = passed;
            this._refTotal = total;
            this._streak = 0;
            return false;
        }
        // Flat or regressed (never beats the best) -> no progress.
        this._streak += 1;
        return this._streak >= this._n;
    }

    reset(): void {
        this._bestPassed = null;
        this._refTotal = null;
        this._streak = 0;
    }
}
