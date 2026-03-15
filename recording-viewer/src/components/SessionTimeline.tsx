import { useState, useMemo } from 'react';
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
import type { RecordedEvent, EventType, EqSnapshotEvent, BuildResultEvent } from '../types';

interface Props {
    events: RecordedEvent[];
    sessionStartTime: number;
}

interface ChartPoint {
    timeOffset: number;
    timeLabel: string;
    eq: number;
    eqPercent: number;
    confidence: string;
}

interface Marker {
    timeOffset: number;
    type: EventType;
    color: string;
    dashArray: string;
    opacity: number;
}

const MARKER_COLORS: Record<EventType, string> = {
    eqSnapshot: '#818cf8',
    buildResult: '#4ade80',
    textChange: '#94a3b8',
    save: '#60a5fa',
    diagnostics: '#fbbf24',
    fileSwitch: '#c084fc',
    windowFocus: '#fbbf24',
    fileSnapshot: '#4ade80',
    sessionStart: '#a5b4fc',
    sessionEnd: '#f87171',
    irisChatMessage: '#f472b6',
    selectionChange: '#06b6d4',
    visibleRangeChange: '#14b8a6',
};

const MARKER_EVENT_TYPES: EventType[] = [
    'buildResult',
    'textChange',
    'save',
    'diagnostics',
    'fileSwitch',
    'windowFocus',
    'fileSnapshot',
    'sessionStart',
    'sessionEnd',
    'irisChatMessage',
    'selectionChange',
    'visibleRangeChange',
];

function formatOffset(ms: number): string {
    const totalSeconds = Math.floor(ms / 1000);
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
}

// Custom dot renderer for confidence indication
function ConfidenceDot(props: Record<string, unknown>) {
    const { cx, cy, payload } = props as { cx: number; cy: number; payload: ChartPoint };
    const fill = payload.confidence === 'sufficient' ? '#6366f1' : '#94a3b8';
    return <Dot cx={cx} cy={cy} r={4} fill={fill} stroke="#1e1e2e" strokeWidth={1.5} />;
}

// Custom tooltip
function ChartTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: ChartPoint }> }) {
    if (!active || !payload?.[0]) return null;
    const data = payload[0].payload;
    return (
        <div className="chart-tooltip">
            <div className="tooltip-time">{data.timeLabel}</div>
            <div className="tooltip-eq">EQ: {data.eqPercent}%</div>
            <div className={`tooltip-confidence ${data.confidence}`}>
                {data.confidence}
            </div>
        </div>
    );
}

function getMarkerColor(event: RecordedEvent): string {
    if (event.type === 'buildResult') {
        const e = event as BuildResultEvent;
        return e.successful ? '#22c55e' : e.buildFailed ? '#ef4444' : '#f59e0b';
    }
    return MARKER_COLORS[event.type];
}

function getMarkerDash(type: EventType): string {
    if (type === 'windowFocus') return '2 3';
    return '4 4';
}

function getMarkerOpacity(type: EventType): number {
    if (type === 'textChange' || type === 'selectionChange' || type === 'visibleRangeChange') return 0.3;
    return 0.6;
}

export function SessionTimeline({ events, sessionStartTime }: Props) {
    const [enabledMarkers, setEnabledMarkers] = useState<Set<EventType>>(
        () => new Set<EventType>(['buildResult']),
    );

    const eqEvents = events.filter((e): e is EqSnapshotEvent => e.type === 'eqSnapshot');

    const markers = useMemo<Marker[]>(() => {
        return events
            .filter(e => e.type !== 'eqSnapshot' && enabledMarkers.has(e.type))
            .map(e => ({
                timeOffset: e.timestamp - sessionStartTime,
                type: e.type,
                color: getMarkerColor(e),
                dashArray: getMarkerDash(e.type),
                opacity: getMarkerOpacity(e.type),
            }));
    }, [events, enabledMarkers, sessionStartTime]);

    const toggleMarker = (type: EventType) => {
        setEnabledMarkers(prev => {
            const next = new Set(prev);
            if (next.has(type)) {
                next.delete(type);
            } else {
                next.add(type);
            }
            return next;
        });
    };

    if (eqEvents.length === 0) {
        return (
            <div className="eq-chart empty">
                <h2>Session Timeline</h2>
                <p className="empty-message">No EQ snapshots in this session.</p>
            </div>
        );
    }

    const data: ChartPoint[] = eqEvents.map(e => {
        const timeOffset = e.timestamp - sessionStartTime;
        return {
            timeOffset,
            timeLabel: formatOffset(timeOffset),
            eq: e.eq,
            eqPercent: Math.round(e.eq * 100),
            confidence: e.confidence,
        };
    });

    // Expand X domain to cover all events so markers outside EQ range are visible
    const allOffsets = events.map(e => e.timestamp - sessionStartTime);
    const xMin = Math.min(...allOffsets, ...data.map(d => d.timeOffset));
    const xMax = Math.max(...allOffsets, ...data.map(d => d.timeOffset));
    const xPadding = Math.max((xMax - xMin) * 0.03, 1000);
    const xDomain: [number, number] = [Math.max(0, xMin - xPadding), xMax + xPadding];

    return (
        <div className="eq-chart">
            <h2>Session Timeline</h2>

            <div className="filter-bar chart-filter-bar">
                <button
                    className="filter-btn toggle-all"
                    onClick={() => setEnabledMarkers(new Set(MARKER_EVENT_TYPES))}
                >
                    all
                </button>
                <button
                    className="filter-btn toggle-all"
                    onClick={() => setEnabledMarkers(new Set())}
                >
                    none
                </button>
                {MARKER_EVENT_TYPES.map(type => (
                    <button
                        key={type}
                        className={`filter-btn ${type} ${enabledMarkers.has(type) ? 'active' : ''}`}
                        style={enabledMarkers.has(type) ? { borderLeftColor: MARKER_COLORS[type], borderLeftWidth: 3 } : undefined}
                        onClick={() => toggleMarker(type)}
                    >
                        {type}
                    </button>
                ))}
            </div>

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

                    {markers.map((m, i) => (
                        <ReferenceLine
                            key={`${m.type}-${i}`}
                            x={m.timeOffset}
                            stroke={m.color}
                            strokeDasharray={m.dashArray}
                            strokeWidth={1}
                            strokeOpacity={m.opacity}
                        />
                    ))}

                    <Line
                        type="monotone"
                        dataKey="eqPercent"
                        stroke="#6366f1"
                        strokeWidth={2}
                        dot={<ConfidenceDot />}
                        activeDot={{ r: 6, fill: '#818cf8' }}
                    />
                </LineChart>
            </ResponsiveContainer>

        </div>
    );
}
