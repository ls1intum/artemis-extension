import { useEffect, useRef, useState } from 'react';

import type { StruggleDebugSnapshot } from '@shared/messageContracts';

import { Badge, Container } from '@webview/components';

import styles from './TimersPanel.module.css';

interface TimersPanelProps {
    debug: StruggleDebugSnapshot;
}

/**
 * Engine clock, offset-corrected and advanced once per second. The snapshot arrives only every
 * ~10 s (one per engine tick), so we re-anchor on each fresh `nowMs` and interpolate with the local
 * wall clock in between — yielding smooth per-second countdowns without drifting from engine time.
 */
function useEngineNow(anchorNowMs: number): number {
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
function mmss(totalSeconds: number, mode: 'ceil' | 'floor' = 'ceil'): string {
    const s = Math.max(0, mode === 'ceil' ? Math.ceil(totalSeconds) : Math.floor(totalSeconds));
    const m = Math.floor(s / 60);
    return `${m}:${(s % 60).toString().padStart(2, '0')}`;
}

function Row({ label, title, children }: { label: string; title: string; children: React.ReactNode }) {
    return (
        <div className={styles.row}>
            <span className={styles.label} title={title}>{label}</span>
            {children}
        </div>
    );
}

/**
 * Developer-only timers/counters dashboard for the v3 struggle engine (spec: dev debug view).
 * Reads the latest {@link StruggleDebugSnapshot} (the SAME source the `[Struggle]` log uses) and
 * derives every "remaining" locally, so the readouts stay live between the 10 s engine ticks.
 *
 * Honest typing: some rows are true countdowns (have an ms anchor), some are counters (state), and
 * some are last-tick metrics (refreshed each tick, not a live timer). Grouped accordingly.
 */
export function TimersPanel({ debug }: TimersPanelProps) {
    const now = useEngineNow(debug.nowMs);
    const { caps, throttle } = debug;

    // No active exercise session: every anchor is stale/zero, so show a clear empty state rather than
    // counting a bogus warm-up from epoch (the struggle view can be opened outside an exercise).
    if (!debug.sessionActive) {
        return (
            <Container
                header={<div style={{ fontSize: '15px', fontWeight: 600 }}>Engine Timers &amp; Counters (developer)</div>}
                variant="default"
                padding="default"
            >
                <p className={styles.note}>
                    No active exercise session. Open an Artemis exercise to start the engine; the timers appear once it ticks.
                </p>
            </Container>
        );
    }

    const elapsedS = (now - debug.sessionStartMs) / 1000;
    const warmupLeft = Math.max(0, caps.warmupS - elapsedS);
    const cooldownLeft = debug.lastAlertMs === null ? null : Math.max(0, caps.cooldownS - (now - debug.lastAlertMs) / 1000);
    const graceLeft = debug.lastFmBadMs === null ? null : Math.max(0, caps.graceS - (now - debug.lastFmBadMs) / 1000);
    const minGapLeft = !throttle || throttle.lastDeliveryMs === null
        ? null
        : Math.max(0, caps.minDeliveryGapS - (now - throttle.lastDeliveryMs) / 1000);

    const inWindow = throttle ? throttle.deliveredAtMs.filter((t) => now - t < 60_000) : [];
    const perMinBlocked = inWindow.length >= caps.maxAlertsPerMinute && inWindow.length > 0;
    const perMinFreesIn = perMinBlocked ? Math.max(0, 60 - (now - Math.min(...inWindow)) / 1000) : null;

    return (
        <Container
            header={<div style={{ fontSize: '15px', fontWeight: 600 }}>Engine Timers &amp; Counters (developer)</div>}
            variant="default"
            padding="default"
        >
            <div className={styles.panel}>
                <p className={styles.note}>
                    Countdowns update every second; the underlying engine state refreshes each ~10&nbsp;s tick.
                </p>

                <div className={styles.group}>
                    <div className={styles.groupTitle}>Countdowns</div>
                    <Row label="Warm-up remaining" title="D1 gate: only FM/E4 alerts break through until this elapses (8 min from session start).">
                        <span className={styles.value}>{warmupLeft > 0 ? mmss(warmupLeft) : 'done'}</span>
                    </Row>
                    <Row label="Cooldown remaining" title="No new alert may fire within this window after the last one (120 s).">
                        <span className={styles.value}>{cooldownLeft === null ? <span className={styles.muted}>no alert yet</span> : cooldownLeft > 0 ? mmss(cooldownLeft) : 'clear'}</span>
                    </Row>
                    <Row label="Grace remaining (B4)" title="After a failing build, non-FM boundaries are suppressed for this grace window (~33 s).">
                        <span className={styles.value}>{graceLeft === null ? <span className={styles.muted}>inactive</span> : graceLeft > 0 ? `${Math.ceil(graceLeft)}s` : 'clear'}</span>
                    </Row>
                    <Row label="Delivery min-gap" title="Hard floor between two delivered hints (30 s), independent of the detector cooldown.">
                        <span className={styles.value}>{minGapLeft === null ? <span className={styles.muted}>no delivery yet</span> : minGapLeft > 0 ? `${Math.ceil(minGapLeft)}s` : 'ready'}</span>
                    </Row>
                    <Row label="Per-minute slot frees in" title="When the rolling 60 s delivery window next drops below its cap.">
                        <span className={styles.value}>{perMinFreesIn === null ? <span className={styles.muted}>slot open</span> : mmss(perMinFreesIn)}</span>
                    </Row>
                </div>

                <div className={styles.group}>
                    <div className={styles.groupTitle}>Delivery counters</div>
                    <Row label="Delivered this session" title="Hints delivered so far vs the per-session cap.">
                        <Badge variant={throttle && throttle.deliveredThisSession >= caps.maxAlertsPerSession ? 'error' : 'muted'}>
                            {throttle ? `${throttle.deliveredThisSession} / ${caps.maxAlertsPerSession}` : 'n/a'}
                        </Badge>
                    </Row>
                    <Row label="Delivered in last minute" title="Hints delivered within the rolling 60 s window vs the per-minute cap.">
                        <Badge variant={perMinBlocked ? 'error' : 'muted'}>
                            {throttle ? `${inWindow.length} / ${caps.maxAlertsPerMinute}` : 'n/a'}
                        </Badge>
                    </Row>
                </div>

                <div className={styles.group}>
                    <div className={styles.groupTitle}>Last-tick metrics</div>
                    <Row label="Session elapsed" title="Time since this exercise session started.">
                        <span className={styles.value}>{mmss(elapsedS, 'floor')}</span>
                    </Row>
                    <Row label="Effective feature window" title="Rolling window the features are computed over: grows max(10, min(60, elapsed)) up to the fixed 60 s window.">
                        <span className={styles.value}>{debug.effectiveWindowS}s / 60s</span>
                    </Row>
                    <Row label="Longest pause (window)" title="Longest typing pause in the current window, shown against the 40 s normalisation constant.">
                        <span className={styles.value}>{Math.round(debug.longestGapS)}s / {caps.gapNormS}s</span>
                    </Row>
                    <Row label="Off-screen error (fN2)" title="Whether an error sits >3 lines from the cursor and has been active long enough to add the fN2 severity bonus.">
                        <Badge variant={debug.fN2Active ? 'default' : 'muted'}>{debug.fN2Active ? 'active' : 'clear'}</Badge>
                    </Row>
                    <Row label="Re-arm gate (E6)" title="Whether the state machine is re-armed; alert legality is gated separately from the bare cooldown end.">
                        <Badge variant={debug.notRearmed ? 'error' : 'success'}>{debug.notRearmed ? 'gated' : 'armed'}</Badge>
                    </Row>
                </div>
            </div>
        </Container>
    );
}
