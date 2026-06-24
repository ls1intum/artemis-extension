import { describe, expect, it } from 'vitest';

import type { ResultDTO } from '@extension/domain/submissions';
import { BuildDeltaTracker } from '@extension/services/struggle/signals/buildDelta';

function result(failed: string[], buildFailed = false): ResultDTO {
    return {
        id: 1,
        submission: { id: 1, buildFailed },
        feedbacks: failed.map(detail => ({ positive: false, detailText: detail, text: 't' })),
    } as unknown as ResultDTO;
}

describe('BuildDeltaTracker (build_episodes delta_vs_prev + engine classification)', () => {
    it('classifies the full sequence first/identical/improved/worse/same-count', () => {
        const b = new BuildDeltaTracker();
        expect(b.ingest(10, result(['a', 'b'])).delta).toBe('first');
        expect(b.ingest(20, result(['a', 'b'])).delta).toBe('identical-set');
        expect(b.ingest(30, result(['a'])).delta).toBe('improved');
        expect(b.ingest(40, result(['a', 'c'])).delta).toBe('worse');
        expect(b.ingest(50, result(['b', 'd'])).delta).toBe('same-count');
    });
    it('compile-error does NOT advance the baseline', () => {
        const b = new BuildDeltaTracker();
        b.ingest(10, result(['a', 'b']));
        expect(b.ingest(20, result([], true)).delta).toBe('compile-error');
        expect(b.ingest(30, result(['a', 'b'])).delta).toBe('identical-set'); // vs build at t=10
    });
    it('duplicate failure strings collapse (set semantics)', () => {
        const b = new BuildDeltaTracker();
        b.ingest(10, result(['a', 'a', 'b']));
        expect(b.ingest(20, result(['a', 'b'])).delta).toBe('identical-set');
    });
    it('FM classification: compile-error, bad deltas with failures, first-failed', () => {
        const b = new BuildDeltaTracker();
        expect(b.ingest(10, result(['a'])).isFM).toBe(true);              // first + failed
        expect(b.ingest(20, result(['a'])).isFM).toBe(true);              // identical-set
        expect(b.ingest(24, result(['a', 'x'])).isFM).toBe(true);         // worse (1 -> 2)
        expect(b.ingest(27, result(['b', 'y'])).isFM).toBe(true);         // same-count (2 vs 2, different)
        expect(b.ingest(30, result([])).isFM).toBe(false);                // improved to clean
        expect(b.ingest(40, result([], true)).isFM).toBe(true);           // compile-error
    });
    it('first with zero failures is NOT FM', () => {
        const b = new BuildDeltaTracker();
        expect(b.ingest(10, result([])).isFM).toBe(false);
    });
    it('FM+ = improved AND failures remain', () => {
        const b = new BuildDeltaTracker();
        b.ingest(10, result(['a', 'b', 'c']));
        const r = b.ingest(20, result(['a']));
        expect(r.delta).toBe('improved');
        expect(r.isFMPlus).toBe(true);
        b.ingest(30, result(['a']));                                       // identical
        expect(b.ingest(40, result([])).isFMPlus).toBe(false);             // improved to clean
    });
    it('improved/non-improved split: every non-improved delta counts as non-improved', () => {
        const b = new BuildDeltaTracker();
        expect(b.ingest(10, result(['a'])).improved).toBe(false);          // first
        expect(b.ingest(20, result([], true)).improved).toBe(false);       // compile-error
        expect(b.ingest(30, result([])).improved).toBe(true);
    });
});
