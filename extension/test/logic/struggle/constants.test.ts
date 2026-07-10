import { describe, expect, it } from 'vitest';

import { BOUNDARY_PRIORITY, SPEC } from '@extension/services/struggle/config';

describe('frozen Engine-v3 constants (2-feature substrate; derived_params.json)', () => {
    it('matches the frozen parameter set exactly', () => {
        expect(SPEC).toMatchObject({
            TICK_S: 10, WINDOW_S: 60, MIN_EFFECTIVE_WINDOW_S: 10,
            TYPING_ANCHOR_PER_MIN: 20, GAP_NORM_S: 40,
            TS_TYPING_THRESH_PER_MIN: 5,
            WARMUP_S: 480, B2_TYPING_PER_MIN: 20,
            COOLDOWN_S: 120, HYSTERESIS: 0.1, REALERT_S: 120,
            GRACE_S: 32.94, THETA_FULL: 0.7,
        });
        expect([...SPEC.FM_DELTAS_BAD]).toEqual(['worse', 'same-count', 'identical-set']);
        expect([...BOUNDARY_PRIORITY]).toEqual(['FM', 'FM_PLUS', 'E4', 'N1', 'STATE']);
        expect('N4_RATIO_THRESH' in SPEC).toBe(false);   // v3: scroll/N4 feature dropped
        expect('HL_DEFAULT_S' in SPEC).toBe(false);      // V(t) peak-hold telemetry removed
    });
});
