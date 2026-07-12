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
        it('less enforces 5/session and a 600s gap', () => {
            const h = make(THROTTLE_BY_LEVEL.less);
            h.deliverAt(0);
            h.deliverAt(599_000);       // gap 599s < 600s -> dropped
            h.deliverAt(600_000);       // gap 600s -> ok
            h.deliverAt(1_200_000);     // ok
            h.deliverAt(1_800_000);     // ok
            h.deliverAt(2_400_000);     // ok (5th delivery, cap reached)
            h.deliverAt(3_000_000);     // 6th delivery would exceed the 5/session cap -> dropped
            expect(h.inner.delivered.map(a => a.t)).toEqual([0, 600, 1200, 1800, 2400]);
        });

        it('more enforces only the 10/session cap (no delivery gap of its own)', () => {
            const h = make(THROTTLE_BY_LEVEL.more);
            const deliveredTimes: number[] = [];
            for (let i = 0; i < 12; i++) {
                const ms = i * 10_000;  // dense stream: gap 0 never drops, only the cap does
                h.deliverAt(ms);
                if (h.inner.delivered.length > deliveredTimes.length) { deliveredTimes.push(ms / 1000); }
            }
            expect(deliveredTimes).toEqual([0, 10, 20, 30, 40, 50, 60, 70, 80, 90]);   // capped at 10
            expect(h.inner.delivered).toHaveLength(10);
        });

        it('flipping the getter mid-session switches enforcement WHILE budget/history are preserved', () => {
            let level: 'less' | 'more' = 'more';
            const h = make(() => THROTTLE_BY_LEVEL[level]);
            h.deliverAt(0);              // more: no gap -> delivered #1
            h.deliverAt(10_000);         // more: no gap -> delivered #2
            expect(h.inner.delivered).toHaveLength(2);

            level = 'less';              // mid-session flip: now needs a 600s gap, 5/session cap
            h.deliverAt(100_000);        // gap since last delivery (10_000) is only 90s < 600s -> dropped
            expect(h.inner.delivered).toHaveLength(2);   // budget/history preserved, NOT reset by the flip
            h.deliverAt(610_000);        // gap since last DELIVERED (10_000) is 600s -> ok, 3rd delivery
            expect(h.inner.delivered).toHaveLength(3);
            h.deliverAt(1_210_000);      // gap 600s -> 4th delivery
            h.deliverAt(1_810_000);      // gap 600s -> 5th delivery (less's cap reached)
            expect(h.inner.delivered).toHaveLength(5);
            h.deliverAt(2_410_000);      // would be a 6th delivery -> exceeds less's 5/session cap -> dropped
            expect(h.inner.delivered).toHaveLength(5);

            level = 'more';              // flip back: budget stays at 5 (more's cap is 10, still room)
            h.deliverAt(2_420_000);      // more has no gap -> ok
            expect(h.inner.delivered).toHaveLength(6);
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
            expect(h.state().maxAlertsPerSession).toBe(10);
            expect(h.state().minDeliveryGapS).toBe(0);
            level = 'less';
            expect(h.state().maxAlertsPerSession).toBe(5);
            expect(h.state().minDeliveryGapS).toBe(600);
        });
    });
});
