import type { RefObject } from 'react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
    CartesianGrid,
    Line,
    LineChart,
    ReferenceDot,
    ReferenceLine,
    XAxis,
    YAxis,
} from 'recharts';

import type { LiveTick, VsCodeApi } from '@shared/messageContracts';
import { ExtensionMsg, postCommand } from '@shared/messageContracts';

import { Container } from '@webview/components';
import { useExtensionMessage } from '@webview/hooks/useExtensionMessage';

import { GLOSSARY } from './glossary';
import styles from './LiveEngineSection.module.css';

interface LiveEngineSectionProps {
    vscodeApi: VsCodeApi;
}

/** Line colours for the three curves (urgency primary, s/v secondary). */
const URGENCY_COLOR = '#6366f1';
const S_COLOR = '#f59e0b';
const V_COLOR = '#22c55e';
const THETA_COLOR = '#f44336';
const BOUNDARY_COLOR = '#38bdf8';
const ALERT_COLOR = '#ef4444';

/** Session-indicator dot colours (active session vs. idle / no session). */
const SESSION_ON_COLOR = '#22c55e';
const SESSION_OFF_COLOR = '#6b7280';

/** Fixed chart height; width is measured from the container (see useMeasuredWidth). */
const CHART_HEIGHT = 220;
/** Fallback width when the container is unmeasured (e.g. a 0-size jsdom/happy-dom
 *  container in tests). Keeps recharts from warning about a 0×0 chart. */
const FALLBACK_CHART_WIDTH = 600;

/**
 * Measures the host element's content width via ResizeObserver. Returns the
 * fallback until a real measurement arrives. Used instead of recharts'
 * ResponsiveContainer so the chart never renders at 0×0 (which logs a recharts
 * warning under happy-dom where the container has no layout size).
 */
function useMeasuredWidth(fallback: number): [RefObject<HTMLDivElement>, number] {
    const ref = useRef<HTMLDivElement>(null);
    const [width, setWidth] = useState(fallback);
    useLayoutEffect(() => {
        const el = ref.current;
        if (!el || typeof ResizeObserver === 'undefined') { return; }
        const update = () => {
            const w = el.clientWidth;
            if (w > 0) { setWidth(w); }
        };
        update();
        const ro = new ResizeObserver(update);
        ro.observe(el);
        return () => ro.disconnect();
    }, []);
    return [ref, width];
}

/**
 * Developer-only live view of the v3 struggle engine. Owns BOTH the message
 * listener AND the subscribe/unsubscribe lifecycle, so the listener is attached
 * before `struggleLiveSubscribe` is posted (no lost backfill). Renders the
 * historical urgency curve; the decision-flow pipeline above explains the latest tick.
 *
 * Every visible symbol is spelled out in full (Self-Explaining UI): no internal
 * codes are shown on screen. The deeper engine detail lives in hover tooltips.
 */
export function LiveEngineSection({ vscodeApi }: LiveEngineSectionProps) {
    const [ticks, setTicks] = useState<LiveTick[]>([]);
    // null until the first session-state message arrives (subscribe posts it).
    const [sessionActive, setSessionActive] = useState<boolean | null>(null);
    const [showS, setShowS] = useState(false);
    const [showV, setShowV] = useState(false);
    const [chartRef, chartWidth] = useMeasuredWidth(FALLBACK_CHART_WIDTH);

    // 1) Register the message listener FIRST so it is live before we subscribe.
    useExtensionMessage((msg) => {
        if (msg.type === ExtensionMsg.StruggleLiveBackfill) {
            setTicks(msg.ticks);
        } else if (msg.type === ExtensionMsg.StruggleLiveTick) {
            setTicks((prev) => [...prev, msg.tick]);
        } else if (msg.type === ExtensionMsg.StruggleLiveReset) {
            setTicks([]);
        } else if (msg.type === ExtensionMsg.StruggleLiveSessionState) {
            setSessionActive(msg.active);
        }
    }, [setTicks, setSessionActive]);

    // 2) Subscribe on mount / unsubscribe on unmount. Runs after the listener is
    //    set up (effects fire in declaration order), so the backfill is not lost.
    useEffect(() => {
        postCommand(vscodeApi, 'struggleLiveSubscribe');
        return () => postCommand(vscodeApi, 'struggleLiveUnsubscribe');
    }, [vscodeApi]);

    const latest = ticks.at(-1) ?? null;
    // θ is fixed (0.70) but read it off the latest tick so the line tracks the
    // engine's reported threshold; fall back to the frozen default before any tick.
    const theta = latest?.theta ?? 0.7;

    return (
        <Container
            header={<div style={{ fontSize: '15px', fontWeight: 600 }}>Live Engine View (developer)</div>}
            variant="default"
            padding="default"
        >
            <div className={styles.section}>
                <p className={styles.note}>
                    The curve advances one point every ~10&nbsp;s (the engine&apos;s real tick resolution).
                </p>

                <div className={styles.sessionIndicator}>
                    <span
                        className={styles.sessionDot}
                        style={{ background: sessionActive ? SESSION_ON_COLOR : SESSION_OFF_COLOR }}
                    />
                    <span>
                        {sessionActive === null
                            ? 'Checking session status.'
                            : sessionActive
                                ? 'Exercise session active: the engine is ticking every ~10 s.'
                                : 'No active exercise session. Open an exercise to start the live engine.'}
                    </span>
                </div>

                {ticks.length === 0 ? (
                    <div className={styles.chartEmpty}>
                        {sessionActive === false
                            ? 'No active exercise session. Open an Artemis exercise to start the engine, then the curve will appear here.'
                            : 'Waiting for the first engine tick. The curve will appear once the session produces data.'}
                    </div>
                ) : (
                    <>
                        <div ref={chartRef} className={styles.chartFrame}>
                            <LineChart width={chartWidth} height={CHART_HEIGHT} data={ticks} margin={{ top: 12, right: 12, left: 0, bottom: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                                <XAxis
                                    dataKey="t"
                                    type="number"
                                    domain={['dataMin', 'dataMax']}
                                    stroke="#888"
                                    fontSize={11}
                                    tickFormatter={(t: number) => `${t}s`}
                                />
                                <YAxis
                                    domain={[0, 1]}
                                    stroke="#888"
                                    fontSize={11}
                                    width={36}
                                />
                                {/* Alert threshold (θ). Spelled out on the line; full
                                    explanation lives in the panel below. */}
                                <ReferenceLine
                                    y={theta}
                                    stroke={THETA_COLOR}
                                    strokeDasharray="4 4"
                                    label={{ value: `alert threshold ${theta.toFixed(2)}`, position: 'insideTopRight', fill: THETA_COLOR, fontSize: 11 }}
                                />
                                {/* urgency (primary) + optional s / v. */}
                                <Line type="monotone" dataKey="urgency" stroke={URGENCY_COLOR} strokeWidth={2} dot={false} isAnimationActive={false} />
                                {showS && <Line type="monotone" dataKey="s" stroke={S_COLOR} strokeWidth={1.5} strokeDasharray="5 3" dot={false} isAnimationActive={false} />}
                                {showV && <Line type="monotone" dataKey="v" stroke={V_COLOR} strokeWidth={1.5} strokeDasharray="2 3" dot={false} isAnimationActive={false} />}
                                {/* Boundary markers (any tick with a pre-gate boundary). */}
                                {ticks
                                    .filter((tk) => tk.boundariesPreGate.length > 0)
                                    .map((tk) => (
                                        <ReferenceDot key={`b-${tk.t}`} x={tk.t} y={tk.urgency} r={4} fill={BOUNDARY_COLOR} stroke="#1e1e1e" strokeWidth={1} />
                                    ))}
                                {/* Alert markers (fired this tick). */}
                                {ticks
                                    .filter((tk) => tk.alertKind !== null)
                                    .map((tk) => (
                                        <ReferenceDot key={`a-${tk.t}`} x={tk.t} y={tk.urgency} r={6} fill="none" stroke={ALERT_COLOR} strokeWidth={2} />
                                    ))}
                            </LineChart>
                        </div>

                        {/* What every chart glyph means (the chart itself cannot carry
                            full sentences, so spell the marker semantics out here). */}
                        <div className={styles.markerLegend}>
                            <span className={styles.markerItem}>
                                <span className={styles.swatch} style={{ background: URGENCY_COLOR }} />
                                <span title={GLOSSARY.urgency.tooltip}>{GLOSSARY.urgency.text}</span>
                            </span>
                            <span className={styles.markerItem}>
                                <span className={styles.dotSwatch} style={{ background: THETA_COLOR }} />
                                <span title={GLOSSARY.theta.tooltip}>{GLOSSARY.theta.text}</span>
                            </span>
                            <span className={styles.markerItem}>
                                <span className={styles.dotSwatch} style={{ background: BOUNDARY_COLOR }} />
                                <span>Blue dot: a boundary moment was present at that tick</span>
                            </span>
                            <span className={styles.markerItem}>
                                <span className={styles.ringSwatch} style={{ borderColor: ALERT_COLOR }} />
                                <span>Red ring: an alert actually fired at that tick</span>
                            </span>
                        </div>

                        <div className={styles.toggleRow}>
                            <span>Also show on the curve:</span>
                            <label className={styles.toggleLabel}>
                                <input type="checkbox" checked={showS} onChange={(e) => setShowS(e.target.checked)} />
                                <span className={styles.swatch} style={{ background: S_COLOR }} />
                                <span title={GLOSSARY.s.tooltip}>{GLOSSARY.s.text}</span>
                            </label>
                            <label className={styles.toggleLabel}>
                                <input type="checkbox" checked={showV} onChange={(e) => setShowV(e.target.checked)} />
                                <span className={styles.swatch} style={{ background: V_COLOR }} />
                                <span title={GLOSSARY.v.tooltip}>{GLOSSARY.v.text}</span>
                            </label>
                        </div>
                    </>
                )}

                <span data-testid="live-tick-count" style={{ display: 'none' }}>{ticks.length}</span>
            </div>
        </Container>
    );
}
