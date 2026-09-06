import { describe, expect, it } from 'vitest';

import type { StaleConfig } from '@extension/services/struggleIntervention/slot/staleWatchdog';
import { StaleWatchdog } from '@extension/services/struggleIntervention/slot/staleWatchdog';

const cfg: StaleConfig = { idleAbandonMs: 6000 };

describe('StaleWatchdog (continuous-idle timeout)', () => {
    it('returns null while not armed', () => {
        const wd = new StaleWatchdog(cfg);
        expect(wd.tick(10_000)).toBeNull();
        expect(wd.isArmed()).toBe(false);
    });

    it('does not fire before idleAbandonMs has elapsed', () => {
        const wd = new StaleWatchdog(cfg);
        wd.arm(0, false);
        expect(wd.tick(5_999)).toBeNull();
    });

    it('force-frees a DELIVERED slot after continuous idle', () => {
        const wd = new StaleWatchdog(cfg);
        wd.arm(0, false /* delivered */);
        expect(wd.tick(6_000)).toEqual({ kind: 'force-free' });
    });

    it('free-silents a PARKED slot after continuous idle', () => {
        const wd = new StaleWatchdog(cfg);
        wd.arm(0, true /* parked */);
        expect(wd.tick(6_000)).toEqual({ kind: 'free-silent' });
    });

    it('resetProgress postpones the fire (idle is continuous, not cumulative)', () => {
        const wd = new StaleWatchdog(cfg);
        wd.arm(0, false);
        expect(wd.tick(5_000)).toBeNull();
        wd.resetProgress(5_000);            // activity at t=5s resets the idle clock
        expect(wd.tick(10_000)).toBeNull(); // only 5s of idle since the reset
        expect(wd.tick(11_000)).toEqual({ kind: 'force-free' }); // 6s after the reset
    });

    it('re-arms the clock on a fire and stops firing after disarm', () => {
        const wd = new StaleWatchdog(cfg);
        wd.arm(0, false);
        expect(wd.tick(6_000)).toEqual({ kind: 'force-free' });
        expect(wd.tick(6_001)).toBeNull(); // clock re-armed at 6000
        wd.disarm();
        expect(wd.tick(20_000)).toBeNull();
    });

    it('exposes the next silent-free deadline while armed', () => {
        const wd = new StaleWatchdog(cfg);
        expect(wd.staleDeadlineMs()).toBeNull();
        wd.arm(1_000, false);
        expect(wd.staleDeadlineMs()).toBe(7_000);
    });

    it('fires pre-abandon-warn once, 60s before force-free, and pins the window to 60s', () => {
        const wd = new StaleWatchdog({ idleAbandonMs: 600_000, warnLeadMs: 60_000 });
        wd.arm(0, false /* delivered */);
        expect(wd.tick(539_000)).toBeNull();
        expect(wd.tick(540_000)).toEqual({ kind: 'pre-abandon-warn' });
        expect(wd.tick(560_000)).toBeNull();
        expect(wd.tick(600_000)).toEqual({ kind: 'force-free' });
    });
});
