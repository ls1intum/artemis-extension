import { describe, expect, it, vi } from 'vitest';

import { BackoffGate } from '@extension/services/struggle/alerting/backoffGate';

const alert = { kind: 'edit' } as any;

/** A passthrough suppression source (nothing suppressed) with an overridable predicate. */
function source(over: Partial<{ shouldSuppress: () => boolean }> = {}) {
    return { shouldSuppress: () => false, ...over };
}

describe('BackoffGate', () => {
    it('drops a suppressed alert above the throttle (no inner.deliver)', () => {
        const inner = { deliver: vi.fn() };
        const gate = new BackoffGate(inner as any, source({ shouldSuppress: () => true }));
        gate.deliver(alert);
        expect(inner.deliver).not.toHaveBeenCalled();
    });
    it('delivers a non-suppressed alert straight through to the inner sink', () => {
        const inner = { deliver: vi.fn() };
        const gate = new BackoffGate(inner as any, source());
        gate.deliver(alert);
        expect(inner.deliver).toHaveBeenCalledTimes(1);
        expect(inner.deliver).toHaveBeenCalledWith(alert);
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
