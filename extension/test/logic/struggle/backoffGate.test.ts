import { describe, expect, it, vi } from 'vitest';

import { BackoffGate } from '@extension/services/struggle/alerting/backoffGate';

const alert = { kind: 'edit' } as any;

/** A passthrough backoff source (nothing suppressed/paused/skipped) with overridable hooks. */
function source(over: Partial<{ shouldSuppress: () => boolean; isPaused: () => boolean; tryConsumeSoftSkip: () => boolean }> = {}) {
    return { shouldSuppress: () => false, isPaused: () => false, tryConsumeSoftSkip: () => false, ...over };
}

describe('BackoffGate', () => {
    it('drops a suppressed alert above the throttle WITHOUT consulting backoff (no inner.deliver)', () => {
        const inner = { deliver: vi.fn() };
        const isPaused = vi.fn(() => false);
        const tryConsumeSoftSkip = vi.fn(() => false);
        const gate = new BackoffGate(inner as any, source({ shouldSuppress: () => true, isPaused, tryConsumeSoftSkip }));
        gate.deliver(alert);
        expect(inner.deliver).not.toHaveBeenCalled();
        // Suppression short-circuits before backoff so a non-edit/opted-out alert cannot burn a soft skip either.
        expect(isPaused).not.toHaveBeenCalled();
        expect(tryConsumeSoftSkip).not.toHaveBeenCalled();
    });
    it('drops the alert (no inner.deliver) when paused', () => {
        const inner = { deliver: vi.fn() };
        const gate = new BackoffGate(inner as any, source({ isPaused: () => true }));
        gate.deliver(alert);
        expect(inner.deliver).not.toHaveBeenCalled();
    });
    it('consumes a soft skip instead of delivering', () => {
        const inner = { deliver: vi.fn() };
        const consume = vi.fn().mockReturnValueOnce(true).mockReturnValue(false);
        const gate = new BackoffGate(inner as any, source({ tryConsumeSoftSkip: consume }));
        gate.deliver(alert);                       // skip consumed
        expect(inner.deliver).not.toHaveBeenCalled();
        gate.deliver(alert);                       // none left -> delivers
        expect(inner.deliver).toHaveBeenCalledTimes(1);
    });
    it('delegates reset/resetSession to the inner sink', () => {
        const inner = { deliver: vi.fn(), reset: vi.fn(), resetSession: vi.fn() };
        const gate = new BackoffGate(inner as any, source());
        gate.reset(); gate.resetSession();
        expect(inner.reset).toHaveBeenCalled();
        expect(inner.resetSession).toHaveBeenCalled();
    });
    it('forwards getThrottleState to the inner throttle (the throttle sits below this gate)', () => {
        const state = { deliveredThisSession: 2, deliveredAtMs: [1, 2], lastDeliveryMs: 2 };
        const inner = { deliver: vi.fn(), getThrottleState: vi.fn().mockReturnValue(state) };
        const gate = new BackoffGate(inner as any, source());
        expect(gate.getThrottleState()).toBe(state);
        expect(inner.getThrottleState).toHaveBeenCalledTimes(1);
    });
    it('returns undefined when the inner sink does not expose a throttle state', () => {
        const inner = { deliver: vi.fn() };
        const gate = new BackoffGate(inner as any, source());
        expect(gate.getThrottleState()).toBeUndefined();
    });
});
