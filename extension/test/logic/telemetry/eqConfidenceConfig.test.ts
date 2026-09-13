import { describe, expect, it } from 'vitest';

import { ErrorQuotientEngine } from '@extension/services/telemetry/metrics/errorQuotientEngine';
import { DEFAULT_EQ_CONFIG, type ErrorSnapshot } from '@extension/services/telemetry/types';

function snap(timestamp: number): ErrorSnapshot {
    return { timestamp, hasErrors: true, errorFamilies: new Set(['ts:2304']), errorCount: 1 };
}

describe('EQ confidence honors MIN_EVENTS_PER_SESSION', () => {
    it('uses the configured minimum instead of a hardcoded 6 pairs', () => {
        const engine = new ErrorQuotientEngine({ ...DEFAULT_EQ_CONFIG, MIN_EVENTS_PER_SESSION: 3 });
        engine.seedSnapshots([snap(0), snap(1), snap(2)]); // 2 pairs >= (3 - 1)
        expect(engine.getCurrentEQ().confidence).toBe('sufficient');
    });

    it('keeps the paper default: 5 pairs insufficient, 6 pairs sufficient', () => {
        const engine = new ErrorQuotientEngine(); // default MIN_EVENTS_PER_SESSION = 7
        engine.seedSnapshots(Array.from({ length: 6 }, (_, i) => snap(i))); // 5 pairs
        expect(engine.getCurrentEQ().confidence).toBe('insufficient');
        engine.seedSnapshots(Array.from({ length: 7 }, (_, i) => snap(i))); // 6 pairs
        expect(engine.getCurrentEQ().confidence).toBe('sufficient');
    });
});
