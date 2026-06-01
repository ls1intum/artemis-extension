import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
import type { Annotation, RecordedEvent, EventType } from '../types.ts';
import { ALL_LABELS } from '../types.ts';
import { formatOffset } from '../utils/format.ts';
import { eventDetail } from '../utils/eventDisplay.tsx';
import { EventBadge } from './EventBadge.tsx';

interface Props {
    events: RecordedEvent[];
    sessionStartTime: number;
    annotations: Annotation[];
    enabledTypes: Set<EventType>;
    onAddAnnotation?: (timestamp: number, text: string) => void;
    onUpdateAnnotation?: (id: string, text: string) => void;
    onDeleteAnnotation?: (id: string) => void;
    readOnly?: boolean;
    scrollToTimestamp?: number | null;
    onScrollComplete?: () => void;
    videoTimeRef?: React.RefObject<number>;
    isVideoPlaying?: boolean;
    onSeekVideo?: (timestamp: number) => void;
}

type StreamItem =
    | { kind: 'event'; event: RecordedEvent; key: string }
    | { kind: 'annotation'; annotation: Annotation };

/**
 * Stable id assigned to each event the first time we see it. Survives
 * ringbuffer trimming and is collision-free even when high-frequency
 * telemetry produces same-timestamp same-type events (e.g. multiple
 * textChange / diagnostics events at the same ms during a burst).
 *
 * A WeakMap keyed on the event object lets us assign once and reuse
 * across renders without mutating the event itself. Once the event
 * is dropped from the live buffer the entry is garbage-collected.
 */
function makeEventKeyer(): (ev: RecordedEvent) => string {
    const ids = new WeakMap<RecordedEvent, string>();
    let next = 0;
    return (ev) => {
        let id = ids.get(ev);
        if (id === undefined) {
            id = `e${next++}`;
            ids.set(ev, id);
        }
        return id;
    };
}

// Strip ANSI escape sequences and common shell integration markers from terminal output
function stripAnsi(text: string): string {
    /* eslint-disable no-control-regex */
    return text
        // OSC sequences (e.g. \x1b]633;....\x07)
        .replace(/\x1b\][^\x07]*\x07/g, '')
        // CSI sequences (e.g. \x1b[1m, \x1b[27m)
        .replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')
        // Carriage returns used for line clearing
        .replace(/\r(?!\n)/g, '')
        .trim();
    /* eslint-enable no-control-regex */
}

function InlineAnnotationInput({ onSubmit, onCancel }: {
    onSubmit: (text: string) => void;
    onCancel: () => void;
}) {
    const [text, setText] = useState('');

    return (
        <div className="annotation-input-row">
            <input
                autoFocus
                className="annotation-input"
                placeholder="Annotation..."
                value={text}
                onChange={e => setText(e.target.value)}
                onKeyDown={e => {
                    if (e.key === 'Enter' && text.trim()) onSubmit(text.trim());
                    if (e.key === 'Escape') onCancel();
                }}
            />
            <button
                className="annotation-save-btn"
                disabled={!text.trim()}
                onClick={() => text.trim() && onSubmit(text.trim())}
            >
                Save
            </button>
            <button className="annotation-cancel-btn" onClick={onCancel}>Cancel</button>
        </div>
    );
}

function AnnotationRow({ annotation, sessionStartTime, onUpdate, onDelete, readOnly }: {
    annotation: Annotation;
    sessionStartTime: number;
    onUpdate?: (id: string, text: string) => void;
    onDelete?: (id: string) => void;
    readOnly?: boolean;
}) {
    const [editing, setEditing] = useState(false);
    const [editText, setEditText] = useState(annotation.text);

    if (editing && !readOnly && onUpdate) {
        return (
            <div className="event-row annotation-row editing">
                <span className="event-time mono">
                    {formatOffset(annotation.timestamp - sessionStartTime)}
                </span>
                <span className="event-badge annotation">NOTE</span>
                <input
                    autoFocus
                    className="annotation-input annotation-edit-input"
                    value={editText}
                    onChange={e => setEditText(e.target.value)}
                    onKeyDown={e => {
                        if (e.key === 'Enter' && editText.trim()) {
                            onUpdate?.(annotation.id, editText.trim());
                            setEditing(false);
                        }
                        if (e.key === 'Escape') {
                            setEditText(annotation.text);
                            setEditing(false);
                        }
                    }}
                />
                <button
                    className="annotation-save-btn"
                    disabled={!editText.trim()}
                    onClick={() => { onUpdate?.(annotation.id, editText.trim()); setEditing(false); }}
                >
                    Save
                </button>
                <button
                    className="annotation-cancel-btn"
                    onClick={() => { setEditText(annotation.text); setEditing(false); }}
                >
                    Cancel
                </button>
            </div>
        );
    }

    const labelInfo = annotation.label ? ALL_LABELS.find(l => l.value === annotation.label) : null;

    return (
        <div className="event-row annotation-row">
            <span className="event-time mono">
                {formatOffset(annotation.timestamp - sessionStartTime)}
            </span>
            {labelInfo ? (
                <span className="event-badge annotation-label" style={{ background: labelInfo.color + '25', color: labelInfo.color }}>
                    {labelInfo.label}
                </span>
            ) : (
                <span className="event-badge annotation">NOTE</span>
            )}
            <span
                className="annotation-text"
                onClick={!readOnly && onUpdate ? () => setEditing(true) : undefined}
                title={!readOnly && onUpdate ? 'Click to edit' : undefined}
            >
                {annotation.text}
            </span>
            {!readOnly && (
                <div className="annotation-actions">
                    {onUpdate && (
                        <button className="annotation-action-btn edit" onClick={() => setEditing(true)} title="Edit">&#9998;</button>
                    )}
                    {onDelete && (
                        <button className="annotation-action-btn delete" onClick={() => onDelete(annotation.id)} title="Delete">&times;</button>
                    )}
                </div>
            )}
        </div>
    );
}

export function EventStream({ events, sessionStartTime, annotations, enabledTypes, onAddAnnotation, onUpdateAnnotation, onDeleteAnnotation, readOnly, scrollToTimestamp, onScrollComplete, videoTimeRef, isVideoPlaying, onSeekVideo }: Props) {
    const [showAnnotations, setShowAnnotations] = useState(true);
    const [annotatingTimestamp, setAnnotatingTimestamp] = useState<number | null>(null);
    const [expandedTerminals, setExpandedTerminals] = useState<Set<string>>(new Set());
    // One keyer per EventStream instance — stays in scope for the component
    // lifetime so the WeakMap accumulates entries deterministically and
    // older events fall out of the map naturally when GC'd from the live
    // ringbuffer.
    const eventKey = useMemo(() => makeEventKeyer(), []);
    const [followPlayback, setFollowPlayback] = useState(false);
    const virtuosoRef = useRef<VirtuosoHandle>(null);
    const [atBottom, setAtBottom] = useState(true);

    // Closest stream-item index to a given timestamp (binary-search over
    // pre-sorted stream timestamps). Returns -1 if stream is empty.
    const findIndexForTimestamp = useCallback((stream: readonly StreamItem[], ts: number): number => {
        if (stream.length === 0) return -1;
        // Linear pass: stream is already sorted by timestamp (built below).
        // For ~5k items this is fast enough and avoids extra structure.
        let bestIdx = 0;
        let bestDist = Infinity;
        for (let i = 0; i < stream.length; i++) {
            const item = stream[i];
            const itemTs = item.kind === 'event' ? item.event.timestamp : item.annotation.timestamp;
            const d = Math.abs(itemTs - ts);
            if (d < bestDist) { bestDist = d; bestIdx = i; }
            // Optimisation: once we start moving away from target, stop.
            else if (itemTs > ts) break;
        }
        return bestIdx;
    }, []);

    const handleSeekToEvent = useCallback((timestamp: number) => {
        onSeekVideo?.(timestamp);
    }, [onSeekVideo]);

    const stream = useMemo<StreamItem[]>(() => {
        const items: StreamItem[] = [];
        events.forEach((event) => {
            if (enabledTypes.has(event.type)) {
                items.push({ kind: 'event', event, key: eventKey(event) });
            }
        });
        if (showAnnotations) {
            for (const annotation of annotations) {
                items.push({ kind: 'annotation', annotation });
            }
        }
        items.sort((a, b) => {
            const tsA = a.kind === 'event' ? a.event.timestamp : a.annotation.timestamp;
            const tsB = b.kind === 'event' ? b.event.timestamp : b.annotation.timestamp;
            if (tsA !== tsB) return tsA - tsB;
            // annotations after events at same timestamp
            if (a.kind !== b.kind) return a.kind === 'event' ? -1 : 1;
            return 0;
        });
        return items;
    }, [events, enabledTypes, annotations, showAnnotations, eventKey]);

    // ── Scroll to a target timestamp ────────────────────────────────────
    // Both scrollToTimestamp (from external triggers) and followPlayback
    // (video sync) resolve to a stream index and call Virtuoso's
    // scrollToIndex. No more DOM querySelectorAll on potentially thousands
    // of rows. Stream is a useMemo dependency so the effects rebuild when
    // it changes; useDeferredValue at the parent throttles that cadence.
    useEffect(() => {
        if (scrollToTimestamp == null) return;
        const idx = findIndexForTimestamp(stream, scrollToTimestamp);
        if (idx >= 0) {
            virtuosoRef.current?.scrollToIndex({ index: idx, behavior: 'smooth', align: 'center' });
        }
        const timer = setTimeout(() => onScrollComplete?.(), 2000);
        return () => clearTimeout(timer);
    }, [scrollToTimestamp, onScrollComplete, findIndexForTimestamp, stream]);

    useEffect(() => {
        if (!followPlayback || !isVideoPlaying || !videoTimeRef) return;
        const interval = setInterval(() => {
            const ts = videoTimeRef.current;
            if (ts <= 0) return;
            const idx = findIndexForTimestamp(stream, ts);
            if (idx >= 0) {
                virtuosoRef.current?.scrollToIndex({ index: idx, behavior: 'auto', align: 'center' });
            }
        }, 1000);
        return () => clearInterval(interval);
    }, [followPlayback, isVideoPlaying, videoTimeRef, findIndexForTimestamp, stream]);

    const eventCount = stream.filter(s => s.kind === 'event').length;

    const renderItem = useCallback((_index: number, item: StreamItem) => {
        if (item.kind === 'annotation') {
            return (
                <AnnotationRow
                    annotation={item.annotation}
                    sessionStartTime={sessionStartTime}
                    onUpdate={onUpdateAnnotation}
                    onDelete={onDeleteAnnotation}
                    readOnly={readOnly}
                />
            );
        }

        const { event, key } = item;
        const isHighlighted = scrollToTimestamp != null && Math.abs(event.timestamp - scrollToTimestamp) < 500;
        const isTermCmd = event.type === 'terminalCommand';
        const isTermExpanded = isTermCmd && expandedTerminals.has(key);
        return (
            <div data-timestamp={event.timestamp}>
                <div
                    className={`event-row ${event.type}${isHighlighted ? ' flash-highlight' : ''}${isTermCmd ? ' clickable' : ''}`}
                    onClick={isTermCmd ? () => setExpandedTerminals(prev => {
                        const next = new Set(prev);
                        if (next.has(key)) next.delete(key); else next.add(key);
                        return next;
                    }) : undefined}
                >
                    <span className="event-time mono">
                        {formatOffset(event.timestamp - sessionStartTime)}
                    </span>
                    <EventBadge type={event.type} />
                    {eventDetail(event)}
                    {isTermCmd && (
                        <span className="expand-hint">{isTermExpanded ? '▾' : '▸'}</span>
                    )}
                    {onSeekVideo && (
                        <button
                            className="seek-video-btn"
                            title="Jump video to this event"
                            onClick={e => { e.stopPropagation(); handleSeekToEvent(event.timestamp); }}
                        >
                            &#9654;
                        </button>
                    )}
                    {!readOnly && onAddAnnotation && (
                        <button
                            className="annotate-btn"
                            title="Add annotation at this timestamp"
                            onClick={e => {
                                e.stopPropagation();
                                setAnnotatingTimestamp(
                                    annotatingTimestamp === event.timestamp ? null : event.timestamp
                                );
                            }}
                        >
                            +
                        </button>
                    )}
                </div>
                {isTermExpanded && event.type === 'terminalCommand' && (
                    <pre className="terminal-output">{stripAnsi(event.output)}</pre>
                )}
                {annotatingTimestamp === event.timestamp && !readOnly && onAddAnnotation && (
                    <InlineAnnotationInput
                        onSubmit={text => {
                            onAddAnnotation(event.timestamp, text);
                            setAnnotatingTimestamp(null);
                        }}
                        onCancel={() => setAnnotatingTimestamp(null)}
                    />
                )}
            </div>
        );
    }, [sessionStartTime, scrollToTimestamp, expandedTerminals, onSeekVideo, readOnly, onAddAnnotation, onUpdateAnnotation, onDeleteAnnotation, handleSeekToEvent, annotatingTimestamp]);

    return (
        <div className="event-stream">
            <div className="event-stream-header">
                <h2>Event Stream ({eventCount} / {events.length})</h2>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    {onSeekVideo && (
                        <button
                            className={`filter-btn follow-playback-btn ${followPlayback ? 'active' : ''}`}
                            onClick={() => setFollowPlayback(f => !f)}
                            title="Auto-scroll to current video position"
                        >
                            Follow playback
                        </button>
                    )}
                    <button
                        className={`filter-btn annotation-toggle ${showAnnotations ? 'active' : ''}`}
                        onClick={() => setShowAnnotations(!showAnnotations)}
                        title="Toggle annotations"
                    >
                        {annotations.length} annotation{annotations.length !== 1 ? 's' : ''}
                    </button>
                </div>
            </div>

            <div className="event-list">
                <Virtuoso
                    ref={virtuosoRef}
                    style={{ height: '100%' }}
                    data={stream}
                    itemContent={renderItem}
                    // followOutput: smooth auto-scroll when new items append,
                    // unless the user has scrolled away from the bottom.
                    followOutput={atBottom ? 'smooth' : false}
                    atBottomStateChange={setAtBottom}
                    // Disable follow-playback when the user actively scrolls
                    // away from the bottom of the stream.
                    isScrolling={(scrolling) => {
                        if (scrolling && followPlayback && !atBottom) {
                            setFollowPlayback(false);
                        }
                    }}
                    computeItemKey={(_index, item) =>
                        item.kind === 'annotation'
                            ? `annot-${item.annotation.id}`
                            : `evt-${item.key}`
                    }
                />
            </div>
        </div>
    );
}
