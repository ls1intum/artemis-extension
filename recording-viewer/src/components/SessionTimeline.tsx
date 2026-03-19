import { useState, useEffect } from 'react';
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
import { formatOffset } from '../utils/format.ts';

interface Props {
    events: RecordedEvent[];
    sessionStartTime: number;
    replayEq?: ReplayEqSnapshot[];
    annotations?: Annotation[];
    xDomain?: [number, number];
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
 * Dot for original EQ line — trigger points get a larger, highlighted ring.
 * Continuous (save/build) points get a small dot.
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

// Dot for replay line
function ReplayConfidenceDot(props: Record<string, unknown>) {
    const { cx, cy, payload } = props as { cx: number; cy: number; payload: ChartPoint };
    if (payload.replayEqPercent == null) return null;
    const fill = payload.replayConfidence === 'sufficient' ? '#6366f1' : '#94a3b8';
    return <Dot cx={cx} cy={cy} r={4} fill={fill} stroke="#1e1e2e" strokeWidth={1.5} />;
}

// Tooltip showing EQ value + source/trigger info
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


export function SessionTimeline({ events, sessionStartTime, replayEq, annotations = [], xDomain: externalXDomain, videoTimeRef }: Props) {
    // Throttled playhead position (updates every 250ms)
    const [playheadOffset, setPlayheadOffset] = useState<number | null>(null);
    useEffect(() => {
        if (!videoTimeRef) return;
        const interval = setInterval(() => {
            const ts = videoTimeRef.current;
            if (ts > 0) {
                setPlayheadOffset(ts - sessionStartTime);
            }
        }, 250);
        return () => clearInterval(interval);
    }, [videoTimeRef, sessionStartTime]);
    const eqEvents = events.filter((e): e is EqSnapshotEvent => e.type === 'eqSnapshot');
    const hasReplay = replayEq && replayEq.length > 0;

    if (eqEvents.length === 0 && !hasReplay) {
        return (
            <div className="eq-chart empty">
                <h2>Session Timeline</h2>
                <p className="empty-message">No EQ snapshots in this session.</p>
            </div>
        );
    }

    // Build merged data points
    const mergedMap = new Map<number, ChartPoint>();

    for (const e of eqEvents) {
        const timeOffset = e.timestamp - sessionStartTime;
        const isTrigger = e.source === 'trigger';
        const existing = mergedMap.get(timeOffset);

        if (existing && isTrigger) {
            // Don't overwrite real data — just tag as trigger
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

    // Use shared xDomain when provided, otherwise compute from EQ data + annotations
    let xDomain: [number, number];
    if (externalXDomain) {
        xDomain = externalXDomain;
    } else {
        const dataOffsets = data.map(d => d.timeOffset);
        const annotOffsets = annotations.map(a => a.timestamp - sessionStartTime);
        const xMin = Math.min(...dataOffsets, ...annotOffsets);
        const xMax = Math.max(...dataOffsets, ...annotOffsets);
        const xPadding = Math.max((xMax - xMin) * 0.03, 1000);
        xDomain = [Math.max(0, xMin - xPadding), xMax + xPadding];
    }

    const hasTriggerPoints = eqEvents.some(e => e.source === 'trigger');

    return (
        <div className="eq-chart">
            <h2>Session Timeline</h2>

            <ResponsiveContainer width="100%" height={300}>
                <LineChart data={data} margin={{ top: 10, right: 30, left: 10, bottom: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                    <XAxis
                        dataKey="timeOffset"
                        type="number"
                        domain={xDomain}
                        tickFormatter={formatOffset}
                        stroke="#888"
                        fontSize={12}
                        label={{ value: 'Time', position: 'insideBottom', offset: -5, fill: '#888' }}
                    />
                    <YAxis
                        domain={[0, 100]}
                        tickFormatter={v => `${v}%`}
                        stroke="#888"
                        fontSize={12}
                        label={{ value: 'EQ', angle: -90, position: 'insideLeft', fill: '#888' }}
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

                    {/* Video playhead */}
                    {playheadOffset != null && (
                        <ReferenceLine
                            x={playheadOffset}
                            stroke="#ef4444"
                            strokeWidth={1.5}
                        />
                    )}

                    {/* Original EQ line */}
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

                    {/* Replay EQ line (only when replay data present) */}
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

            {/* Legend */}
            <div className="chart-legend" style={{ display: 'flex', gap: 16, justifyContent: 'center', marginTop: 8, fontSize: 13, flexWrap: 'wrap' }}>
                {hasReplay && (
                    <>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <svg width="24" height="2"><line x1="0" y1="1" x2="24" y2="1" stroke="#94a3b8" strokeWidth="1.5" strokeDasharray="6 4" /></svg>
                            <span style={{ color: '#94a3b8' }}>Original EQ</span>
                        </span>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <svg width="24" height="2"><line x1="0" y1="1" x2="24" y2="1" stroke="#6366f1" strokeWidth="2" /></svg>
                            <span style={{ color: '#6366f1' }}>Replay EQ</span>
                        </span>
                    </>
                )}
                {annotations.length > 0 && (
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <svg width="24" height="2"><line x1="0" y1="1" x2="24" y2="1" stroke="#38bdf8" strokeWidth="1.5" strokeDasharray="2 2" /></svg>
                        <span style={{ color: '#38bdf8' }}>Annotations</span>
                    </span>
                )}
                {hasTriggerPoints && (
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <svg width="16" height="16">
                            <circle cx="8" cy="8" r="6" fill="none" stroke="#f59e0b" strokeWidth="2" />
                            <circle cx="8" cy="8" r="3" fill="#6366f1" />
                        </svg>
                        <span style={{ color: '#f59e0b' }}>Trigger evaluation</span>
                    </span>
                )}
            </div>

        </div>
    );
}
