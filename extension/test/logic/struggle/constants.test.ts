import { describe, expect, it } from 'vitest';

import { BOUNDARY_PRIORITY, SPEC } from '@extension/services/struggle/constants';

describe('frozen Engine-v2 constants (derived_params.json v2_spec_constants)', () => {
    it('matches the frozen parameter set exactly', () => {
        expect(SPEC).toMatchObject({
            TICK_S: 10, WINDOW_S: 60, MIN_EFFECTIVE_WINDOW_S: 10,
            TYPING_ANCHOR_PER_MIN: 20, GAP_NORM_S: 40, N4_RATIO_THRESH: 10,
            TS_TYPING_THRESH_PER_MIN: 5, A8_WINDOW_S: 300, A8_MIN_CHANGES: 30,
            A8_SHARE: 0.8, N2_DIST_LINES: 3, N2_MIN_ACTIVE_S: 60,
            W_FB: 0.25, W_A8: 0.15, W_N2: 0.10,
            HL_DEFAULT_S: 120, HL_FAST_S: 30, FAST_DECAY_MAX_S: 120,
            WARMUP_S: 480, B2_TYPING_PER_MIN: 20,
            COOLDOWN_S: 120, HYSTERESIS: 0.1, REALERT_S: 120,
            GRACE_S: 32.94, THETA_FULL: 0.6,
        });
        expect([...SPEC.FM_DELTAS_BAD]).toEqual(['worse', 'same-count', 'identical-set']);
        expect([...BOUNDARY_PRIORITY]).toEqual(['FM', 'FM_PLUS', 'E4', 'N1', 'STATE']);
    });
});
