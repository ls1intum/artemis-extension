import { useMemo, useRef, useState, useEffect, useCallback } from 'react';
import type { Annotation, RecordedEvent, EventType } from '../types';
import { SWIM_LANE_TYPES } from '../constants';
import { formatOffset } from '../utils/format';
import { eventSummary } from '../utils/eventDisplay';
import { EventBadge } from './EventBadge';
import { useTimelinePan } from '../hooks/useTimelinePan';
import {
    AXIS_HEIGHT,
    LABEL_WIDTH,
    LANE_HEIGHT,
    buildAnnotationGroups,
    buildBins,
    generateTicks,
    groupEventsByType,
    hitTestAnnotation,
    hitTestDot,
    orderTypesActiveFirst,
    timeToX,
    xToTime,
    type AnnotationGroup,
    type Bin,
} from '../utils/timelineLayout';
import { drawTimeline, readCanvasTheme, type CanvasTheme } from '../utils/canvasDraw';

interface Props {
    events: RecordedEvent[];
    sessionStartTime: number;
    xDomain: [number, number];
    fullXDomain?: [number, number];
    annotations: Annotation[];
    enabledTypes: Set<EventType>;
    /** When true, only lanes with events are shown (the empty ones are hidden). */
    hideEmptyLanes?: boolean;
    pendingTimestamp?: number | null;
    onSetPendingPosition?: (timestamp: number) => void;
    onUpdateAnnotation?: (id: string, text: string) => void;
    onDeleteAnnotation?: (id: string) => void;
    readOnly?: boolean;
    onViewInList?: (timestamp: number) => void;
    videoTimeRef?: React.RefObject<number>;
    onSeekVideo?: (timestamp: number) => void;
    videoTimeAtSessionStartSeconds?: number;
    onZoomChange?: (domain: [number, number] | null) => void;
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

const MAX_TOOLTIP_EVENTS = 5;

export function TrackingTimeline({
    events,
    sessionStartTime,
    xDomain,
    fullXDomain,
    annotations,
    enabledTypes,
    hideEmptyLanes = false,
    pendingTimestamp,
    onSetPendingPosition,
    onUpdateAnnotation,
    onDeleteAnnotation,
    readOnly,
    onViewInList,
    videoTimeRef,
    onSeekVideo,
    videoTimeAtSessionStartSeconds,
    onZoomChange,
}: Props) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const canvasContainerRef = useRef<HTMLDivElement>(null);
    const playheadRef = useRef<HTMLDivElement>(null);

    const [timelineWidth, setTimelineWidth] = useState(0);
    const [dprTick, setDprTick] = useState(0);
    const [tooltip, setTooltip] = useState<TooltipData | null>(null);
    const [annotPopover, setAnnotPopover] = useState<AnnotationPopover | null>(null);
    const [hoveredDotKey, setHoveredDotKey] = useState<string | null>(null);
    const [editingAnnotId, setEditingAnnotId] = useState<string | null>(null);
    const [editText, setEditText] = useState('');

    // Pre-group events by type once per event-list change. Avoids a full
    // events.filter pass per lane on every xDomain/zoom/pan update.
    const eventsByType = useMemo(() => groupEventsByType(events), [events]);

    // Visible lanes: every enabled type is shown (even with no events), with the
    // empty ones sorted to the bottom while keeping the curated order otherwise.
    // When hideEmptyLanes is on, the empty lanes are dropped entirely.
    const visibleLanes = useMemo(() => {
        const enabled = SWIM_LANE_TYPES.filter(t => enabledTypes.has(t));
        if (hideEmptyLanes) {
            return enabled.filter(t => eventsByType.has(t));
        }
        return orderTypesActiveFirst(enabled, t => eventsByType.has(t));
    }, [eventsByType, enabledTypes, hideEmptyLanes]);

    const laneBins = useMemo(() => {
        const result = new Map<EventType, Bin[]>();
        for (const type of visibleLanes) {
            const ofType = eventsByType.get(type) ?? [];
            result.set(type, buildBins(ofType, type, sessionStartTime, xDomain, timelineWidth));
        }
        return result;
    }, [eventsByType, visibleLanes, sessionStartTime, xDomain, timelineWidth]);

    // Annotations are clustered by pixel distance, not by time.
    const annotationGroups = useMemo<AnnotationGroup[]>(
        () => buildAnnotationGroups(annotations, sessionStartTime, xDomain, timelineWidth),
        [annotations, sessionStartTime, xDomain, timelineWidth],
    );

    const ticks = useMemo(() => generateTicks(xDomain, timelineWidth), [xDomain, timelineWidth]);

    const totalHeight = visibleLanes.length * LANE_HEIGHT + AXIS_HEIGHT;

    // Single-source pan predicate: block pan-start when over a dot or annotation line.
    const suppressPanPredicate = useCallback((e: React.MouseEvent) => {
        const rect = canvasContainerRef.current?.getBoundingClientRect();
        if (!rect) return false;
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        if (hitTestDot(x, y, visibleLanes, laneBins)) return true;
        if (hitTestAnnotation(x, y, visibleLanes, annotationGroups)) return true;
        return false;
    }, [visibleLanes, laneBins, annotationGroups]);

    const { handlePanStart, isZoomed, didPanRef } = useTimelinePan({
        xDomain,
        fullXDomain,
        svgWidth: timelineWidth,
        onZoomChange,
        suppressPanPredicate,
    });

    // Measure canvas container width (CSS pixels)
    useEffect(() => {
        const el = canvasContainerRef.current;
        if (!el) return;
        const observer = new ResizeObserver(entries => {
            for (const entry of entries) {
                setTimelineWidth(entry.contentRect.width);
            }
        });
        observer.observe(el);
        return () => observer.disconnect();
    }, []);

    // React to DPR changes (monitor swap, browser zoom)
    useEffect(() => {
        if (typeof window === 'undefined' || !window.matchMedia) return;
        const mql = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
        const onChange = () => setDprTick(t => t + 1);
        mql.addEventListener?.('change', onChange);
        return () => mql.removeEventListener?.('change', onChange);
    }, [dprTick]);

    // Playhead animation loop, drawn as a DOM overlay rather than on the canvas.
    useEffect(() => {
        if (!videoTimeRef || !playheadRef.current) return;
        let rafId: number;
        const animate = () => {
            const ts = videoTimeRef.current;
            const offset = ts - sessionStartTime;
            const [min, max] = xDomain;
            const range = max - min;
            if (range > 0 && playheadRef.current) {
                const x = ((offset - min) / range) * timelineWidth;
                if (x < 0 || x > timelineWidth) {
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
    }, [videoTimeRef, sessionStartTime, xDomain, timelineWidth]);

    // Latest-draw ref: keeps the pending rAF from drawing with stale state.
    const latestDrawRef = useRef<() => void>(() => {});
    const rafIdRef = useRef<number | null>(null);

    useEffect(() => {
        return () => {
            if (rafIdRef.current != null) {
                cancelAnimationFrame(rafIdRef.current);
                rafIdRef.current = null;
            }
        };
    }, []);

    // Assemble draw closure on every render; pending rAF calls the latest.
    useEffect(() => {
        latestDrawRef.current = () => {
            const canvas = canvasRef.current;
            if (!canvas) return;
            if (timelineWidth <= 0 || visibleLanes.length === 0) return;

            const dpr = window.devicePixelRatio || 1;
            const backingW = Math.ceil(timelineWidth * dpr);
            const backingH = Math.ceil(totalHeight * dpr);
            if (canvas.width !== backingW) canvas.width = backingW;
            if (canvas.height !== backingH) canvas.height = backingH;
            canvas.style.width = `${timelineWidth}px`;
            canvas.style.height = `${totalHeight}px`;

            const ctx = canvas.getContext('2d');
            if (!ctx) return;
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

            const theme: CanvasTheme = readCanvasTheme();

            drawTimeline({
                ctx,
                timelineWidth,
                visibleLanes,
                laneBins,
                annotationGroups,
                ticks,
                xDomain,
                hoveredDotKey,
                theme,
            });
        };

        if (rafIdRef.current != null) return;
        rafIdRef.current = requestAnimationFrame(() => {
            rafIdRef.current = null;
            latestDrawRef.current();
        });
    }, [
        timelineWidth,
        totalHeight,
        visibleLanes,
        laneBins,
        annotationGroups,
        ticks,
        xDomain,
        hoveredDotKey,
        dprTick,
    ]);

    const [hoveringTooltip, setHoveringTooltip] = useState(false);
    const [pendingTooltip, setPendingTooltip] = useState<TooltipData | null>(null);

    // Mouse-move hit-test: imperative cursor, batched React state.
    const moveRafRef = useRef<number | null>(null);
    const latestMouseRef = useRef<{ x: number; y: number; clientX: number; clientY: number } | null>(null);
    const lastDotKeyRef = useRef<string | null>(null);

    // Reset transient hover/tooltip state when geometry or data changes.
    // State is reset in render per React 19 guidance
    // (react.dev: "Resetting all state when a prop changes");
    // refs are cleared in a companion effect because refs cannot be
    // mutated during render.
    const [prevResetToken, setPrevResetToken] = useState<unknown[]>([xDomain, events, enabledTypes, timelineWidth, annotations]);
    const currentResetToken = [xDomain, events, enabledTypes, timelineWidth, annotations];
    const resetTokenChanged =
        prevResetToken[0] !== currentResetToken[0] ||
        prevResetToken[1] !== currentResetToken[1] ||
        prevResetToken[2] !== currentResetToken[2] ||
        prevResetToken[3] !== currentResetToken[3] ||
        prevResetToken[4] !== currentResetToken[4];
    if (resetTokenChanged) {
        setPrevResetToken(currentResetToken);
        setTooltip(null);
        setAnnotPopover(null);
        setHoveredDotKey(null);
        setPendingTooltip(null);
    }
    useEffect(() => {
        lastDotKeyRef.current = null;
        latestMouseRef.current = null;
    }, [prevResetToken]);

    useEffect(() => {
        if (pendingTooltip || hoveringTooltip) return;
        const timer = setTimeout(() => setTooltip(null), 200);
        return () => clearTimeout(timer);
    }, [pendingTooltip, hoveringTooltip]);

    const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
        const rect = canvasContainerRef.current?.getBoundingClientRect();
        if (!rect) return;
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        latestMouseRef.current = { x, y, clientX: e.clientX, clientY: e.clientY };

        const dotHit = hitTestDot(x, y, visibleLanes, laneBins);
        const annotHit = !dotHit ? hitTestAnnotation(x, y, visibleLanes, annotationGroups) : null;

        const canvas = canvasRef.current;
        if (canvas) {
            canvas.style.cursor = dotHit || annotHit ? 'pointer' : (isZoomed ? 'grab' : 'default');
        }

        if (moveRafRef.current != null) return;
        moveRafRef.current = requestAnimationFrame(() => {
            moveRafRef.current = null;
            const m = latestMouseRef.current;
            if (!m) return;
            const d = hitTestDot(m.x, m.y, visibleLanes, laneBins);
            const newKey = d?.key ?? null;
            if (newKey !== lastDotKeyRef.current) {
                lastDotKeyRef.current = newKey;
                setHoveredDotKey(newKey);
                if (d) {
                    const data: TooltipData = { x: m.x, y: m.y, bin: d.bin, laneType: d.type };
                    setTooltip(data);
                    setPendingTooltip(data);
                } else {
                    setPendingTooltip(null);
                }
            }
        });
    }, [visibleLanes, laneBins, annotationGroups, isZoomed]);

    const handleMouseLeave = useCallback(() => {
        if (moveRafRef.current != null) {
            cancelAnimationFrame(moveRafRef.current);
            moveRafRef.current = null;
        }
        lastDotKeyRef.current = null;
        setHoveredDotKey(null);
        setPendingTooltip(null);
        const canvas = canvasRef.current;
        if (canvas) canvas.style.cursor = isZoomed ? 'grab' : 'default';
    }, [isZoomed]);

    useEffect(() => {
        return () => {
            if (moveRafRef.current != null) cancelAnimationFrame(moveRafRef.current);
        };
    }, []);

    // Canvas click: annotation popover, else set a pending position; shift+click additionally seeks
    const handleCanvasClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
        // A click that concludes a drag-pan must be fully swallowed: no pending set, no popover, no seek.
        if (didPanRef.current) { didPanRef.current = false; return; }
        const rect = canvasContainerRef.current?.getBoundingClientRect();
        if (!rect) return;
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        const annotHit = hitTestAnnotation(x, y, visibleLanes, annotationGroups);

        if (annotHit) {
            setAnnotPopover({ x, y, annotations: annotHit.group.annotations });
        } else if (!e.shiftKey && onSetPendingPosition) {
            const ts = xToTime(x, sessionStartTime, xDomain, timelineWidth);
            if (ts != null) onSetPendingPosition(ts);
        }

        // Shift+click additionally seeks the video to the click position; dots
        // do not stopPropagation, so a dot click seeks too.
        if (e.shiftKey && onSeekVideo) {
            const ts = xToTime(x, sessionStartTime, xDomain, timelineWidth);
            if (ts != null) onSeekVideo(ts);
        }
    }, [didPanRef, visibleLanes, annotationGroups, onSetPendingPosition, onSeekVideo, sessionStartTime, xDomain, timelineWidth]);

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
                <div className="lane-labels">
                    {visibleLanes.map(type => (
                        <div
                            key={type}
                            className={`lane-label${eventsByType.has(type) ? '' : ' empty'}`}
                            style={{ height: LANE_HEIGHT }}
                        >
                            <EventBadge type={type} title={type} />
                        </div>
                    ))}
                    <div className="lane-label axis-label" style={{ height: AXIS_HEIGHT }} />
                </div>

                {/* Canvas area. Pointer handlers live on the <canvas> itself
                    so that events originating inside DOM overlays (tooltip,
                    annotation popover) do not bubble into timeline hit-tests. */}
                <div
                    className="lane-svg-container"
                    ref={canvasContainerRef}
                    style={{ position: 'relative' }}
                >
                    <canvas
                        ref={canvasRef}
                        style={{ display: 'block', width: '100%', height: totalHeight }}
                        onClick={handleCanvasClick}
                        onMouseDown={handlePanStart}
                        onMouseMove={handleMouseMove}
                        onMouseLeave={handleMouseLeave}
                    />

                    {videoTimeRef && (
                        <div
                            ref={playheadRef}
                            className="playhead-line"
                            style={{ height: visibleLanes.length * LANE_HEIGHT, display: 'none' }}
                        />
                    )}

                    {/* Pending placement ghost line */}
                    {(() => {
                        const px = pendingTimestamp != null
                            ? timeToX(pendingTimestamp, sessionStartTime, xDomain, timelineWidth)
                            : null;
                        if (px == null || px < 0 || px > timelineWidth) return null;
                        return (
                            <>
                                <div
                                    className="pending-line"
                                    style={{ transform: `translateX(${px}px)`, height: visibleLanes.length * LANE_HEIGHT }}
                                />
                                <div
                                    className="pending-line-label"
                                    style={{ transform: `translateX(${px}px)` }}
                                >
                                    {formatOffset(pendingTimestamp! - sessionStartTime)}
                                </div>
                            </>
                        );
                    })()}

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
                                <EventBadge type={tooltip.laneType} />
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

                    {annotPopover && (
                        <div
                            className="annotation-popover"
                            style={{ left: annotPopover.x + 8, top: annotPopover.y - 10 }}
                        >
                            {annotPopover.annotations.map(a => (
                                <div key={a.id} className="annotation-popover-item">
                                    {editingAnnotId === a.id && !readOnly && onUpdateAnnotation ? (
                                        <div className="annotation-popover-edit">
                                            <input
                                                autoFocus
                                                className="annotation-input"
                                                value={editText}
                                                onChange={e => setEditText(e.target.value)}
                                                onKeyDown={e => {
                                                    if (e.key === 'Enter' && editText.trim()) {
                                                        onUpdateAnnotation?.(a.id, editText.trim());
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
                                                    onUpdateAnnotation?.(a.id, editText.trim());
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
                                            {!readOnly && onUpdateAnnotation && (
                                                <button
                                                    className="annotation-action-btn edit"
                                                    onClick={() => { setEditingAnnotId(a.id); setEditText(a.text); }}
                                                    title="Edit"
                                                >
                                                    &#9998;
                                                </button>
                                            )}
                                            {!readOnly && onDeleteAnnotation && (
                                                <button
                                                    className="annotation-action-btn delete"
                                                    onClick={() => {
                                                        onDeleteAnnotation?.(a.id);
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
                                            )}
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

            <p className="timeline-seek-hint">
                {isZoomed && 'Drag to pan'}
                {isZoomed && onSeekVideo && ' \u00b7 '}
                {onSeekVideo && 'Shift+Click to jump video'}
                {onSetPendingPosition && (onSeekVideo || isZoomed) && ' \u00b7 '}
                {onSetPendingPosition && (
                    pendingTimestamp != null
                        ? `Marked ${formatOffset(pendingTimestamp - sessionStartTime)} \u00b7 press 1-5 / q-u to place \u00b7 Esc to cancel`
                        : onSeekVideo
                            ? 'Press 1-5 / q-u to place at the playhead \u00b7 click to mark a precise spot'
                            : 'Click to mark a spot, then press a label key'
                )}
            </p>
        </div>
    );
}
