import { describe, expect, it } from 'vitest';

import { TUNING } from '@extension/services/struggle/config';

describe('TUNING.slot knobs', () => {
    it('exposes all expected slot knob keys', () => {
        const { slot } = TUNING;
        expect(slot).toBeDefined();
        expect(typeof slot.staleAfterMs).toBe('number');
        expect(typeof slot.staleWindowMax).toBe('number');
        expect(typeof slot.staleAskCap).toBe('number');
        expect(typeof slot.abandonInitialMs).toBe('number');
        expect(typeof slot.abandonFreeTextMs).toBe('number');
        expect(typeof slot.abandonCeilingMs).toBe('number');
        expect(typeof slot.reArmSBase).toBe('number');
        expect(typeof slot.reArmHoldMs).toBe('number');
    });

    it('satisfies the abandon-window ordering invariant: abandonFreeTextMs < abandonInitialMs < abandonCeilingMs', () => {
        const { slot } = TUNING;
        expect(slot.abandonFreeTextMs).toBeLessThan(slot.abandonInitialMs);
        expect(slot.abandonInitialMs).toBeLessThan(slot.abandonCeilingMs);
    });

    it('matches the provisional default values', () => {
        expect(TUNING.slot).toMatchObject({
            staleAfterMs: 90_000,
            staleWindowMax: 4,
            staleAskCap: 2,
            abandonInitialMs: 60_000,
            abandonFreeTextMs: 30_000,
            abandonCeilingMs: 300_000,
            reArmSBase: 0.6,
            reArmHoldMs: 30_000,
        });
    });
});
