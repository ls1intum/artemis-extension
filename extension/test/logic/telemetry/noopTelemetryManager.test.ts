import { describe, expect, it, vi } from 'vitest';

import { NoopTelemetryManager } from '@extension/telemetry/noopTelemetryManager';

describe('NoopTelemetryManager', () => {
    it('reports a non-struggling, zero context', () => {
        const m = new NoopTelemetryManager();
        expect(m.getStruggleContext()).toEqual({
            isStruggling: false,
            eq: 0,
            eqConfidence: 'insufficient',
            recommendedAction: 'none',
        });
    });

    it('reports an empty EQ engine state', () => {
        const m = new NoopTelemetryManager();
        expect(m.getEqEngineState()).toEqual({
            snapshots: [],
            currentEQ: 0,
            pairCount: 0,
            confidence: 'insufficient',
        });
    });

    it('never fires events and its subscriptions are disposable', () => {
        const m = new NoopTelemetryManager();
        const listener = vi.fn();
        const sub = m.onDidCalculateEQ(listener);
        const sub2 = m.onDidShowIntervention(listener);
        expect(listener).not.toHaveBeenCalled();
        expect(() => { sub.dispose(); sub2.dispose(); }).not.toThrow();
    });

    it('no-op methods do not throw and isEnabled is false', async () => {
        const m = new NoopTelemetryManager();
        expect(m.isEnabled()).toBe(false);
        expect(() => m.startExerciseSession(1)).not.toThrow();
        await expect(m.showStruggleScoreDialog()).resolves.toBeUndefined();
        expect(() => m.dispose()).not.toThrow();
    });
});
