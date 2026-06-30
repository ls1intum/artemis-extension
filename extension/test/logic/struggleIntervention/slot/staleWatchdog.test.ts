import { describe, expect, it } from 'vitest';

import { StaleWatchdog } from '@extension/services/struggleIntervention/slot/staleWatchdog';
import type { StaleConfig } from '@extension/services/struggleIntervention/slot/staleWatchdog';

const BASE_CFG: StaleConfig = { staleAfterMs: 10_000, staleWindowMax: 3, staleAskCap: 2 };

describe('StaleWatchdog', () => {
    // -----------------------------------------------------------------------
    // Initial state
    // -----------------------------------------------------------------------

    describe('initial state', () => {
        it('tick returns null before arm', () => {
            const w = new StaleWatchdog(BASE_CFG);
            expect(w.tick(99_999)).toBeNull();
        });

        it('windowCount starts at 0', () => {
            const w = new StaleWatchdog(BASE_CFG);
            expect(w.windowCount()).toBe(0);
        });

        it('canPostAsk is true before any onAskPosted', () => {
            const w = new StaleWatchdog(BASE_CFG);
            expect(w.canPostAsk()).toBe(true);
        });
    });

    // -----------------------------------------------------------------------
    // DELIVERED slot (parked=false)
    // -----------------------------------------------------------------------

    describe('DELIVERED slot (parked=false)', () => {
        it('tick returns null before staleAfterMs elapses', () => {
            const w = new StaleWatchdog(BASE_CFG);
            w.arm(0, false);
            expect(w.tick(9_999)).toBeNull();
        });

        it('tick returns fire-stale-check on first fire', () => {
            const w = new StaleWatchdog(BASE_CFG);
            w.arm(0, false);
            expect(w.tick(10_000)).toEqual({ kind: 'fire-stale-check' });
        });

        it('windowCount increments to 1 on first fire', () => {
            const w = new StaleWatchdog(BASE_CFG);
            w.arm(0, false);
            w.tick(10_000);
            expect(w.windowCount()).toBe(1);
        });

        it('clock re-arms after a fire (tick returns null right after)', () => {
            const w = new StaleWatchdog(BASE_CFG);
            w.arm(0, false);
            w.tick(10_000);
            expect(w.tick(10_001)).toBeNull();
        });

        it('second fire arrives staleAfterMs after the first', () => {
            const w = new StaleWatchdog(BASE_CFG);
            w.arm(0, false);
            w.tick(10_000);
            expect(w.tick(20_000)).toEqual({ kind: 'fire-stale-check' });
            expect(w.windowCount()).toBe(2);
        });

        it('windowCount increments on every fire -- wire-independent, no POST involved', () => {
            const w = new StaleWatchdog(BASE_CFG);
            w.arm(0, false);
            // No onAskPosted, no staleCheck -- just tick fires
            w.tick(10_000);
            expect(w.windowCount()).toBe(1);
            w.tick(20_000);
            expect(w.windowCount()).toBe(2);
        });

        it('returns force-free when staleWindowMax fires reached regardless of any staleCheck', () => {
            const w = new StaleWatchdog(BASE_CFG); // max=3
            w.arm(0, false);
            expect(w.tick(10_000)).toEqual({ kind: 'fire-stale-check' }); // window=1
            expect(w.tick(20_000)).toEqual({ kind: 'fire-stale-check' }); // window=2
            expect(w.tick(30_000)).toEqual({ kind: 'force-free' });        // window=3 == max
            expect(w.windowCount()).toBe(3);
        });

        it('force-free is purely window-count-based -- no onAskPosted needed', () => {
            const cfg: StaleConfig = { staleAfterMs: 10_000, staleWindowMax: 2, staleAskCap: 2 };
            const w = new StaleWatchdog(cfg);
            w.arm(0, false);
            w.tick(10_000); // window=1
            expect(w.tick(20_000)).toEqual({ kind: 'force-free' }); // window=2 == max
        });
    });

    // -----------------------------------------------------------------------
    // resetProgress
    // -----------------------------------------------------------------------

    describe('resetProgress', () => {
        it('defers the next fire past the original deadline', () => {
            const w = new StaleWatchdog(BASE_CFG);
            w.arm(0, false);
            w.resetProgress(5_000); // progress at 5s defers window to 15s
            expect(w.tick(10_000)).toBeNull(); // would have fired without the reset
            expect(w.tick(14_999)).toBeNull(); // still not due
            expect(w.tick(15_000)).toEqual({ kind: 'fire-stale-check' }); // now due
        });

        it('counters are not reset by resetProgress', () => {
            const w = new StaleWatchdog(BASE_CFG);
            w.arm(0, false);
            w.tick(10_000); // window=1
            w.resetProgress(10_000);
            expect(w.windowCount()).toBe(1); // unchanged
        });
    });

    // -----------------------------------------------------------------------
    // Ask cap (staleAskCount / canPostAsk)
    // -----------------------------------------------------------------------

    describe('ask cap', () => {
        it('onAskPosted increments staleAskCount; canPostAsk tracks the cap', () => {
            const w = new StaleWatchdog(BASE_CFG); // cap=2
            expect(w.canPostAsk()).toBe(true);
            w.onAskPosted(); // count=1
            expect(w.canPostAsk()).toBe(true);
            w.onAskPosted(); // count=2 == cap
            expect(w.canPostAsk()).toBe(false);
        });

        it('later fires still increment windowCount when canPostAsk is false', () => {
            const cfg: StaleConfig = { staleAfterMs: 10_000, staleWindowMax: 5, staleAskCap: 1 };
            const w = new StaleWatchdog(cfg);
            w.arm(0, false);
            w.onAskPosted(); // cap exhausted
            expect(w.canPostAsk()).toBe(false);
            w.tick(10_000); // window=1
            expect(w.windowCount()).toBe(1);
            w.tick(20_000); // window=2
            expect(w.windowCount()).toBe(2);
        });

        it('tick still returns fire-stale-check when canPostAsk is false (orchestrator decides POST)', () => {
            const cfg: StaleConfig = { staleAfterMs: 10_000, staleWindowMax: 5, staleAskCap: 0 };
            const w = new StaleWatchdog(cfg);
            w.arm(0, false);
            expect(w.canPostAsk()).toBe(false);
            expect(w.tick(10_000)).toEqual({ kind: 'fire-stale-check' }); // tick is unaffected
        });
    });

    // -----------------------------------------------------------------------
    // PARKED slot (parked=true)
    // -----------------------------------------------------------------------

    describe('PARKED slot (parked=true)', () => {
        it('tick returns null before staleAfterMs elapses', () => {
            const w = new StaleWatchdog(BASE_CFG);
            w.arm(0, true);
            expect(w.tick(9_999)).toBeNull();
        });

        it('tick fire returns free-silent', () => {
            const w = new StaleWatchdog(BASE_CFG);
            w.arm(0, true);
            expect(w.tick(10_000)).toEqual({ kind: 'free-silent' });
        });

        it('PARKED fire does NOT increment windowCount', () => {
            const w = new StaleWatchdog(BASE_CFG);
            w.arm(0, true);
            w.tick(10_000);
            expect(w.windowCount()).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // disarm
    // -----------------------------------------------------------------------

    describe('disarm', () => {
        it('disarm stops tick from firing', () => {
            const w = new StaleWatchdog(BASE_CFG);
            w.arm(0, false);
            w.disarm();
            expect(w.tick(10_000)).toBeNull();
        });

        it('disarm after a fire stops further fires', () => {
            const w = new StaleWatchdog(BASE_CFG);
            w.arm(0, false);
            w.tick(10_000);
            w.disarm();
            expect(w.tick(20_000)).toBeNull();
        });
    });

    // -----------------------------------------------------------------------
    // §13 termination bound -- the load-bearing wire-independent invariant
    // -----------------------------------------------------------------------

    describe('§13 termination bound', () => {
        it('force-free fires at staleWindowMax with no POST/onAskPosted ever called', () => {
            const w = new StaleWatchdog(BASE_CFG); // max=3
            w.arm(0, false);
            // Simulate a perpetually busy wire: orchestrator never posts anything
            expect(w.tick(10_000)).toEqual({ kind: 'fire-stale-check' }); // window=1
            expect(w.tick(20_000)).toEqual({ kind: 'fire-stale-check' }); // window=2
            expect(w.tick(30_000)).toEqual({ kind: 'force-free' });        // window=3 -> terminated
            expect(w.windowCount()).toBe(3);
        });

        it('canPostAsk=false cannot delay force-free (busy wire has no effect on the bound)', () => {
            const cfg: StaleConfig = { staleAfterMs: 10_000, staleWindowMax: 2, staleAskCap: 0 };
            const w = new StaleWatchdog(cfg);
            w.arm(0, false);
            expect(w.canPostAsk()).toBe(false); // wire always "busy"
            w.tick(10_000); // window=1
            expect(w.tick(20_000)).toEqual({ kind: 'force-free' }); // window=2 == max
        });

        it('staleWindowCount increments independently of staleAskCount', () => {
            const cfg: StaleConfig = { staleAfterMs: 10_000, staleWindowMax: 4, staleAskCap: 2 };
            const w = new StaleWatchdog(cfg);
            w.arm(0, false);
            w.tick(10_000); // window=1
            w.onAskPosted();
            w.tick(20_000); // window=2
            w.onAskPosted(); // cap exhausted
            w.tick(30_000); // window=3, no ask
            w.tick(40_000); // window=4 -> force-free
            expect(w.windowCount()).toBe(4);
        });
    });
});
