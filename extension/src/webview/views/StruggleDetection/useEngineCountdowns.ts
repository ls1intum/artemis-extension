import { useEffect, useRef, useState } from 'react';

import type { StruggleDebugSnapshot } from '@shared/messageContracts';

/**
 * Engine clock, offset-corrected and advanced once per second. The snapshot arrives only every
 * ~10 s (one per engine tick), so we re-anchor on each fresh `nowMs` and interpolate with the local
 * wall clock in between — yielding smooth per-second countdowns without drifting from engine time.
 */
export function useEngineNow(anchorNowMs: number): number {
    const baseRef = useRef({ engine: anchorNowMs, client: Date.now() });
    const [, setNonce] = useState(0);
    // Re-anchor whenever a fresh snapshot (new nowMs) arrives.
    useEffect(() => {
        baseRef.current = { engine: anchorNowMs, client: Date.now() };
        setNonce((n) => n + 1);
    }, [anchorNowMs]);
    // Advance once per second so the countdowns tick between snapshots.
    useEffect(() => {
        const id = window.setInterval(() => setNonce((n) => n + 1), 1000);
        return () => window.clearInterval(id);
    }, []);
    return baseRef.current.engine + (Date.now() - baseRef.current.client);
}

/** Seconds → "M:SS"; `ceil` for remaining times (stays at 1 until truly elapsed), floor for elapsed. */
export function mmss(totalSeconds: number, mode: 'ceil' | 'floor' = 'ceil'): string {
    const s = Math.max(0, mode === 'ceil' ? Math.ceil(totalSeconds) : Math.floor(totalSeconds));
    const m = Math.floor(s / 60);
    return `${m}:${(s % 60).toString().padStart(2, '0')}`;
}

export interface EngineCountdowns {
    /** Offset-corrected engine "now" (ms), advancing once per second. */
    now: number;
    /** Seconds since session start. */
    elapsedS: number;
    /** Warm-up seconds remaining (0 once elapsed). */
    warmupLeft: number;
    /** Cooldown seconds remaining, or null if no alert has fired. */
    cooldownLeft: number | null;
    /** Post-build grace seconds remaining, or null if no bad build armed it. */
    graceLeft: number | null;
    /** Min-gap seconds remaining before the next delivery, or null if nothing delivered yet. */
    minGapLeft: number | null;
}

/**
 * Derive every live "remaining" countdown from the {@link StruggleDebugSnapshot}'s absolute ms
 * anchors against a per-second interpolated clock. Shared by the timers panel and the
 * decision-flow pipeline (the blocking gate's remaining time) so the math lives in one place.
 */
export function useEngineCountdowns(debug: StruggleDebugSnapshot): EngineCountdowns {
    const now = useEngineNow(debug.nowMs);
    const { caps, throttle } = debug;

    const elapsedS = (now - debug.sessionStartMs) / 1000;
    const warmupLeft = Math.max(0, caps.warmupS - elapsedS);
    const cooldownLeft = debug.lastAlertMs === null ? null : Math.max(0, caps.cooldownS - (now - debug.lastAlertMs) / 1000);
    const graceLeft = debug.lastFmBadMs === null ? null : Math.max(0, caps.graceS - (now - debug.lastFmBadMs) / 1000);
    const minGapLeft = !throttle || throttle.lastDeliveryMs === null
        ? null
        : Math.max(0, throttle.minDeliveryGapS - (now - throttle.lastDeliveryMs) / 1000);

    return { now, elapsedS, warmupLeft, cooldownLeft, graceLeft, minGapLeft };
}
