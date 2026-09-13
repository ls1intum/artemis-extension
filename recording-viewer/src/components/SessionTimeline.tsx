import { memo } from 'react';
import {
    LineChart,
    Line,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
    ReferenceLine,
    Dot,
} from 'recharts';
import type { Annotation, RecordedEvent, EqSnapshotEvent, ReplayEqSnapshot } from '../types.ts';
import { STRUGGLE_LABELS } from '../types.ts';
import { formatOffset } from '../utils/format.ts';
import { raterLaneColor } from '../utils/raterColor.ts';
import { EventBadge } from './EventBadge.tsx';
import { SessionChartOverlay } from './SessionChartOverlay';

interface ResearcherLane {
    raterId: string;
    raterName: string;
    annotations: Annotation[];
}

interface Props {
    events: RecordedEvent[];
    sessionStartTime: number;
    replayEq?: ReplayEqSnapshot[];
    annotations?: Annotation[];
    /** Researcher-only: per-rater lanes. When set, the component renders one
     *  read-only row of marker dots per lane below the EQ chart. */
    researcherLanes?: ResearcherLane[];
    xDomain?: [number, number];
    /** The currently zoomed range to highlight (from TrackingTimeline) */
    zoomedRange?: [number, number];
    videoTimeRef?: React.RefObject<number>;
}

interface ChartPoint {
    timeOffset: number;
    timeLabel: string;
    eq?: number;
    eqPercent?: number;
    confidence?: string;
    eqSource?: string;
    triggerType?: string;
    triggerEqPercent?: number;
    replayEqPercent?: number;
    replayConfidence?: string;
}


/**
 * Dot for the original EQ line. Trigger points get a larger, highlighted ring,
 * continuous (save/build) points a small dot.
 */
function EqDot(props: Record<string, unknown>) {
    const { cx, cy, payload } = props as { cx: number; cy: number; payload: ChartPoint };
    if (payload.eqPercent == null) return null;
    const isTrigger = payload.eqSource === 'trigger' || payload.triggerEqPercent != null;
    const fill = payload.confidence === 'sufficient' ? '#6366f1' : '#94a3b8';

    if (isTrigger) {
        return (
            <>
                <Dot cx={cx} cy={cy} r={7} fill="none" stroke="#f59e0b" strokeWidth={2} />
                <Dot cx={cx} cy={cy} r={4} fill={fill} stroke="#1e1e2e" strokeWidth={1.5} />
            </>
        );
    }
    return <Dot cx={cx} cy={cy} r={3} fill={fill} stroke="#1e1e2e" strokeWidth={1} />;
}

/**
 * Dot for original EQ line when replay data is present (dimmed).
 * Trigger points still get the ring but in gray.
 */
function EqDotDimmed(props: Record<string, unknown>) {
    const { cx, cy, payload } = props as { cx: number; cy: number; payload: ChartPoint };
    if (payload.eqPercent == null) return null;
    const isTrigger = payload.eqSource === 'trigger' || payload.triggerEqPercent != null;

    if (isTrigger) {
        return (
            <>
                <Dot cx={cx} cy={cy} r={6} fill="none" stroke="#f59e0b" strokeWidth={1.5} strokeOpacity={0.6} />
                <Dot cx={cx} cy={cy} r={3} fill="#94a3b8" stroke="#1e1e2e" strokeWidth={1} />
            </>
        );
    }
    return <Dot cx={cx} cy={cy} r={2.5} fill="#94a3b8" stroke="#1e1e2e" strokeWidth={1} />;
}

function ReplayConfidenceDot(props: Record<string, unknown>) {
    const { cx, cy, payload } = props as { cx: number; cy: number; payload: ChartPoint };
    if (payload.replayEqPercent == null) return null;
    const fill = payload.replayConfidence === 'sufficient' ? '#6366f1' : '#94a3b8';
    return <Dot cx={cx} cy={cy} r={4} fill={fill} stroke="#1e1e2e" strokeWidth={1.5} />;
}

function ChartTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: ChartPoint }> }) {
    if (!active || !payload?.[0]) return null;
    const data = payload[0].payload;
    const hasReplay = data.replayEqPercent != null;

    return (
        <div className="chart-tooltip">
            <div className="tooltip-time">{data.timeLabel}</div>
            {(data.eqPercent ?? data.triggerEqPercent) != null && (
                <div className="tooltip-eq" style={hasReplay ? { color: '#94a3b8' } : undefined}>
                    {hasReplay ? 'Original' : 'EQ'}: {data.eqPercent ?? data.triggerEqPercent}%
                    {data.confidence && (
                        <span className={`tooltip-confidence ${data.confidence}`}> ({data.confidence})</span>
                    )}
                </div>
            )}
            {data.eqSource && (
                <div style={{ fontSize: 11, color: data.eqSource === 'trigger' ? '#f59e0b' : '#666' }}>
                    {data.eqSource === 'trigger'
                        ? `trigger: ${data.triggerType ?? 'unknown'}`
                        : data.eqSource}
                </div>
            )}
            {data.replayEqPercent != null && (
                <div className="tooltip-eq" style={{ color: '#6366f1' }}>
                    Replay: {data.replayEqPercent}%
                    {data.replayConfidence && (
                        <span className={`tooltip-confidence ${data.replayConfidence}`}> ({data.replayConfidence})</span>
                    )}
                </div>
            )}
        </div>
    );
}

interface LineChartProps {
    events: RecordedEvent[];
    sessionStartTime: number;
    replayEq?: ReplayEqSnapshot[];
    annotations: Annotation[];
    xDomain: [number, number];
}

/**
 * Data-only chart. Wrapped in React.memo so it only rerenders when the
 * underlying data changes, not on every pan/zoom frame. The live zoom
 * rectangle and video playhead live in SessionChartOverlay as a DOM
 * sibling instead, so they never touch recharts.
 */
const SessionLineChart = memo(function SessionLineChart({
    events,
    sessionStartTime,
    replayEq,
    annotations,
    xDomain,
}: LineChartProps) {
    const eqEvents = events.filter((e): e is EqSnapshotEvent => e.type === 'eqSnapshot');
    const hasReplay = replayEq && replayEq.length > 0;

    const mergedMap = new Map<number, ChartPoint>();

    for (const e of eqEvents) {
        const timeOffset = e.timestamp - sessionStartTime;
        const isTrigger = e.source === 'trigger';
        const existing = mergedMap.get(timeOffset);

        if (existing && isTrigger) {
            // Don't overwrite real data, only tag it as a trigger.
            existing.triggerType = e.triggerType;
            existing.triggerEqPercent = Math.round(e.eq * 100);
        } else {
            mergedMap.set(timeOffset, {
                timeOffset,
                timeLabel: formatOffset(timeOffset),
                eq: e.eq,
                eqPercent: Math.round(e.eq * 100),
                confidence: e.confidence,
                eqSource: e.source,
                triggerType: e.triggerType,
                triggerEqPercent: isTrigger ? Math.round(e.eq * 100) : undefined,
            });
        }
    }

    if (hasReplay) {
        // Collect existing offsets sorted for fuzzy matching
        const existingOffsets = [...mergedMap.keys()].sort((a, b) => a - b);

        const claimed = new Set<number>();
        for (const r of replayEq!) {
            const timeOffset = r.timestamp - sessionStartTime;

            // Fuzzy match: find nearest unclaimed existing point within 1s
            let bestKey: number | undefined;
            let bestDist = Infinity;
            for (const key of existingOffsets) {
                if (claimed.has(key)) continue;
                const dist = Math.abs(key - timeOffset);
                if (dist < bestDist) {
                    bestDist = dist;
                    bestKey = key;
                }
                if (key > timeOffset + 1000) break;
            }

            if (bestKey !== undefined && bestDist <= 1000) {
                claimed.add(bestKey);
                const existing = mergedMap.get(bestKey)!;
                existing.replayEqPercent = Math.round(r.eq * 100);
                existing.replayConfidence = r.confidence;
            } else {
                mergedMap.set(timeOffset, {
                    timeOffset,
                    timeLabel: formatOffset(timeOffset),
                    replayEqPercent: Math.round(r.eq * 100),
                    replayConfidence: r.confidence,
                });
            }
        }
    }

    const data = [...mergedMap.values()].sort((a, b) => a.timeOffset - b.timeOffset);

    return (
        <ResponsiveContainer width="100%" height={200}>
            <LineChart data={data} margin={{ top: 10, right: 0, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                <XAxis
                    dataKey="timeOffset"
                    type="number"
                    domain={xDomain}
                    tick={false}
                    axisLine={false}
                    height={0}
                />
                <YAxis
                    domain={[0, 100]}
                    tickFormatter={v => `${v}%`}
                    stroke="#888"
                    fontSize={11}
                    width={1}
                    mirror
                />
                <Tooltip content={<ChartTooltip />} />

                {annotations.map(a => (
                    <ReferenceLine
                        key={`annot-${a.id}`}
                        x={a.timestamp - sessionStartTime}
                        stroke="#38bdf8"
                        strokeDasharray="2 2"
                        strokeWidth={1.5}
                        strokeOpacity={0.8}
                        label={{ value: '\u270E', position: 'insideTopRight', fill: '#38bdf8', fontSize: 11, offset: 4 }}
                    />
                ))}

                <Line
                    type="monotone"
                    dataKey="eqPercent"
                    stroke={hasReplay ? '#94a3b8' : '#6366f1'}
                    strokeWidth={hasReplay ? 1.5 : 2}
                    strokeDasharray={hasReplay ? '6 4' : undefined}
                    dot={hasReplay ? <EqDotDimmed /> : <EqDot />}
                    activeDot={hasReplay ? { r: 4, fill: '#94a3b8' } : { r: 6, fill: '#818cf8' }}
                    connectNulls
                />

                {hasReplay && (
                    <Line
                        type="monotone"
                        dataKey="replayEqPercent"
                        stroke="#6366f1"
                        strokeWidth={2}
                        dot={<ReplayConfidenceDot />}
                        activeDot={{ r: 6, fill: '#818cf8' }}
                        connectNulls
                    />
                )}
            </LineChart>
        </ResponsiveContainer>
    );
});


export function SessionTimeline({ events, sessionStartTime, replayEq, annotations = [], researcherLanes, xDomain: externalXDomain, zoomedRange, videoTimeRef }: Props) {
    const eqEvents = events.filter((e): e is EqSnapshotEvent => e.type === 'eqSnapshot');
    const hasReplay = replayEq && replayEq.length > 0;
    const hasLanes = !!researcherLanes && researcherLanes.length > 0;

    if (eqEvents.length === 0 && !hasReplay && !hasLanes) {
        return (
            <div className="eq-chart empty">
                <h2>Session Timeline</h2>
                <p className="empty-message">No EQ snapshots in this session.</p>
            </div>
        );
    }

    // Use shared xDomain when provided, otherwise derive one from EQ events,
    // replay EQ snapshots, and annotations. Replay data can extend past the
    // live EQ stream (or exist on its own), so it must contribute to the
    // fallback window for the public optional-xDomain contract.
    let xDomain: [number, number];
    if (externalXDomain) {
        xDomain = externalXDomain;
    } else {
        let xMin = Infinity;
        let xMax = -Infinity;
        for (const e of eqEvents) {
            const off = e.timestamp - sessionStartTime;
            if (off < xMin) xMin = off;
            if (off > xMax) xMax = off;
        }
        if (replayEq) {
            for (const r of replayEq) {
                const off = r.timestamp - sessionStartTime;
                if (off < xMin) xMin = off;
                if (off > xMax) xMax = off;
            }
        }
        for (const a of annotations) {
            const off = a.timestamp - sessionStartTime;
            if (off < xMin) xMin = off;
            if (off > xMax) xMax = off;
        }
        if (researcherLanes) {
            for (const lane of researcherLanes) {
                for (const a of lane.annotations) {
                    const off = a.timestamp - sessionStartTime;
                    if (off < xMin) xMin = off;
                    if (off > xMax) xMax = off;
                }
            }
        }
        if (!isFinite(xMin) || !isFinite(xMax)) {
            xMin = 0;
            xMax = 1000;
        }
        const xPadding = Math.max((xMax - xMin) * 0.03, 1000);
        xDomain = [Math.max(0, xMin - xPadding), xMax + xPadding];
    }

    const xSpan = xDomain[1] - xDomain[0];

    return (
        <div className="eq-chart stacked">
            {(eqEvents.length > 0 || hasReplay) && (
                <div className="eq-chart-grid">
                    <div className="eq-chart-label">
                        <EventBadge type="eqSnapshot" label="EQ" />
                    </div>
                    <div style={{ position: 'relative' }}>
                        <SessionLineChart
                            events={events}
                            sessionStartTime={sessionStartTime}
                            replayEq={replayEq}
                            annotations={annotations}
                            xDomain={xDomain}
                        />
                        <SessionChartOverlay
                            xDomain={xDomain}
                            zoomedRange={zoomedRange}
                            videoTimeRef={videoTimeRef}
                            sessionStartTime={sessionStartTime}
                        />
                    </div>
                </div>
            )}
            {hasLanes && (
                <div className="researcher-lanes">
                    {researcherLanes!.map(lane => {
                        const color = raterLaneColor(lane.raterId);
                        return (
                            <div key={lane.raterId} className="eq-chart-grid researcher-lane-row">
                                <div className="eq-chart-label">
                                    <span
                                        className="event-badge"
                                        title={`${lane.raterName} (${lane.annotations.length} marks)`}
                                        style={{ background: color, color: '#1e1e2e', fontWeight: 600 }}
                                    >
                                        {lane.raterName}
                                    </span>
                                </div>
                                <div
                                    style={{
                                        position: 'relative',
                                        height: 24,
                                        background: 'rgba(255,255,255,0.02)',
                                        borderTop: '1px solid #222',
                                        borderBottom: '1px solid #222',
                                    }}
                                >
                                    {lane.annotations.map(a => {
                                        const off = a.timestamp - sessionStartTime;
                                        const leftPct = xSpan > 0 ? ((off - xDomain[0]) / xSpan) * 100 : 0;
                                        if (leftPct < 0 || leftPct > 100) return null;
                                        // Struggle marks are filled by severity (confident green -> blocked red);
                                        // context markers / unlabelled notes keep the rater color. The lane badge
                                        // (rater color) still identifies whose row this is.
                                        const dotColor = STRUGGLE_LABELS.find(l => l.value === a.label)?.color ?? color;
                                        return (
                                            <div
                                                key={a.id}
                                                title={`${a.label ?? 'note'}${a.text ? `: ${a.text}` : ''} @ ${formatOffset(off)}`}
                                                style={{
                                                    position: 'absolute',
                                                    left: `${leftPct}%`,
                                                    top: '50%',
                                                    transform: 'translate(-50%, -50%)',
                                                    width: 10,
                                                    height: 10,
                                                    borderRadius: '50%',
                                                    background: dotColor,
                                                    border: '1.5px solid #1e1e2e',
                                                    boxShadow: '0 0 0 1px rgba(0,0,0,0.4)',
                                                }}
                                            />
                                        );
                                    })}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
