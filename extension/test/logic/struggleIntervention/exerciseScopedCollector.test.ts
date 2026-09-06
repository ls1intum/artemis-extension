import { describe, expect, it } from 'vitest';

import { applyEgressCaps, type EgressCaps } from '@extension/services/struggleIntervention/exerciseScopedCollector';

const caps: EgressCaps = { maxFiles: 3, maxPerFileBytes: 20, maxTotalBytes: 40 };

describe('applyEgressCaps', () => {
    it('caps file count', () => {
        const out = applyEgressCaps([{ path: 'a', content: 'x' }, { path: 'b', content: 'y' }, { path: 'c', content: 'z' }, { path: 'd', content: 'w' }], caps);
        expect(Object.keys(out)).toHaveLength(3);
        expect(out.d).toBeUndefined();
    });
    it('skips a single oversized file but keeps others', () => {
        const out = applyEgressCaps([{ path: 'big', content: 'x'.repeat(30) }, { path: 'ok', content: 'y' }], caps);
        expect(out.big).toBeUndefined();
        expect(out.ok).toBe('y');
    });
    it('stops at the total-byte budget', () => {
        const out = applyEgressCaps([{ path: 'a', content: 'x'.repeat(18) }, { path: 'b', content: 'y'.repeat(18) }, { path: 'c', content: 'z'.repeat(18) }], caps);
        // 18 + 18 = 36 ≤ 40; adding the third (54) exceeds → stop.
        expect(Object.keys(out)).toEqual(['a', 'b']);
    });
});
