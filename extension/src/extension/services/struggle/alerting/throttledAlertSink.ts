// extension/src/extension/services/struggle/alerting/throttledAlertSink.ts
/**
 * Tier-2 delivery throttle (Engine v3 WS4). A decorator AlertSink that rate-limits
 * DELIVERY to an inner sink (the InterventionService UI). It sits strictly
 * downstream of the recorded/measured alert path (the recorder subscribes the
 * engine's onDidAlert directly), so the throttle can NEVER affect goldens, the
 * held-out F1, or research data — it only shapes how often the user sees a hint.
 *
 * Three independent, delivery-only guards (all from TUNING):
 *   - per-session cap   (maxAlertsPerSession) on DELIVERED alerts;
 *   - rolling per-minute cap (maxAlertsPerMinute) over the trailing 60 s;
 *   - a hard floor between deliveries (minDeliveryGapS).
 *
 * `minDeliveryGapS` is delivery-only and is DELIBERATELY independent of the SPEC
 * detector cooldown (a Schicht-3 decision guard) — they are different layers.
 *
 * reset() clears the inner UI but KEEPS the budget (a config-off toggle must not
 * refill the per-session cap); resetSession() resets the budget for a new
 * exercise session.
 */
import type { StruggleThrottleState } from '@shared/messageContracts';

import type { AlertRecord } from '@extension/services/struggle/types';

import type { AlertSink } from './alertSink';

export interface ThrottleConfig {
    readonly maxAlertsPerMinute: number;
    readonly maxAlertsPerSession: number;
    readonly minDeliveryGapS: number;
}

const ONE_MINUTE_MS = 60_000;

export class ThrottledAlertSink implements AlertSink {
    private readonly _inner: AlertSink;
    private readonly _now: () => number;
    private readonly _cfg: ThrottleConfig;
    private _deliveredThisSession = 0;
    /** Timestamps (ms) of DELIVERED alerts; length <= maxAlertsPerSession. */
    private _deliveredAtMs: number[] = [];

    constructor(inner: AlertSink, cfg: ThrottleConfig, now: () => number = () => Date.now()) {
        this._inner = inner;
        this._cfg = cfg;
        this._now = now;
    }

    deliver(alert: AlertRecord): void {
        const now = this._now();
        if (this._deliveredThisSession >= this._cfg.maxAlertsPerSession) {
            return;                                            // per-session cap
        }
        const last = this._deliveredAtMs.length > 0 ? this._deliveredAtMs[this._deliveredAtMs.length - 1] : null;
        if (last !== null && now - last < this._cfg.minDeliveryGapS * 1000) {
            return;                                            // min delivery gap
        }
        const inWindow = this._deliveredAtMs.filter(t => now - t < ONE_MINUTE_MS).length;
        if (inWindow >= this._cfg.maxAlertsPerMinute) {
            return;                                            // rolling per-minute cap
        }
        this._inner.deliver(alert);
        this._deliveredAtMs.push(now);
        this._deliveredThisSession++;
    }

    /** Snapshot of the live delivery-throttle state for the dev debug view (telemetry only,
     *  never feeds a decision). Returns a COPY of the timestamp array so the consumer cannot
     *  mutate the rolling window. */
    getThrottleState(): StruggleThrottleState {
        const n = this._deliveredAtMs.length;
        return {
            deliveredThisSession: this._deliveredThisSession,
            deliveredAtMs: [...this._deliveredAtMs],
            lastDeliveryMs: n > 0 ? this._deliveredAtMs[n - 1] : null,
        };
    }

    /** Clear the visible UI only — budget/rate history are preserved. */
    reset(): void {
        this._inner.reset?.();
    }

    /** New session: reset budget + rate history, then clear the inner sink. */
    resetSession(): void {
        this._deliveredThisSession = 0;
        this._deliveredAtMs = [];
        if (this._inner.resetSession) {
            this._inner.resetSession();
        } else {
            this._inner.reset?.();
        }
    }

    /** Forward the build-result signal straight through (not throttled). */
    onNewBuildResult(hasNewGreenTest: boolean): void {
        this._inner.onNewBuildResult?.(hasNewGreenTest);
    }
}
