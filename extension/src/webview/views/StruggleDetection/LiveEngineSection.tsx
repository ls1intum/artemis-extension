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

import type { BoundaryType, LiveTick, VsCodeApi } from '@shared/messageContracts';
import { ExtensionMsg, postCommand } from '@shared/messageContracts';

import { Badge, Container } from '@webview/components';
import { useExtensionMessage } from '@webview/hooks/useExtensionMessage';

import type { GlossaryKey } from './glossary';
import { boundaryText, discreteText, GLOSSARY, reasonText } from './glossary';
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

/** Boundary glossary keys, used to render their codes as secondary badges. */
const BOUNDARY_KEYS: BoundaryType[] = ['FM', 'FM_PLUS', 'E4', 'N1', 'STATE'];

/** Every glossary key the live view renders, for the collapsible legend. */
const LEGEND_KEYS: GlossaryKey[] = [
    'urgency', 's', 'v', 'theta', 'fastDecay',
    'FM', 'FM_PLUS', 'E4', 'N1', 'STATE',
    'fired', 'no-candidate', 'b2-fluent-typing', 'b4-grace-filter',
    'd1-warmup', 'below-threshold', 'cooldown', 'not-rearmed',
    'test-stagnation',
];

/** Small secondary developer tag rendering an internal code (never the sole label). */
function CodeTag({ code }: { code: string }) {
    return <span className={styles.code}>{code}</span>;
}

/**
 * Developer-only live view of the v3 struggle engine. Owns BOTH the message
 * listener AND the subscribe/unsubscribe lifecycle, so the listener is attached
 * before `struggleLiveSubscribe` is posted (no lost backfill). Renders the
 * urgency curve plus a plain-language "what is the engine doing right now" panel.
 *
 * Every visible symbol's text is read from the glossary (Self-Explaining UI):
 * internal codes appear only as small secondary tags, never as the sole label.
 */
export function LiveEngineSection({ vscodeApi }: LiveEngineSectionProps) {
    const [ticks, setTicks] = useState<LiveTick[]>([]);
    const [showS, setShowS] = useState(false);
    const [showV, setShowV] = useState(false);
    const [legendOpen, setLegendOpen] = useState(false);
    const [chartRef, chartWidth] = useMeasuredWidth(FALLBACK_CHART_WIDTH);

    // 1) Register the message listener FIRST so it is live before we subscribe.
    useExtensionMessage((msg) => {
        if (msg.type === ExtensionMsg.StruggleLiveBackfill) {
            setTicks(msg.ticks);
        } else if (msg.type === ExtensionMsg.StruggleLiveTick) {
            setTicks((prev) => [...prev, msg.tick]);
        } else if (msg.type === ExtensionMsg.StruggleLiveReset) {
            setTicks([]);
        }
    }, [setTicks]);

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
                    The curve advances one point every ~10&nbsp;s — the engine&apos;s real tick resolution.
                </p>

                {ticks.length === 0 ? (
                    <div className={styles.chartEmpty}>
                        Waiting for the first engine tick… the curve will appear once the session produces data.
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
                                    explanation lives in the panel + legend below. */}
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
                                {GLOSSARY.urgency.text} <CodeTag code={GLOSSARY.urgency.code} />
                            </span>
                            <span className={styles.markerItem}>
                                <span className={styles.dotSwatch} style={{ background: THETA_COLOR }} />
                                {GLOSSARY.theta.text} <CodeTag code={GLOSSARY.theta.code} />
                            </span>
                            <span className={styles.markerItem}>
                                <span className={styles.dotSwatch} style={{ background: BOUNDARY_COLOR }} />
                                Blue dot — a boundary moment was present at that tick
                                {BOUNDARY_KEYS.map((b) => <CodeTag key={b} code={GLOSSARY[b].code} />)}
                            </span>
                            <span className={styles.markerItem}>
                                <span className={styles.ringSwatch} style={{ borderColor: ALERT_COLOR }} />
                                Red ring — an alert actually fired at that tick
                            </span>
                        </div>

                        <div className={styles.toggleRow}>
                            <span>Also show:</span>
                            <label className={styles.toggleLabel}>
                                <input type="checkbox" checked={showS} onChange={(e) => setShowS(e.target.checked)} />
                                <span className={styles.swatch} style={{ background: S_COLOR }} />
                                {GLOSSARY.s.text} <CodeTag code={GLOSSARY.s.code} />
                            </label>
                            <label className={styles.toggleLabel}>
                                <input type="checkbox" checked={showV} onChange={(e) => setShowV(e.target.checked)} />
                                <span className={styles.swatch} style={{ background: V_COLOR }} />
                                {GLOSSARY.v.text} <CodeTag code={GLOSSARY.v.code} />
                            </label>
                        </div>
                    </>
                )}

                <CurrentTickPanel tick={latest} />

                <span data-testid="live-tick-count" style={{ display: 'none' }}>{ticks.length}</span>

                <div>
                    <button type="button" className={styles.legendToggle} onClick={() => setLegendOpen((v) => !v)}>
                        {legendOpen ? '▾ Hide legend' : '▸ Show legend (what every symbol means)'}
                    </button>
                    {legendOpen && (
                        <ul className={styles.legendList} style={{ marginTop: '8px' }}>
                            {LEGEND_KEYS.map((k) => (
                                <li key={k} className={styles.legendEntry}>
                                    <CodeTag code={GLOSSARY[k].code} />
                                    <span className={styles.legendText}>{GLOSSARY[k].text}</span>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            </div>
        </Container>
    );
}

/**
 * "What is the engine doing right now" — the latest tick spelled out in plain
 * language. The decision reason comes from the glossary via `reasonText` (or
 * `discreteText` when a discrete trigger fired). Codes appear only as small tags.
 */
function CurrentTickPanel({ tick }: { tick: LiveTick | null }) {
    if (!tick) {
        return (
            <Container variant="muted" padding="default">
                <p className={styles.muted}>No engine tick has arrived yet for this session.</p>
            </Container>
        );
    }

    const { decisionTrace: trace, urgency, theta, boundariesPreGate, alertKind } = tick;
    const fired = trace.outcome === 'fired-edit' || trace.outcome === 'fired-discrete';

    // Headline: spelled-out decision. Discrete path names its trigger explicitly.
    const headline = trace.outcome === 'fired-discrete' && trace.discreteTrigger
        ? discreteText(trace.discreteTrigger)
        : reasonText(trace.reason);
    const headlineCode = trace.outcome === 'fired-discrete' && trace.discreteTrigger
        ? GLOSSARY[trace.discreteTrigger].code
        : GLOSSARY[trace.reason].code;

    const aboveTheta = urgency >= theta;

    return (
        <Container
            header={<div style={{ fontSize: '14px', fontWeight: 600 }}>What the engine is doing right now</div>}
            variant="default"
            padding="default"
        >
            <div className={styles.panel}>
                <div className={styles.headline}>
                    <Badge variant={fired ? 'error' : 'muted'}>{fired ? 'Alert fired' : 'Holding back'}</Badge>{' '}
                    {headline} <CodeTag code={headlineCode} />
                </div>

                <div className={styles.row}>
                    <span className={styles.rowLabel}>{GLOSSARY.urgency.text} <CodeTag code={GLOSSARY.urgency.code} /></span>
                    <Badge variant={aboveTheta ? 'error' : 'success'}>{urgency.toFixed(2)}</Badge>
                </div>

                <div className={styles.row}>
                    <span className={styles.rowLabel}>{GLOSSARY.theta.text} <CodeTag code={GLOSSARY.theta.code} /></span>
                    <Badge variant="muted">{theta.toFixed(2)}</Badge>
                </div>

                <div>
                    <div className={styles.rowLabel} style={{ marginBottom: '6px' }}>Boundary moments present this tick</div>
                    {boundariesPreGate.length === 0 ? (
                        <p className={styles.muted}>None — no boundary event is pending, so there is nothing to nudge on.</p>
                    ) : (
                        <div className={styles.panel}>
                            {boundariesPreGate.map((b: BoundaryType) => {
                                const { text, code } = boundaryText(b);
                                return (
                                    <div key={b} className={styles.boundaryItem}>
                                        <span>{text}</span> <CodeTag code={code} />
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>

                <div className={styles.badgeRow}>
                    {trace.inWarmup && (
                        <Badge variant="warning">{GLOSSARY['d1-warmup'].text}</Badge>
                    )}
                    {trace.graceActive && (
                        <Badge variant="warning">{GLOSSARY['b4-grace-filter'].text}</Badge>
                    )}
                    {trace.reason === 'cooldown' && (
                        <Badge variant="info">{GLOSSARY.cooldown.text}</Badge>
                    )}
                    {alertKind !== null && (
                        <Badge variant="error">
                            {alertKind === 'discrete'
                                ? 'An alert fired this tick on the test-stagnation path'
                                : 'An alert fired this tick on the edit / boundary path'}
                            {' '}<CodeTag code={alertKind} />
                        </Badge>
                    )}
                </div>

                {trace.secondsSinceLastAlert !== null && (
                    <p className={styles.muted}>
                        Seconds since the previous alert: {trace.secondsSinceLastAlert}s.
                    </p>
                )}
            </div>
        </Container>
    );
}
