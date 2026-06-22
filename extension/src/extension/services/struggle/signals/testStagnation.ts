// extension/src/extension/services/struggle/signals/testStagnation.ts
/**
 * Test-Stagnation (Engine v3 add-on, Schicht 2 signal). Detects a student who
 * keeps submitting but is stuck at the SAME test outcome: N consecutive
 * test-bearing builds with an IDENTICAL (passedTestCaseCount, testCaseCount)
 * plateau fire on the Nth. Progress OR regression both reset the plateau (a
 * worsening build is the FM/boundary path's job, not stagnation), and a
 * denominator change resets it too (5/10 -> 5/20 is not "the same place").
 *
 * Engineering add-on — NOT in the validated alerts_full_u reference, so it has
 * no golden and is gated by an ablation flag on the DecisionEngine. N defaults
 * to 3 (-> config TUNING in WS4).
 *
 * "Test-bearing" is strict (codex): a build counts only with finite counts,
 * testCaseCount > 0, and 0 <= passed <= total. Compile-error builds (counts
 * nulled by BuildClassification) and malformed/empty (0/0) builds are SKIPPED
 * with NO state change — the skip is transparent to the streak.
 */
import type { BuildClassification } from '@extension/services/struggle/signals/buildDelta';

export class TestStagnationTracker {
    private readonly _n: number;
    private _plateauPassed: number | null = null;
    private _plateauTotal: number | null = null;
    private _streak = 0;

    constructor(n = 3) {
        this._n = n;
    }

    /** Ingest a build classification; return whether THIS build is a stagnation fire. */
    ingest(c: BuildClassification): boolean {
        const passed = c.passedTestCaseCount;
        const total = c.testCaseCount;
        if (passed === null || total === null || total <= 0 || passed < 0 || passed > total) {
            return false;                                  // not test-bearing: skip, no state change
        }
        if (this._plateauPassed === null || passed !== this._plateauPassed || total !== this._plateauTotal) {
            this._plateauPassed = passed;                  // first build or a new plateau
            this._plateauTotal = total;
            this._streak = 1;
        } else {
            this._streak += 1;                             // same plateau persists
        }
        return this._streak >= this._n;
    }

    reset(): void {
        this._plateauPassed = null;
        this._plateauTotal = null;
        this._streak = 0;
    }
}
