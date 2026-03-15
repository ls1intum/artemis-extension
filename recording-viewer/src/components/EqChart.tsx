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
import type { RecordedEvent, EqSnapshotEvent, BuildResultEvent } from '../types';

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

interface BuildMarker {
    timeOffset: number;
    successful: boolean | undefined;
    buildFailed: boolean;
}

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

export function EqChart({ events, sessionStartTime }: Props) {
    const eqEvents = events.filter((e): e is EqSnapshotEvent => e.type === 'eqSnapshot');
    const buildEvents = events.filter((e): e is BuildResultEvent => e.type === 'buildResult');

    if (eqEvents.length === 0) {
        return (
            <div className="eq-chart empty">
                <h2>EQ Score Timeline</h2>
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

    const buildMarkers: BuildMarker[] = buildEvents.map(e => ({
        timeOffset: e.timestamp - sessionStartTime,
        successful: e.successful,
        buildFailed: e.buildFailed,
    }));

    return (
        <div className="eq-chart">
            <h2>EQ Score Timeline</h2>
            <ResponsiveContainer width="100%" height={300}>
                <LineChart data={data} margin={{ top: 10, right: 30, left: 10, bottom: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                    <XAxis
                        dataKey="timeOffset"
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

                    {/* Build result markers as vertical reference lines */}
                    {buildMarkers.map((b, i) => (
                        <ReferenceLine
                            key={i}
                            x={b.timeOffset}
                            stroke={b.successful ? '#22c55e' : b.buildFailed ? '#ef4444' : '#f59e0b'}
                            strokeDasharray="4 4"
                            strokeWidth={1}
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
            <div className="chart-legend">
                <span className="legend-item">
                    <span className="legend-dot sufficient" /> sufficient confidence
                </span>
                <span className="legend-item">
                    <span className="legend-dot insufficient" /> insufficient confidence
                </span>
                <span className="legend-item">
                    <span className="legend-line success" /> build success
                </span>
                <span className="legend-item">
                    <span className="legend-line failure" /> build failure
                </span>
            </div>
        </div>
    );
}
