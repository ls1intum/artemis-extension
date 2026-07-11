/**
 * Build-result delta classification (spec §2/§3): failed-test SET diff against
 * the last build WITH test information (compile-error builds have no test info
 * and never advance the baseline). The failed set uses the recorder-equivalent
 * derivation — detailText of feedbacks with positive === false — because the
 * frozen reference compared exactly those strings (PR 2b plan, Decision 11).
 *
 * Port of build_episodes_for (02_event_tables.py) + the FM/improved
 * classification of build_inputs (engine_v2.py). FM fires on a failing build
 * with no progress; an improved-but-still-failing build no longer triggers.
 */
import type { ResultDTO } from '@extension/domain/submissions';
import { SPEC } from '@extension/services/struggle/config';

export type BuildDelta = 'compile-error' | 'first' | 'identical-set' | 'improved' | 'worse' | 'same-count';

export interface BuildClassification {
    readonly tsS: number;
    readonly delta: BuildDelta;
    readonly failedCount: number | null;
    readonly isFM: boolean;
    readonly improved: boolean;
    /** Passing/total test-case counts (from ResultDTO). Both null for a
     *  compile-error build (buildFailed) — no test info — so a stale backend
     *  count can never contaminate the Test-Stagnation add-on. */
    readonly passedTestCaseCount: number | null;
    readonly testCaseCount: number | null;
}

function failedSetOf(result: ResultDTO): Set<string> {
    const out = new Set<string>();
    for (const fb of result.feedbacks ?? []) {
        if (fb.positive === false) {
            out.add(fb.detailText ?? '');
        }
    }
    return out;
}

function setsEqual(a: Set<string>, b: Set<string>): boolean {
    if (a.size !== b.size) { return false; }
    for (const x of a) {
        if (!b.has(x)) { return false; }
    }
    return true;
}

export class BuildDeltaTracker {
    private _prev: Set<string> | null = null;

    ingest(tsS: number, result: ResultDTO): BuildClassification {
        const buildFailed = result.submission?.buildFailed ?? false;
        let delta: BuildDelta;
        let failedCount: number | null;
        if (buildFailed) {
            delta = 'compile-error';
            failedCount = null;
        } else {
            const cur = failedSetOf(result);
            failedCount = cur.size;
            if (this._prev === null) {
                delta = 'first';
            } else if (setsEqual(cur, this._prev)) {
                delta = 'identical-set';
            } else if (cur.size < this._prev.size) {
                delta = 'improved';
            } else if (cur.size > this._prev.size) {
                delta = 'worse';
            } else {
                delta = 'same-count';
            }
            this._prev = cur;
        }
        const hasFailed = failedCount !== null && failedCount > 0;
        const badDeltas: readonly string[] = SPEC.FM_DELTAS_BAD;
        const isFM = delta === 'compile-error'
            || (hasFailed && badDeltas.includes(delta))
            || (hasFailed && delta === 'first');
        // A compile-error build carries no test info; null the counts so the
        // Test-Stagnation add-on can never read a stale backend value.
        const passedTestCaseCount = buildFailed ? null : result.passedTestCaseCount ?? null;
        const testCaseCount = buildFailed ? null : result.testCaseCount ?? null;
        return {
            tsS,
            delta,
            failedCount,
            isFM,
            improved: delta === 'improved',
            passedTestCaseCount,
            testCaseCount,
        };
    }

    reset(): void {
        this._prev = null;
    }
}
