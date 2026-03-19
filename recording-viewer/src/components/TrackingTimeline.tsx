import { useMemo, useRef, useState, useEffect, useCallback } from 'react';
import type { Annotation, RecordedEvent, EventType } from '../types';
import { MARKER_COLORS, SWIM_LANE_TYPES } from '../constants';
import { formatOffset } from '../utils/format';

interface Props {
    events: RecordedEvent[];
    sessionStartTime: number;
    xDomain: [number, number];
    annotations: Annotation[];
    enabledTypes: Set<EventType>;
    onAddAnnotation: (timestamp: number, text: string) => void;
    onUpdateAnnotation: (id: string, text: string) => void;
    onDeleteAnnotation: (id: string) => void;
    onViewInList?: (timestamp: number) => void;
    videoTimeRef?: React.RefObject<number>;
    onSeekVideo?: (timestamp: number) => void;
    videoTimeAtSessionStartSeconds?: number;
}

interface Bin {
    x: number;               // pixel position
    count: number;
    breakdown: Map<EventType, number>;
    firstTimestamp: number;   // absolute timestamp of earliest event in bin
}

interface TooltipData {
    x: number;
    y: number;
    bin: Bin;
    laneType: EventType;
}

interface AnnotationPopover {
    x: number;
    y: number;
    annotations: Annotation[];
}

const LANE_HEIGHT = 28;
const LABEL_WIDTH = 140;
const AXIS_HEIGHT = 28;
const DOT_RADIUS = 4;
const DOT_RADIUS_DENSE = 6;
const DENSE_THRESHOLD = 3;

function timeToX(timestamp: number, sessionStartTime: number, xDomain: [number, number], svgWidth: number): number {
    const offset = timestamp - sessionStartTime;
    const [min, max] = xDomain;
    const range = max - min;
    if (range <= 0) return 0;
    return ((offset - min) / range) * svgWidth;
}

function buildBins(
    events: RecordedEvent[],
    type: EventType,
    sessionStartTime: number,
    xDomain: [number, number],
    svgWidth: number,
): Bin[] {
    const filtered = events.filter(e => e.type === type);
    if (filtered.length === 0 || svgWidth <= 0) return [];

    const binMap = new Map<number, Bin>();
    for (const e of filtered) {
        const px = Math.round(timeToX(e.timestamp, sessionStartTime, xDomain, svgWidth));
        const existing = binMap.get(px);
        if (existing) {
            existing.count++;
            existing.breakdown.set(type, (existing.breakdown.get(type) ?? 0) + 1);
            if (e.timestamp < existing.firstTimestamp) existing.firstTimestamp = e.timestamp;
        } else {
            const breakdown = new Map<EventType, number>();
            breakdown.set(type, 1);
            binMap.set(px, { x: px, count: 1, breakdown, firstTimestamp: e.timestamp });
        }
    }
    return [...binMap.values()];
}

function generateTicks(xDomain: [number, number], svgWidth: number): number[] {
    const [min, max] = xDomain;
    const range = max - min;
    if (range <= 0 || svgWidth <= 0) return [];

    // Target ~80px between ticks
    const approxTickCount = Math.max(2, Math.floor(svgWidth / 80));
    const rawInterval = range / approxTickCount;

    // Snap to nice intervals (in ms): 5s, 10s, 15s, 30s, 1m, 2m, 5m, 10m, 15m, 30m, 1h
    const niceIntervals = [5000, 10000, 15000, 30000, 60000, 120000, 300000, 600000, 900000, 1800000, 3600000];
    let interval = niceIntervals[niceIntervals.length - 1];
    for (const ni of niceIntervals) {
        if (ni >= rawInterval) { interval = ni; break; }
    }

    const ticks: number[] = [];
    const start = Math.ceil(min / interval) * interval;
    for (let t = start; t <= max; t += interval) {
        ticks.push(t);
    }
    return ticks;
}

export function TrackingTimeline({
    events,
    sessionStartTime,
    xDomain,
    annotations,
    enabledTypes,
    onAddAnnotation,
    onUpdateAnnotation,
    onDeleteAnnotation,
    onViewInList,
    videoTimeRef,
    onSeekVideo,
    videoTimeAtSessionStartSeconds,
}: Props) {
    const svgRef = useRef<SVGSVGElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const svgContainerRef = useRef<HTMLDivElement>(null);
    const playheadRef = useRef<HTMLDivElement>(null);
    const [svgWidth, setSvgWidth] = useState(0);
    const [tooltip, setTooltip] = useState<TooltipData | null>(null);
    const [annotPopover, setAnnotPopover] = useState<AnnotationPopover | null>(null);
    const [editingAnnotId, setEditingAnnotId] = useState<string | null>(null);
    const [editText, setEditText] = useState('');
    const [annotateTimestamp, setAnnotateTimestamp] = useState<number | null>(null);
    const [annotateText, setAnnotateText] = useState('');

    // Measure SVG container width (not the outer wrapper which includes the label column)
    useEffect(() => {
        const el = svgContainerRef.current;
        if (!el) return;
        const observer = new ResizeObserver(entries => {
            for (const entry of entries) {
                setSvgWidth(entry.contentRect.width);
            }
        });
        observer.observe(el);
        return () => observer.disconnect();
    }, []);

    // Playhead animation loop
    useEffect(() => {
        if (!videoTimeRef || !playheadRef.current) return;
        let rafId: number;
        const animate = () => {
            const ts = videoTimeRef.current;
            const offset = ts - sessionStartTime;
            const [min, max] = xDomain;
            const range = max - min;
            if (range > 0 && playheadRef.current) {
                const x = ((offset - min) / range) * svgWidth;
                if (x < 0 || x > svgWidth) {
                    playheadRef.current.style.display = 'none';
                } else {
                    playheadRef.current.style.display = 'block';
                    playheadRef.current.style.transform = `translateX(${x}px)`;
                }
            }
            rafId = requestAnimationFrame(animate);
        };
        rafId = requestAnimationFrame(animate);
        return () => cancelAnimationFrame(rafId);
    }, [videoTimeRef, sessionStartTime, xDomain, svgWidth]);

    // Visible lanes: only types that are enabled AND have events
    const visibleLanes = useMemo(() => {
        const typesWithEvents = new Set(events.map(e => e.type));
        return SWIM_LANE_TYPES.filter(t => enabledTypes.has(t) && typesWithEvents.has(t));
    }, [events, enabledTypes]);

    // Per-lane bins
    const laneBins = useMemo(() => {
        const result = new Map<EventType, Bin[]>();
        for (const type of visibleLanes) {
            result.set(type, buildBins(events, type, sessionStartTime, xDomain, svgWidth));
        }
        return result;
    }, [events, visibleLanes, sessionStartTime, xDomain, svgWidth]);

    // Axis ticks
    const ticks = useMemo(() => generateTicks(xDomain, svgWidth), [xDomain, svgWidth]);

    const totalHeight = visibleLanes.length * LANE_HEIGHT + AXIS_HEIGHT;

    // Track whether the mouse is over a dot or the tooltip itself.
    const [hoveringTooltip, setHoveringTooltip] = useState(false);
    const [pendingTooltip, setPendingTooltip] = useState<TooltipData | null>(null);

    const handleDotHover = useCallback((e: React.MouseEvent, bin: Bin, laneType: EventType) => {
        const rect = svgContainerRef.current?.getBoundingClientRect();
        if (!rect) return;
        const data: TooltipData = {
            x: e.clientX - rect.left,
            y: e.clientY - rect.top,
            bin,
            laneType,
        };
        setTooltip(data);
        setPendingTooltip(data);
    }, []);

    const handleDotLeave = useCallback(() => {
        setPendingTooltip(null);
    }, []);

    useEffect(() => {
        if (pendingTooltip || hoveringTooltip) return;
        const timer = setTimeout(() => setTooltip(null), 200);
        return () => clearTimeout(timer);
    }, [pendingTooltip, hoveringTooltip]);

    const handleAnnotLineClick = useCallback((e: React.MouseEvent, nearAnnotations: Annotation[]) => {
        const rect = svgContainerRef.current?.getBoundingClientRect();
        if (!rect) return;
        setAnnotPopover({
            x: e.clientX - rect.left,
            y: e.clientY - rect.top,
            annotations: nearAnnotations,
        });
    }, []);

    // Double-click on SVG background → seek video
    const handleSvgDoubleClick = useCallback((e: React.MouseEvent) => {
        if (!onSeekVideo || !svgContainerRef.current) return;
        const rect = svgContainerRef.current.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const [min, max] = xDomain;
        const range = max - min;
        if (range <= 0 || svgWidth <= 0) return;
        const offset = (x / svgWidth) * range + min;
        const timestamp = sessionStartTime + offset;
        onSeekVideo(timestamp);
    }, [onSeekVideo, xDomain, svgWidth, sessionStartTime]);

    // Annotation positions, grouped by pixel proximity (5px)
    const annotationGroups = useMemo(() => {
        if (svgWidth <= 0) return [];
        const groups: { x: number; annotations: Annotation[] }[] = [];
        const sorted = [...annotations].sort((a, b) => a.timestamp - b.timestamp);
        for (const a of sorted) {
            const x = timeToX(a.timestamp, sessionStartTime, xDomain, svgWidth);
            const existing = groups.find(g => Math.abs(g.x - x) < 5);
            if (existing) {
                existing.annotations.push(a);
            } else {
                groups.push({ x, annotations: [a] });
            }
        }
        return groups;
    }, [annotations, sessionStartTime, xDomain, svgWidth]);

    if (visibleLanes.length === 0) {
        return (
            <div className="tracking-timeline empty">
                <p className="empty-message">No event types selected</p>
            </div>
        );
    }

    return (
        <div className="tracking-timeline" ref={containerRef}>
            <div className="tracking-timeline-grid" style={{ display: 'grid', gridTemplateColumns: `${LABEL_WIDTH}px 1fr` }}>
                {/* Lane labels */}
                <div className="lane-labels">
                    {visibleLanes.map(type => (
                        <div key={type} className="lane-label" style={{ height: LANE_HEIGHT }}>
                            <span className={`event-badge ${type}`}>{type}</span>
                        </div>
                    ))}
                    <div className="lane-label axis-label" style={{ height: AXIS_HEIGHT }} />
                </div>

                {/* SVG area */}
                <div className="lane-svg-container" ref={svgContainerRef} style={{ position: 'relative' }}>
                    <svg
                        ref={svgRef}
                        width="100%"
                        height={totalHeight}
                        style={{ display: 'block' }}
                        onDoubleClick={handleSvgDoubleClick}
                    >
                        {/* Lane backgrounds (alternating) */}
                        {visibleLanes.map((type, i) => (
                            <rect
                                key={`bg-${type}`}
                                x={0}
                                y={i * LANE_HEIGHT}
                                width={svgWidth}
                                height={LANE_HEIGHT}
                                fill={i % 2 === 0 ? 'rgba(255,255,255,0.02)' : 'transparent'}
                            />
                        ))}

                        {/* Lane separator lines */}
                        {visibleLanes.map((_, i) => (
                            <line
                                key={`sep-${i}`}
                                x1={0}
                                y1={(i + 1) * LANE_HEIGHT}
                                x2={svgWidth}
                                y2={(i + 1) * LANE_HEIGHT}
                                stroke="var(--border)"
                                strokeOpacity={0.3}
                            />
                        ))}

                        {/* Annotation vertical lines */}
                        {annotationGroups.map((group, gi) => (
                            <line
                                key={`annot-${gi}`}
                                x1={group.x}
                                y1={0}
                                x2={group.x}
                                y2={visibleLanes.length * LANE_HEIGHT}
                                stroke="#38bdf8"
                                strokeWidth={1.5}
                                strokeDasharray="3 3"
                                strokeOpacity={0.7}
                                style={{ cursor: 'pointer' }}
                                onClick={(e) => handleAnnotLineClick(e, group.annotations)}
                            />
                        ))}

                        {/* Event dots per lane */}
                        {visibleLanes.map((type, laneIdx) => {
                            const bins = laneBins.get(type) ?? [];
                            const cy = laneIdx * LANE_HEIGHT + LANE_HEIGHT / 2;
                            const color = MARKER_COLORS[type];

                            return bins.map((bin, bi) => {
                                const isDense = bin.count >= DENSE_THRESHOLD;
                                const r = isDense ? DOT_RADIUS_DENSE : DOT_RADIUS;
                                const opacity = isDense ? 1 : 0.85;

                                return (
                                    <circle
                                        key={`${type}-${bi}`}
                                        cx={bin.x}
                                        cy={cy}
                                        r={r}
                                        fill={color}
                                        fillOpacity={opacity}
                                        className={isDense ? 'event-dot event-dot-dense' : 'event-dot'}
                                        onMouseEnter={(e) => handleDotHover(e, bin, type)}
                                        onMouseLeave={handleDotLeave}
                                        onClick={() => setAnnotateTimestamp(bin.firstTimestamp)}
                                        style={{ cursor: 'pointer' }}
                                    />
                                );
                            });
                        })}

                        {/* Time axis */}
                        <line
                            x1={0}
                            y1={visibleLanes.length * LANE_HEIGHT}
                            x2={svgWidth}
                            y2={visibleLanes.length * LANE_HEIGHT}
                            stroke="var(--border)"
                            strokeOpacity={0.5}
                        />
                        {ticks.map(t => {
                            const x = ((t - xDomain[0]) / (xDomain[1] - xDomain[0])) * svgWidth;
                            return (
                                <g key={t}>
                                    <line
                                        x1={x}
                                        y1={visibleLanes.length * LANE_HEIGHT}
                                        x2={x}
                                        y2={visibleLanes.length * LANE_HEIGHT + 5}
                                        stroke="var(--text-muted)"
                                        strokeOpacity={0.5}
                                    />
                                    <text
                                        x={x}
                                        y={visibleLanes.length * LANE_HEIGHT + 18}
                                        textAnchor="middle"
                                        fill="var(--text-muted)"
                                        fontSize={11}
                                        fontFamily="var(--mono)"
                                    >
                                        {formatOffset(t)}
                                    </text>
                                </g>
                            );
                        })}
                    </svg>

                    {/* Video playhead line */}
                    {videoTimeRef && (
                        <div
                            ref={playheadRef}
                            className="playhead-line"
                            style={{ height: visibleLanes.length * LANE_HEIGHT, display: 'none' }}
                        />
                    )}

                    {/* Tooltip */}
                    {tooltip && (
                        <div
                            className="timeline-tooltip"
                            style={{
                                left: tooltip.x + 12,
                                top: tooltip.y - 10,
                            }}
                            onMouseEnter={() => setHoveringTooltip(true)}
                            onMouseLeave={() => setHoveringTooltip(false)}
                        >
                            <div className="tooltip-type">
                                <span className={`event-badge ${tooltip.laneType}`}>{tooltip.laneType}</span>
                                <span className="tooltip-count">&times;{tooltip.bin.count}</span>
                            </div>
                            <div className="tooltip-time">
                                {formatOffset(tooltip.bin.firstTimestamp - sessionStartTime)}
                                {videoTimeAtSessionStartSeconds != null && (
                                    <span className="tooltip-video-time">
                                        {' '}| Video: {formatOffset(((tooltip.bin.firstTimestamp - sessionStartTime) / 1000 + videoTimeAtSessionStartSeconds) * 1000)}
                                    </span>
                                )}
                            </div>
                            {onViewInList && (
                                <button
                                    className="tooltip-link"
                                    onMouseDown={(e) => {
                                        e.preventDefault();
                                        setTooltip(null);
                                        onViewInList(tooltip.bin.firstTimestamp);
                                    }}
                                >
                                    View in list
                                </button>
                            )}
                        </div>
                    )}

                    {/* Annotation popover */}
                    {annotPopover && (
                        <div
                            className="annotation-popover"
                            style={{ left: annotPopover.x + 8, top: annotPopover.y - 10 }}
                        >
                            {annotPopover.annotations.map(a => (
                                <div key={a.id} className="annotation-popover-item">
                                    {editingAnnotId === a.id ? (
                                        <div className="annotation-popover-edit">
                                            <input
                                                autoFocus
                                                className="annotation-input"
                                                value={editText}
                                                onChange={e => setEditText(e.target.value)}
                                                onKeyDown={e => {
                                                    if (e.key === 'Enter' && editText.trim()) {
                                                        onUpdateAnnotation(a.id, editText.trim());
                                                        setEditingAnnotId(null);
                                                        setAnnotPopover(null);
                                                    }
                                                    if (e.key === 'Escape') setEditingAnnotId(null);
                                                }}
                                            />
                                            <button
                                                className="annotation-save-btn"
                                                disabled={!editText.trim()}
                                                onClick={() => {
                                                    onUpdateAnnotation(a.id, editText.trim());
                                                    setEditingAnnotId(null);
                                                    setAnnotPopover(null);
                                                }}
                                            >
                                                Save
                                            </button>
                                        </div>
                                    ) : (
                                        <>
                                            <span className="annotation-popover-time">
                                                {formatOffset(a.timestamp - sessionStartTime)}
                                            </span>
                                            <span className="annotation-popover-text">{a.text}</span>
                                            <button
                                                className="annotation-action-btn edit"
                                                onClick={() => { setEditingAnnotId(a.id); setEditText(a.text); }}
                                                title="Edit"
                                            >
                                                &#9998;
                                            </button>
                                            <button
                                                className="annotation-action-btn delete"
                                                onClick={() => {
                                                    onDeleteAnnotation(a.id);
                                                    setAnnotPopover(prev => {
                                                        if (!prev) return null;
                                                        const remaining = prev.annotations.filter(ann => ann.id !== a.id);
                                                        return remaining.length > 0 ? { ...prev, annotations: remaining } : null;
                                                    });
                                                }}
                                                title="Delete"
                                            >
                                                &times;
                                            </button>
                                        </>
                                    )}
                                </div>
                            ))}
                            <button className="annotation-popover-close" onClick={() => setAnnotPopover(null)}>
                                Close
                            </button>
                        </div>
                    )}
                </div>
            </div>

            {/* Hint for double-click seek */}
            {onSeekVideo && (
                <p className="timeline-seek-hint">Double-click timeline to jump video</p>
            )}

            {/* Annotate from dot click */}
            {annotateTimestamp !== null && (
                <div className="tracking-annotate-form">
                    <span className="mono" style={{ flexShrink: 0, color: 'var(--text-muted)', fontSize: 11 }}>
                        {formatOffset(annotateTimestamp - sessionStartTime)}
                    </span>
                    <input
                        autoFocus
                        className="annotation-input"
                        placeholder="Annotation text..."
                        value={annotateText}
                        onChange={e => setAnnotateText(e.target.value)}
                        onKeyDown={e => {
                            if (e.key === 'Enter' && annotateText.trim()) {
                                onAddAnnotation(annotateTimestamp, annotateText.trim());
                                setAnnotateTimestamp(null);
                                setAnnotateText('');
                            }
                            if (e.key === 'Escape') {
                                setAnnotateTimestamp(null);
                                setAnnotateText('');
                            }
                        }}
                    />
                    <button
                        className="annotation-save-btn"
                        disabled={!annotateText.trim()}
                        onClick={() => {
                            onAddAnnotation(annotateTimestamp, annotateText.trim());
                            setAnnotateTimestamp(null);
                            setAnnotateText('');
                        }}
                    >
                        Add
                    </button>
                    <button
                        className="annotation-cancel-btn"
                        onClick={() => { setAnnotateTimestamp(null); setAnnotateText(''); }}
                    >
                        Cancel
                    </button>
                </div>
            )}
        </div>
    );
}
