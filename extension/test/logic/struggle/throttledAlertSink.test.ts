import { describe, expect, it } from 'vitest';

import type { AlertSink } from '@extension/services/struggle/alerting/alertSink';
import { type ThrottleConfig, ThrottledAlertSink } from '@extension/services/struggle/alerting/throttledAlertSink';
import { THROTTLE_BY_LEVEL } from '@extension/services/struggle/config';
import type { AlertRecord } from '@extension/services/struggle/types';

function mkAlert(t: number): AlertRecord {
    return {
        kind: 'edit', t, ts: t * 1000, urgency: 0.8,
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

/** A throttle over a mutable fake clock; `at(ms)` sets the clock before delivering.
 *  Accepts either a fixed config or a live getter, so a single helper covers both the
 *  static-config tests and the mid-session-flip test. */
function make(cfg: ThrottleConfig | (() => ThrottleConfig)) {
    const inner = spy();
    let nowMs = 0;
    const getConfig = typeof cfg === 'function' ? cfg : () => cfg;
    const sink = new ThrottledAlertSink(inner.sink, getConfig, () => nowMs);
    return {
        inner,
        deliverAt(ms: number, t = ms / 1000) { nowMs = ms; sink.deliver(mkAlert(t)); },
        reset() { sink.reset(); },
        resetSession() { sink.resetSession(); },
        state() { return sink.getThrottleState(); },
    };
}

const LOOSE = { maxAlertsPerSession: 100, minDeliveryGapS: 0 };

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

    describe('per-level config (THROTTLE_BY_LEVEL)', () => {
        it('less enforces 3/session and a 300s gap', () => {
            const h = make(THROTTLE_BY_LEVEL.less);
            h.deliverAt(0);
            h.deliverAt(299_000);       // gap 299s < 300s -> dropped
            h.deliverAt(300_000);       // gap 300s -> ok
            h.deliverAt(600_000);       // ok
            h.deliverAt(900_000);       // 4th delivery would exceed the 3/session cap -> dropped
            expect(h.inner.delivered.map(a => a.t)).toEqual([0, 300, 600]);
        });

        it('more enforces 6/session and a 150s gap', () => {
            const h = make(THROTTLE_BY_LEVEL.more);
            const deliveredTimes: number[] = [];
            for (let i = 0; i < 8; i++) {
                const ms = i * 150_000;
                h.deliverAt(ms);
                if (h.inner.delivered.length > deliveredTimes.length) { deliveredTimes.push(ms / 1000); }
            }
            expect(deliveredTimes).toEqual([0, 150, 300, 450, 600, 750]);   // capped at 6
            expect(h.inner.delivered).toHaveLength(6);
        });

        it('flipping the getter mid-session switches enforcement WHILE budget/history are preserved', () => {
            let level: 'less' | 'more' = 'more';
            const h = make(() => THROTTLE_BY_LEVEL[level]);
            h.deliverAt(0);              // more: gap 150s -> delivered #1
            h.deliverAt(150_000);        // more: gap 150s -> delivered #2
            expect(h.inner.delivered).toHaveLength(2);

            level = 'less';              // mid-session flip: now needs a 300s gap, 3/session cap
            h.deliverAt(300_000);        // gap since last delivery (150_000) is only 150s < 300s -> dropped
            expect(h.inner.delivered).toHaveLength(2);   // budget/history preserved, NOT reset by the flip
            h.deliverAt(450_000);        // gap since last DELIVERED (150_000) is 300s -> ok, 3rd delivery
            expect(h.inner.delivered).toHaveLength(3);
            h.deliverAt(750_000);        // would be a 4th delivery -> exceeds less's 3/session cap -> dropped
            expect(h.inner.delivered).toHaveLength(3);

            level = 'more';              // flip back: budget stays at 3 (more's cap is 6, still room)
            h.deliverAt(900_000);        // gap since last delivered (450_000) is 450s >= more's 150s -> ok
            expect(h.inner.delivered).toHaveLength(4);
        });
    });

    describe('getThrottleState (dev debug snapshot)', () => {
        it('reports zero state + the active caps before any delivery', () => {
            const h = make(LOOSE);
            expect(h.state()).toEqual({
                deliveredThisSession: 0, deliveredAtMs: [], lastDeliveryMs: null,
                maxAlertsPerSession: LOOSE.maxAlertsPerSession, minDeliveryGapS: LOOSE.minDeliveryGapS,
            });
        });

        it('tracks delivered count + timestamps + last delivery after deliveries', () => {
            const h = make(LOOSE);
            h.deliverAt(0);
            h.deliverAt(5_000);
            expect(h.state()).toEqual({
                deliveredThisSession: 2, deliveredAtMs: [0, 5_000], lastDeliveryMs: 5_000,
                maxAlertsPerSession: LOOSE.maxAlertsPerSession, minDeliveryGapS: LOOSE.minDeliveryGapS,
            });
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
            expect(h.state().deliveredThisSession).toBe(0);
            expect(h.state().deliveredAtMs).toEqual([]);
            expect(h.state().lastDeliveryMs).toBeNull();
        });

        it('returns a COPY of the timestamp array (consumer cannot mutate the window)', () => {
            const h = make(LOOSE);
            h.deliverAt(0);
            h.state().deliveredAtMs.push(999_999);
            expect(h.state().deliveredAtMs).toEqual([0]);
        });

        it('reflects the CURRENT active caps live (reads the getter each call, not a captured snapshot)', () => {
            let level: 'less' | 'more' = 'more';
            const h = make(() => THROTTLE_BY_LEVEL[level]);
            expect(h.state().maxAlertsPerSession).toBe(6);
            expect(h.state().minDeliveryGapS).toBe(150);
            level = 'less';
            expect(h.state().maxAlertsPerSession).toBe(3);
            expect(h.state().minDeliveryGapS).toBe(300);
        });
    });
});
