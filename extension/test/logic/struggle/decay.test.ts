import { describe, expect, it } from 'vitest';

import { FastDecayTracker, VTracker } from '@extension/services/struggle/dynamics/decay';

function ticksFor(durationS: number): number[] {
    const out: number[] = [];
    for (let t = 10; t <= durationS; t += 10) { out.push(t); }
    return out;
}

describe('VTracker (Python compute_v port)', () => {
    it('T1c: V(t_first) = S(t_first)', () => {
        const v = new VTracker();
        expect(v.update(10, 0.8, false)).toBe(0.8);
    });
    it('T1d: decay from the 2nd tick with hl=120', () => {
        const v = new VTracker();
        v.update(10, 0.8, false);
        expect(v.update(20, 0.0, false)).toBeCloseTo(0.8 * 2 ** (-10 / 120), 12);
    });
});

describe('FastDecayTracker (Python fast_decay_active port)', () => {
    it('T2a/T2b: regime active from the first tick >= improved-ts, hl=30 inside', () => {
        const fast = new FastDecayTracker();
        const v = new VTracker();
        fast.ingestImproved(95);
        const ticks = ticksFor(260);
        const vs: number[] = [];
        const flags: boolean[] = [];
        for (const t of ticks) {
            const f = fast.activeAt(t);
            flags.push(f);
            vs.push(v.update(t, t === 10 ? 1.0 : 0.0, f));
        }
        const i100 = ticks.indexOf(100);
        expect(flags[i100]).toBe(true);                       // T2a
        expect(vs[i100]).toBeCloseTo(vs[i100 - 1] * 2 ** (-10 / 30), 12); // T2b
        const i220 = ticks.indexOf(220);
        expect(flags[i220]).toBe(false);                      // T2c: ends after 120 s
    });
    it('T2d: a non-improved build ends the regime immediately', () => {
        const fast = new FastDecayTracker();
        fast.ingestImproved(95);
        expect(fast.activeAt(140)).toBe(true);
        fast.ingestNonImproved(145);
        expect(fast.activeAt(150)).toBe(false);
    });
    it('a later improved build restarts the regime after a kill', () => {
        const fast = new FastDecayTracker();
        fast.ingestImproved(95);
        fast.ingestNonImproved(120);
        expect(fast.activeAt(130)).toBe(false);
        fast.ingestImproved(150);
        expect(fast.activeAt(160)).toBe(true);
    });
    it('no regime before any improved build', () => {
        expect(new FastDecayTracker().activeAt(50)).toBe(false);
    });
});
