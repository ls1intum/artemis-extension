import { useMemo, useRef, useState, useEffect, useCallback } from 'react';
import type { Annotation, RecordedEvent, EventType } from '../types';
import { ALL_LABELS } from '../types';
import { MARKER_COLORS, SWIM_LANE_TYPES } from '../constants';
import { formatOffset, shortenUri } from '../utils/format';
import { useTimelineZoom } from '../hooks/useTimelineZoom';

interface Props {
    events: RecordedEvent[];
    sessionStartTime: number;
    xDomain: [number, number];
    fullXDomain?: [number, number];
    annotations: Annotation[];
    enabledTypes: Set<EventType>;
    onAddAnnotation: (timestamp: number, text: string) => void;
    onUpdateAnnotation: (id: string, text: string) => void;
    onDeleteAnnotation: (id: string) => void;
    onViewInList?: (timestamp: number) => void;
    videoTimeRef?: React.RefObject<number>;
    onSeekVideo?: (timestamp: number) => void;
    videoTimeAtSessionStartSeconds?: number;
    onZoomChange?: (domain: [number, number] | null) => void;
}

interface Bin {
    x: number;               // pixel position
    count: number;
    breakdown: Map<EventType, number>;
    firstTimestamp: number;   // absolute timestamp of earliest event in bin
    events: RecordedEvent[];  // actual events in this bin
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
            existing.events.push(e);
            if (e.timestamp < existing.firstTimestamp) existing.firstTimestamp = e.timestamp;
        } else {
            const breakdown = new Map<EventType, number>();
            breakdown.set(type, 1);
            binMap.set(px, { x: px, count: 1, breakdown, firstTimestamp: e.timestamp, events: [e] });
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

const MAX_TOOLTIP_EVENTS = 5;

function eventSummary(event: RecordedEvent, sessionStartTime: number): React.ReactNode {
    const time = formatOffset(event.timestamp - sessionStartTime);
    switch (event.type) {
        case 'textChange': {
            let inserted = 0, deleted = 0;
            for (const c of event.changes) { inserted += c.text.length; deleted += c.rangeLength; }
            const op = inserted > 0 && deleted > 0 ? `replaced ${deleted} → ${inserted} chars`
                : inserted > 0 ? `+${inserted} chars` : `-${deleted} chars`;
            return <><span className="tt-time">{time}</span> {shortenUri(event.uri)} | {op}</>;
        }
        case 'save':
            return <><span className="tt-time">{time}</span> {shortenUri(event.uri)}</>;
        case 'diagnostics':
            return <><span className="tt-time">{time}</span> {shortenUri(event.uri)} | {event.diagnostics.length} diagnostic(s)</>;
        case 'fileSwitch':
            return <><span className="tt-time">{time}</span> {shortenUri(event.fromUri)} → {shortenUri(event.toUri)}</>;
        case 'buildResult':
            return <><span className="tt-time">{time}</span> {event.buildFailed ? 'BUILD FAILED' : event.successful ? 'PASSED' : `${event.errorCount} error(s)`}</>;
        case 'eqSnapshot':
            return <><span className="tt-time">{time}</span> EQ: {Math.round(event.eq * 100)}% ({event.confidence})</>;
        case 'eqEngineState':
            return <><span className="tt-time">{time}</span> EQ: {Math.round(event.currentEQ * 100)}% | {event.snapshots.length} snapshot(s)</>;
        case 'sessionStart':
            return <><span className="tt-time">{time}</span> Exercise {event.exerciseId}{event.participantId ? ` | ${event.participantId}` : ''}</>;
        case 'sessionEnd':
            return <><span className="tt-time">{time}</span> Exercise {event.exerciseId}</>;
        case 'irisChatMessage':
            return <><span className="tt-time">{time}</span> {event.direction === 'sent' ? 'SENT' : 'RECV'}: {event.content.length > 50 ? event.content.slice(0, 50) + '...' : event.content}</>;
        case 'windowFocus':
            return <><span className="tt-time">{time}</span> {event.focused ? 'focused' : 'blurred'}</>;
        case 'fileSnapshot':
            return <><span className="tt-time">{time}</span> {shortenUri(event.uri)}</>;
        case 'selectionChange':
            return <><span className="tt-time">{time}</span> {shortenUri(event.uri)} | L{event.selections[0]?.startLine ?? 0}{event.kind ? ` (${event.kind})` : ''}</>;
        case 'visibleRangeChange':
            return <><span className="tt-time">{time}</span> {shortenUri(event.uri)} | L{event.visibleRanges[0]?.startLine ?? 0}-L{event.visibleRanges[0]?.endLine ?? 0}</>;
        case 'intervention':
            return <><span className="tt-time">{time}</span> {event.action} | {event.level} | EQ: {Math.round(event.eq * 100)}%{event.triggerType ? ` | ${event.triggerType}` : ''}</>;
        case 'viewNavigation':
            return <><span className="tt-time">{time}</span> {event.from} → {event.to}</>;
        case 'panelVisibility':
            return <><span className="tt-time">{time}</span> {event.panel} | {event.visible ? 'visible' : 'hidden'}</>;
        case 'terminalCommand':
            return <><span className="tt-time">{time}</span> <code>{event.command.length > 40 ? event.command.slice(0, 40) + '...' : event.command}</code> exit: {event.exitCode ?? '?'}</>;
        case 'terminalOpenClose':
            return <><span className="tt-time">{time}</span> {event.action} | {event.terminalName}</>;
        default:
            return <span className="tt-time">{time}</span>;
    }
}

export function TrackingTimeline({
    events,
    sessionStartTime,
    xDomain,
    fullXDomain,
    annotations,
    enabledTypes,
    onAddAnnotation,
    onUpdateAnnotation,
    onDeleteAnnotation,
    onViewInList,
    videoTimeRef,
    onSeekVideo,
    videoTimeAtSessionStartSeconds,
    onZoomChange,
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

    // Zoom/pan state
    const isPanningRef = useRef(false);
    const panStartXRef = useRef(0);
    const panStartDomainRef = useRef<[number, number]>([0, 0]);

    const isZoomed = fullXDomain != null && (xDomain[0] !== fullXDomain[0] || xDomain[1] !== fullXDomain[1]);

    // Pinch / Ctrl+Scroll zoom on the SVG container
    useTimelineZoom({ containerRef: svgContainerRef, xDomain, fullXDomain, svgWidth, onZoomChange });

    // Snapshot for pan global listeners (avoids stale closures)
    const panLatestRef = useRef({ onZoomChange, fullXDomain, xDomain, svgWidth });
    useEffect(() => {
        panLatestRef.current = { onZoomChange, fullXDomain, xDomain, svgWidth };
    }, [onZoomChange, fullXDomain, xDomain, svgWidth]);

    // Drag-to-pan
    const handlePanStart = useCallback((e: React.MouseEvent) => {
        if (!onZoomChange || !isZoomed || e.button !== 0) return;
        const target = e.target as SVGElement;
        if (target.classList.contains('event-dot') || target.closest?.('.annotation-popover')) return;

        isPanningRef.current = true;
        panStartXRef.current = e.clientX;
        panStartDomainRef.current = [...xDomain] as [number, number];
        e.preventDefault();
    }, [onZoomChange, isZoomed, xDomain]);

    // Global mouse listeners for pan (so dragging outside SVG still works)
    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (!isPanningRef.current) return;
            const { onZoomChange: zoomCb, fullXDomain: full, xDomain: domain, svgWidth: width } = panLatestRef.current;
            if (!zoomCb) return;
            const dx = e.clientX - panStartXRef.current;
            const [startMin, startMax] = panStartDomainRef.current;
            const range = startMax - startMin;
            if (width <= 0) return;
            const domainDelta = -(dx / width) * range;

            const bounds = full ?? domain;
            let newMin = startMin + domainDelta;
            let newMax = startMax + domainDelta;

            if (newMin < bounds[0]) {
                newMin = bounds[0];
                newMax = newMin + range;
            }
            if (newMax > bounds[1]) {
                newMax = bounds[1];
                newMin = newMax - range;
            }

            zoomCb([newMin, newMax]);
        };
        const handleMouseUp = () => {
            isPanningRef.current = false;
        };

        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);
        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };
    }, []);

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
                        style={{ display: 'block', cursor: isZoomed ? 'grab' : undefined }}
                        onDoubleClick={handleSvgDoubleClick}
                        onMouseDown={handlePanStart}
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
                        {annotationGroups.map((group, gi) => {
                            const firstLabel = group.annotations.find(a => a.label)?.label;
                            const labelColor = firstLabel
                                ? ALL_LABELS.find(l => l.value === firstLabel)?.color ?? '#38bdf8'
                                : '#38bdf8';
                            return (
                                <line
                                    key={`annot-${gi}`}
                                    x1={group.x}
                                    y1={0}
                                    x2={group.x}
                                    y2={visibleLanes.length * LANE_HEIGHT}
                                    stroke={labelColor}
                                    strokeWidth={1.5}
                                    strokeDasharray="3 3"
                                    strokeOpacity={0.7}
                                    style={{ cursor: 'pointer' }}
                                    onClick={(e) => handleAnnotLineClick(e, group.annotations)}
                                />
                            );
                        })}

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
                                {videoTimeAtSessionStartSeconds != null && (
                                    <span className="tooltip-video-time">
                                        {' '}| Video: {formatOffset(((tooltip.bin.firstTimestamp - sessionStartTime) / 1000 + videoTimeAtSessionStartSeconds) * 1000)}
                                    </span>
                                )}
                            </div>
                            <div className="tooltip-events">
                                {tooltip.bin.events.slice(0, MAX_TOOLTIP_EVENTS).map((evt, i) => (
                                    <div key={i} className="tooltip-event-line">
                                        {eventSummary(evt, sessionStartTime)}
                                    </div>
                                ))}
                                {tooltip.bin.events.length > MAX_TOOLTIP_EVENTS && (
                                    <div className="tooltip-event-line tooltip-more">
                                        +{tooltip.bin.events.length - MAX_TOOLTIP_EVENTS} more
                                    </div>
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

            {/* Hints */}
            <p className="timeline-seek-hint">
                {onZoomChange && 'Pinch or Ctrl+Scroll to zoom'}
                {onZoomChange && isZoomed && ' \u00b7 Drag to pan'}
                {onSeekVideo && onZoomChange && ' \u00b7 '}
                {onSeekVideo && 'Double-click to jump video'}
            </p>

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
