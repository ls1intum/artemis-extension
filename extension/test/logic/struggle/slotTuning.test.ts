import { describe, expect, it } from 'vitest';

import { TUNING } from '@extension/services/struggle/config';

describe('TUNING.slot knobs', () => {
    it('exposes all expected slot knob keys', () => {
        const { slot } = TUNING;
        expect(slot).toBeDefined();
        expect(typeof slot.idleAbandonMs).toBe('number');
        expect(typeof slot.reArmSBase).toBe('number');
        expect(typeof slot.reArmHoldMs).toBe('number');
    });

    it('matches the provisional default values', () => {
        expect(TUNING.slot).toMatchObject({
            idleAbandonMs: 360_000,
            reArmSBase: 0.6,
            reArmHoldMs: 30_000,
        });
    });
});
