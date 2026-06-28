import { describe, expect, it, vi } from 'vitest';

import { BackoffGate } from '@extension/services/struggle/alerting/backoffGate';

const alert = { kind: 'edit' } as any;

describe('BackoffGate', () => {
    it('drops the alert (no inner.deliver) when paused', () => {
        const inner = { deliver: vi.fn() };
        const gate = new BackoffGate(inner as any, { isPaused: () => true, tryConsumeSoftSkip: () => false });
        gate.deliver(alert);
        expect(inner.deliver).not.toHaveBeenCalled();
    });
    it('consumes a soft skip instead of delivering', () => {
        const inner = { deliver: vi.fn() };
        const consume = vi.fn().mockReturnValueOnce(true).mockReturnValue(false);
        const gate = new BackoffGate(inner as any, { isPaused: () => false, tryConsumeSoftSkip: consume });
        gate.deliver(alert);                       // skip consumed
        expect(inner.deliver).not.toHaveBeenCalled();
        gate.deliver(alert);                       // none left -> delivers
        expect(inner.deliver).toHaveBeenCalledTimes(1);
    });
    it('delegates reset/resetSession to the inner sink', () => {
        const inner = { deliver: vi.fn(), reset: vi.fn(), resetSession: vi.fn() };
        const gate = new BackoffGate(inner as any, { isPaused: () => false, tryConsumeSoftSkip: () => false });
        gate.reset(); gate.resetSession();
        expect(inner.reset).toHaveBeenCalled();
        expect(inner.resetSession).toHaveBeenCalled();
    });
    it('forwards getThrottleState to the inner throttle (the throttle sits below this gate)', () => {
        const state = { deliveredThisSession: 2, deliveredAtMs: [1, 2], lastDeliveryMs: 2 };
        const inner = { deliver: vi.fn(), getThrottleState: vi.fn().mockReturnValue(state) };
        const gate = new BackoffGate(inner as any, { isPaused: () => false, tryConsumeSoftSkip: () => false });
        expect(gate.getThrottleState()).toBe(state);
        expect(inner.getThrottleState).toHaveBeenCalledTimes(1);
    });
    it('returns undefined when the inner sink does not expose a throttle state', () => {
        const inner = { deliver: vi.fn() };
        const gate = new BackoffGate(inner as any, { isPaused: () => false, tryConsumeSoftSkip: () => false });
        expect(gate.getThrottleState()).toBeUndefined();
    });
});
