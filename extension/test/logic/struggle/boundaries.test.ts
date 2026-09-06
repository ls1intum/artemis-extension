import { describe, expect, it } from 'vitest';

import { BoundaryTracker, stateEntryTimes, ticksFor } from '@extension/services/struggle/boundaries/boundaryTracker';

describe('tick raster (Python ticks_for port)', () => {
    it('T1a: ticks 10..60 for duration 65', () => {
        expect(ticksFor(65)).toEqual([10, 20, 30, 40, 50, 60]);
    });
    it('T1b: no tick for duration < 10', () => {
        expect(ticksFor(9.9)).toEqual([]);
    });
});

describe('event-to-tick assignment (T10 port, incremental)', () => {
    it('assigns each event to the FIRST tick >= ts; later events wait', () => {
        const b = new BoundaryTracker();
        for (const ts of [10.0, 10.5, 59.0, 61.0]) { b.ingest('E4', ts); }
        const hits: Array<[number, boolean]> = [];
        for (const t of ticksFor(60)) {
            hits.push([t, b.flagsAt(t, false).includes('E4')]);
        }
        expect(hits.filter(([, f]) => f).map(([t]) => t)).toEqual([10, 20, 60]);
        // event at 61.0 stays buffered; a 7th tick would consume it:
        expect(b.flagsAt(70, false).includes('E4')).toBe(true);
    });
    it('consumes each event exactly once', () => {
        const b = new BoundaryTracker();
        b.ingest('N1', 15);
        expect(b.flagsAt(20, false)).toEqual(['N1']);
        expect(b.flagsAt(30, false)).toEqual([]);
    });
});

describe('stateEntryTimes (T8a/T8b port)', () => {
    const ticks = ticksFor(600);
    it('T8a: synthetic entry at t=490 when the state spans the warmup end', () => {
        const state = ticks.map(t => t >= 470 && t <= 530);
        const { entries, synthetic } = stateEntryTimes(ticks, state, 480);
        expect(entries).toEqual([490]);
        expect(synthetic).toEqual([true]);
    });
    it('T8b: regular entry after warmup without synthetic flag', () => {
        const state = ticks.map(t => t >= 490 && t <= 530);
        const { entries, synthetic } = stateEntryTimes(ticks, state, 480);
        expect(entries).toEqual([490]);
        expect(synthetic).toEqual([false]);
    });
});

describe('STATE boundary flag (T8c port)', () => {
    it('is pending only after warmup', () => {
        const b = new BoundaryTracker();
        // state active at both ticks; warmup 480
        expect(b.flagsAt(480, true)).toEqual([]);
        expect(b.flagsAt(490, true)).toEqual(['STATE']);
    });
    it('combines event boundaries with the TS-state STATE in priority order', () => {
        const b = new BoundaryTracker();
        b.ingest('FM', 485);
        b.ingest('N1', 486);
        expect(b.flagsAt(490, true)).toEqual(['FM', 'N1', 'STATE']);
    });
});
