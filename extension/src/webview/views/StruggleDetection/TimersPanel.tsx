import type { StruggleDebugSnapshot } from '@shared/messageContracts';

import { Badge, Container } from '@webview/components';

import styles from './TimersPanel.module.css';
import { mmss, useEngineCountdowns } from './useEngineCountdowns';

interface TimersPanelProps {
    debug: StruggleDebugSnapshot;
    collapsible?: boolean;
    defaultCollapsed?: boolean;
}

function Row({ label, title, children }: { label: string; title: string; children: React.ReactNode }) {
    return (
        <div className={styles.row}>
            <span className={styles.label} title={title}>{label}</span>
            {children}
        </div>
    );
}

/** A bold value with an optional muted suffix (e.g. "60s (cap 40s, maxed)"). */
function Value({ children, sub }: { children: React.ReactNode; sub?: string }) {
    return (
        <span className={styles.value}>
            {children}{sub && <span className={styles.sub}> {sub}</span>}
        </span>
    );
}

/**
 * Developer-only timers/counters panel for the v3 struggle engine. Reads the latest
 * {@link StruggleDebugSnapshot} (the SAME source the `[Struggle]` log and the decision-flow
 * pipeline use) and derives every "remaining" locally via {@link useEngineCountdowns}, so the
 * readouts stay live between the 10 s engine ticks. All internal codes are spelled out in plain
 * language (no B4/E6/fN2 on screen); deeper detail lives in hover tooltips.
 */
export function TimersPanel({ debug, collapsible, defaultCollapsed }: TimersPanelProps) {
    const { caps, throttle } = debug;
    // Hooks must run unconditionally, before the inactive-session early return below.
    const c = useEngineCountdowns(debug);

    // No active exercise session: every anchor is stale/zero, so show a clear empty state rather
    // than counting a bogus warm-up from epoch (the struggle view can be opened outside an exercise).
    if (!debug.sessionActive) {
        return (
            <Container
                header={<div style={{ fontSize: '15px', fontWeight: 600 }}>Engine timers &amp; delivery</div>}
                variant="default"
                padding="default"
                collapsible={collapsible}
                defaultCollapsed={defaultCollapsed}
            >
                <p className={styles.note}>
                    No active exercise session. Open an Artemis exercise to start the engine; the timers appear once it ticks.
                </p>
            </Container>
        );
    }

    const lastDeliveredMs = throttle?.lastDeliveryMs ?? null;
    const lastDeliveredS = lastDeliveredMs === null ? null : (lastDeliveredMs - debug.sessionStartMs) / 1000;
    // Re-arm state comes from the latest decision trace; null trace = session started, no tick yet.
    const reArm = debug.decisionTrace === null
        ? 'waiting for first tick'
        : debug.decisionTrace.gates.notRearmed ? 'waiting' : 'armed';
    // Typing rate from the latest trace; null = no tick yet or the window has no data (B2 fail-open).
    const typingRate = debug.decisionTrace?.typingRate ?? null;
    const tps = debug.testStagnation;

    return (
        <Container
            header={<div style={{ fontSize: '15px', fontWeight: 600 }}>Engine timers &amp; delivery</div>}
            variant="default"
            padding="default"
            collapsible={collapsible}
            defaultCollapsed={defaultCollapsed}
        >
            <div className={styles.panel}>
                <p className={styles.note}>
                    Countdowns update every second; the underlying engine state refreshes each ~10&nbsp;s tick.
                </p>

                <div className={styles.group}>
                    <div className={styles.groupTitle}>Countdowns</div>
                    <Row label="Warm-up remaining" title="Until the warm-up ends, only a failed build or a finished terminal run can nudge (8 min from session start).">
                        <Value>{c.warmupLeft > 0 ? mmss(c.warmupLeft) : 'done'}</Value>
                    </Row>
                    <Row label="Cooldown remaining" title="No new nudge may fire within this window after the last one (120 s).">
                        <Value>{c.cooldownLeft === null ? <span className={styles.muted}>no alert yet</span> : c.cooldownLeft > 0 ? mmss(c.cooldownLeft) : 'clear'}</Value>
                    </Row>
                    <Row label="Post-build grace window" title="Just after a failing build, only build-related moments may nudge for a short grace window (~33 s).">
                        <Value>{c.graceLeft === null ? <span className={styles.muted}>inactive</span> : c.graceLeft > 0 ? `${Math.ceil(c.graceLeft)}s` : 'clear'}</Value>
                    </Row>
                    <Row label="Minimum gap between hints" title="Hard floor between two delivered hints (level-dependent: Less 300 s / More 150 s), independent of the detector cooldown.">
                        <Value>{c.minGapLeft === null ? <span className={styles.muted}>no delivery yet</span> : c.minGapLeft > 0 ? `${Math.ceil(c.minGapLeft)}s` : 'ready'}</Value>
                    </Row>
                </div>

                <div className={styles.group}>
                    <div className={styles.groupTitle}>Hints delivered</div>
                    <Row label="This session" title="Hints delivered so far vs the per-session cap for the active proactive-help level (Less 3 / More 6).">
                        <Badge variant={throttle && throttle.deliveredThisSession >= throttle.maxAlertsPerSession ? 'error' : 'muted'}>
                            {throttle ? `${throttle.deliveredThisSession} / ${throttle.maxAlertsPerSession}` : 'n/a'}
                        </Badge>
                    </Row>
                    <Row label="Last delivered" title="When the most recent hint was actually delivered to the student.">
                        <Value>{lastDeliveredS === null ? <span className={styles.muted}>none yet</span> : `at ${mmss(lastDeliveredS, 'floor')}`}</Value>
                    </Row>
                </div>

                <div className={styles.group}>
                    <div className={styles.groupTitle}>Signals (last tick)</div>
                    <Row label="Session elapsed" title="Time since this exercise session started.">
                        <Value>{mmss(c.elapsedS, 'floor')}</Value>
                    </Row>
                    <Row label="Analysis window" title="Rolling window the features are computed over: grows up to the fixed 60 s window over the first minute.">
                        <Value sub={`of 60s${debug.effectiveWindowS >= 60 ? ' (full)' : ''}`}>{debug.effectiveWindowS}s</Value>
                    </Row>
                    <Row label="Longest typing pause" title="Longest typing pause in the current window, shown against the 40 s normalisation cap (the gap score maxes out there).">
                        <Value sub={`(cap ${caps.gapNormS}s${Math.round(debug.longestGapS) >= caps.gapNormS ? ', maxed' : ''})`}>{Math.round(debug.longestGapS)}s</Value>
                    </Row>
                    <Row label="Typing rate" title="Keystrokes per minute over the analysis window. Drives the typing-deficit severity feature, the fluent-typing gate (suppresses at 20/min or more), and the low-typing boundary (below 5/min after warm-up).">
                        <Value sub="(fluent ≥ 20/min)">{typingRate === null ? <span className={styles.muted}>n/a</span> : `${Math.round(typingRate)}/min`}</Value>
                    </Row>
                    <Row label="Error far from your cursor" title="Whether an error sits more than 3 lines from the cursor and has been active long enough to raise severity.">
                        <Badge variant={debug.fN2Active ? 'default' : 'muted'}>{debug.fN2Active ? 'active' : 'clear'}</Badge>
                    </Row>
                    <Row label="Test stagnation" title="Discrete add-on: fires on the Nth consecutive build without a strict new high in passed tests. Bypasses the moment gates; shares only the cooldown.">
                        {tps === null || !tps.enabled
                            ? <Value><span className={styles.muted}>{tps === null ? 'n/a' : 'disabled'}</span></Value>
                            : (
                                <Badge variant={tps.streak >= tps.n ? 'error' : 'muted'}>
                                    {tps.streak} / {tps.n} builds without progress
                                </Badge>
                            )}
                    </Row>
                    <Row label="Re-arm after cooldown" title="After the cooldown ends, the engine waits for urgency to stay elevated before it re-arms for a new nudge.">
                        <Value>{reArm === 'armed' ? 'armed' : <span className={styles.muted}>{reArm}</span>}</Value>
                    </Row>
                </div>
            </div>
        </Container>
    );
}
