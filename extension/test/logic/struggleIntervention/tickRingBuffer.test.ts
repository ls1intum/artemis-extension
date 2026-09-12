import { describe, expect, it } from 'vitest';

import type { TickRecord } from '@extension/services/struggle/types';
import { TickRingBuffer } from '@extension/services/struggleIntervention/tickRingBuffer';
import { emptyDecisionTrace } from '@test/__shared__/tickRecordFixture';

function tick(t: number): TickRecord {
    return { t, ts: t * 1000, features: {} as TickRecord['features'], sBase: 0, boundariesPreGate: [], alert: null, decisionTrace: emptyDecisionTrace };
}

describe('TickRingBuffer', () => {
    it('keeps only the last N ticks, oldest→newest', () => {
        const buf = new TickRingBuffer(12);
        for (let i = 1; i <= 14; i++) { buf.push(tick(i * 10)); }
        const snap = buf.snapshot();
        expect(snap).toHaveLength(12);
        expect(snap[0].t).toBe(30);    // first two (10, 20) dropped
        expect(snap[11].t).toBe(140);
    });

    it('clear empties the buffer', () => {
        const buf = new TickRingBuffer(12);
        buf.push(tick(10));
        buf.clear();
        expect(buf.snapshot()).toHaveLength(0);
    });
});
