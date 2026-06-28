import { describe, expect, it } from 'vitest';

import type { AlertSink } from '@extension/services/struggle/alerting/alertSink';
import { type ThrottleConfig, ThrottledAlertSink } from '@extension/services/struggle/alerting/throttledAlertSink';
import type { AlertRecord } from '@extension/services/struggle/types';

function mkAlert(t: number): AlertRecord {
    return {
        kind: 'edit', t, ts: t * 1000, urgency: 0.8, v: 0.9,
        typesPreGate: ['STATE'], types: ['STATE'], primary: 'STATE',
        path: 'armed', inWarmup: false, inGrace: false,
    };
}

function spy() {
    const delivered: AlertRecord[] = [];
    const calls = { reset: 0, resetSession: 0 };
    const sink: AlertSink = {
        deliver: a => delivered.push(a),
        reset: () => { calls.reset++; },
        resetSession: () => { calls.resetSession++; },
    };
    return { sink, delivered, calls };
}

/** A throttle over a mutable fake clock; `at(ms)` sets the clock before delivering. */
function make(cfg: ThrottleConfig) {
    const inner = spy();
    let nowMs = 0;
    const sink = new ThrottledAlertSink(inner.sink, cfg, () => nowMs);
    return {
        inner,
        deliverAt(ms: number, t = ms / 1000) { nowMs = ms; sink.deliver(mkAlert(t)); },
        reset() { sink.reset(); },
        resetSession() { sink.resetSession(); },
        state() { return sink.getThrottleState(); },
    };
}

const LOOSE = { maxAlertsPerMinute: 100, maxAlertsPerSession: 100, minDeliveryGapS: 0 };

describe('ThrottledAlertSink', () => {
    it('forwards a delivered alert to the inner sink', () => {
        const h = make(LOOSE);
        h.deliverAt(0);
        expect(h.inner.delivered).toHaveLength(1);
    });

    it('enforces the per-session cap (delivered count)', () => {
        const h = make({ ...LOOSE, maxAlertsPerSession: 3 });
        for (let i = 0; i < 5; i++) { h.deliverAt(i * 1000); }
        expect(h.inner.delivered).toHaveLength(3);
    });

    it('enforces minDeliveryGapS between deliveries', () => {
        const h = make({ ...LOOSE, minDeliveryGapS: 10 });
        h.deliverAt(0);            // ok
        h.deliverAt(5_000);        // gap 5s < 10s -> dropped
        h.deliverAt(10_000);       // gap 10s -> ok
        expect(h.inner.delivered.map(a => a.t)).toEqual([0, 10]);
    });

    it('enforces the rolling per-minute cap', () => {
        const h = make({ ...LOOSE, maxAlertsPerMinute: 2 });
        h.deliverAt(0);            // 1 in window -> ok
        h.deliverAt(1_000);        // 2 in window -> ok
        h.deliverAt(2_000);        // 3rd within 60s -> dropped
        h.deliverAt(70_000);       // window slid past 0 and 1 -> ok
        expect(h.inner.delivered.map(a => a.t)).toEqual([0, 1, 70]);
    });

    it('reset() clears the inner UI but KEEPS the per-session budget', () => {
        const h = make({ ...LOOSE, maxAlertsPerSession: 1 });
        h.deliverAt(0);            // count -> 1
        h.reset();                 // UI clear only
        h.deliverAt(10_000);       // still at the cap -> dropped
        expect(h.inner.delivered).toHaveLength(1);
        expect(h.inner.calls.reset).toBe(1);
    });

    it('resetSession() clears the budget and forwards to the inner sink', () => {
        const h = make({ ...LOOSE, maxAlertsPerSession: 1 });
        h.deliverAt(0);            // count -> 1
        h.resetSession();          // budget cleared
        h.deliverAt(10_000);       // allowed again
        expect(h.inner.delivered).toHaveLength(2);
        expect(h.inner.calls.resetSession).toBe(1);
    });

    describe('getThrottleState (dev debug snapshot)', () => {
        it('reports zero state before any delivery', () => {
            const h = make(LOOSE);
            expect(h.state()).toEqual({ deliveredThisSession: 0, deliveredAtMs: [], lastDeliveryMs: null });
        });

        it('tracks delivered count + timestamps + last delivery after deliveries', () => {
            const h = make(LOOSE);
            h.deliverAt(0);
            h.deliverAt(5_000);
            expect(h.state()).toEqual({ deliveredThisSession: 2, deliveredAtMs: [0, 5_000], lastDeliveryMs: 5_000 });
        });

        it('does NOT count alerts the throttle dropped', () => {
            const h = make({ ...LOOSE, minDeliveryGapS: 10 });
            h.deliverAt(0);            // delivered
            h.deliverAt(5_000);        // dropped (gap < 10s)
            const s = h.state();
            expect(s.deliveredThisSession).toBe(1);
            expect(s.deliveredAtMs).toEqual([0]);
        });

        it('clears on resetSession but is preserved across reset', () => {
            const h = make(LOOSE);
            h.deliverAt(0);
            h.reset();
            expect(h.state().deliveredThisSession).toBe(1);   // budget kept
            h.resetSession();
            expect(h.state()).toEqual({ deliveredThisSession: 0, deliveredAtMs: [], lastDeliveryMs: null });
        });

        it('returns a COPY of the timestamp array (consumer cannot mutate the window)', () => {
            const h = make(LOOSE);
            h.deliverAt(0);
            h.state().deliveredAtMs.push(999_999);
            expect(h.state().deliveredAtMs).toEqual([0]);
        });
    });
});
