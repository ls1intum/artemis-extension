import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
import type { Annotation, RecordedEvent, EventType } from '../types.ts';
import { ALL_LABELS } from '../types.ts';
import { formatOffset, formatDuration, shortenUri, formatDebugSessionMeta, formatBreakpointLocation } from '../utils/format.ts';

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

export function EventDetail({ event }: { event: RecordedEvent }) {
    switch (event.type) {
        case 'eqSnapshot':
            return (
                <span className="event-detail">
                    EQ: <strong>{Math.round(event.eq * 100)}%</strong>
                    <span className={`confidence-tag ${event.confidence}`}>{event.confidence}</span>
                </span>
            );
        case 'buildResult':
            return (
                <span className="event-detail">
                    {event.buildFailed ? 'BUILD FAILED' : event.successful ? 'PASSED' : `${event.errorCount} error(s)`}
                    {event.failedTests.length > 0 && ` | ${event.failedTests.length} test(s) failed`}
                </span>
            );
        case 'textChange': {
            const MAX_INLINE = 16;
            let insertedAll = '';
            let deletedTotal = 0;
            for (const c of event.changes) {
                insertedAll += c.text;
                deletedTotal += c.rangeLength;
            }
            const hasInsert = insertedAll.length > 0;
            const hasDelete = deletedTotal > 0;

            const inlineText = insertedAll.length <= MAX_INLINE
                ? <code className="inline-text">{insertedAll}</code>
                : <><code className="inline-text">{insertedAll.slice(0, MAX_INLINE)}</code> +{insertedAll.length - MAX_INLINE} chars</>;

            let op: React.ReactNode;
            if (hasInsert && hasDelete) {
                op = <span className="change-preview">replaced {deletedTotal} &rarr; {inlineText}</span>;
            } else if (hasInsert) {
                op = <span className="change-preview">inserted {inlineText}</span>;
            } else {
                op = <span className="change-preview">deleted {deletedTotal} chars</span>;
            }

            return (
                <span className="event-detail">
                    {shortenUri(event.uri)} | {op}
                </span>
            );
        }
        case 'save':
            return <span className="event-detail">{shortenUri(event.uri)}</span>;
        case 'diagnostics':
            return (
                <span className="event-detail">
                    {shortenUri(event.uri)} | {event.diagnostics.length} diagnostic(s)
                </span>
            );
        case 'fileSwitch':
            return (
                <span className="event-detail">
                    {shortenUri(event.fromUri)} &rarr; {shortenUri(event.toUri)}
                </span>
            );
        case 'sessionStart':
            return (
                <span className="event-detail">
                    Exercise {event.exerciseId}
                    {event.participantId && ` | ${event.participantId}`}
                </span>
            );
        case 'sessionEnd':
            return <span className="event-detail">Exercise {event.exerciseId}</span>;
        case 'irisChatMessage':
            return (
                <span className="event-detail">
                    {event.direction === 'sent' ? 'SENT' : 'RECV'}:&nbsp;
                    {event.content.length > 80 ? event.content.slice(0, 80) + '...' : event.content}
                    {event.messageId && <span className="event-meta"> id:{event.messageId}</span>}
                </span>
            );
        case 'irisChatSendAttempt':
            return (
                <span className="event-detail">
                    {event.status.toUpperCase()}:&nbsp;
                    {event.content.length > 80 ? event.content.slice(0, 80) + '...' : event.content}
                    {event.errorMessage && <span className="event-error"> — {event.errorMessage}</span>}
                </span>
            );
        case 'irisChatFeedback':
            return (
                <span className="event-detail">
                    msg:{event.messageId} | {event.helpful ? 'helpful' : 'not helpful'}
                </span>
            );
        case 'windowFocus':
            return <span className="event-detail">{event.focused ? 'focused' : 'blurred'}</span>;
        case 'fileSnapshot':
            return <span className="event-detail">{shortenUri(event.uri)}</span>;
        case 'selectionChange':
            return (
                <span className="event-detail">
                    {shortenUri(event.uri)} | L{event.selections[0]?.startLine ?? 0}:{event.selections[0]?.startCharacter ?? 0}
                    {event.kind && ` (${event.kind})`}
                </span>
            );
        case 'visibleRangeChange':
            return (
                <span className="event-detail">
                    {shortenUri(event.uri)} | L{event.visibleRanges[0]?.startLine ?? 0}-L{event.visibleRanges[0]?.endLine ?? 0}
                </span>
            );
        case 'intervention':
            return (
                <span className="event-detail">
                    {event.action.toUpperCase()} | {event.level}
                    {' '} EQ: <strong>{Math.round(event.eq * 100)}%</strong>
                    {event.triggerType && ` | ${event.triggerType}`}
                </span>
            );
        case 'eqEngineState':
            return (
                <span className="event-detail">
                    {event.snapshots.length} snapshot(s) | EQ: <strong>{Math.round(event.currentEQ * 100)}%</strong>
                    <span className={`confidence-tag ${event.confidence}`}>{event.confidence}</span>
                </span>
            );
        case 'viewNavigation':
            return (
                <span className="event-detail">
                    {event.from} &rarr; {event.to}
                </span>
            );
        case 'panelVisibility':
            return (
                <span className="event-detail">
                    {event.panel} | {event.visible ? 'visible' : 'hidden'}
                </span>
            );
        case 'testResultsOverviewView':
            if (event.action === 'opened') {
                return (
                    <span className="event-detail">
                        Test results overview opened | {event.passedTests}/{event.totalTests} passed ({event.failedTests} failed)
                    </span>
                );
            }
            return (
                <span className="event-detail">
                    Test results overview closed | {formatDuration(event.durationMs)} ({event.closeReason})
                </span>
            );
        case 'taskFeedbackView':
            if (event.action === 'opened') {
                return (
                    <span className="event-detail">
                        Task "{event.taskName}" opened | {event.passedTests}/{event.totalTests} passed ({event.failedTests} failed)
                    </span>
                );
            }
            return (
                <span className="event-detail">
                    Task "{event.taskName}" closed | {formatDuration(event.durationMs)} ({event.closeReason})
                </span>
            );
        case 'configurationSnapshot':
            return (
                <span className="event-detail">
                    struggleDetection:{event.struggleDetectionEnabled ? 'on' : 'off'} | interventions:{event.showInterventions ? 'on' : 'off'}
                </span>
            );
        case 'configurationChange': {
            const parts: string[] = [];
            if (event.changes.struggleDetectionEnabled !== undefined) {
                parts.push(`struggleDetection:${event.changes.struggleDetectionEnabled ? 'on' : 'off'}`);
            }
            if (event.changes.showInterventions !== undefined) {
                parts.push(`interventions:${event.changes.showInterventions ? 'on' : 'off'}`);
            }
            return <span className="event-detail">{parts.join(' | ')}</span>;
        }
        case 'terminalCommand': {
            const exitOk = event.exitCode === 0;
            return (
                <span className="event-detail terminal-detail">
                    <code>{event.command.length > 60 ? event.command.slice(0, 60) + '...' : event.command}</code>
                    {' '}exit: <strong className={exitOk ? 'terminal-exit-ok' : 'terminal-exit-fail'}>{event.exitCode ?? '?'}</strong>
                    {' '}({Math.round(event.durationMs / 1000)}s)
                    {event.outputTruncated && ' [truncated]'}
                </span>
            );
        }
        case 'terminalOpenClose':
            return (
                <span className="event-detail">
                    {event.action} | {event.terminalName}
                </span>
            );
        case 'fileSnapshotError':
            return (
                <span className="event-detail">
                    {shortenUri(event.uri)} | {event.reason}
                </span>
            );
        case 'fileCreate':
            return <span className="event-detail">{shortenUri(event.uri)}</span>;
        case 'fileDelete':
            return <span className="event-detail">{shortenUri(event.uri)}</span>;
        case 'fileRename':
            return (
                <span className="event-detail">
                    {shortenUri(event.oldUri)} &rarr; {shortenUri(event.newUri)}
                </span>
            );
        case 'textDocumentOpen':
            return <span className="event-detail">{shortenUri(event.uri)}</span>;
        case 'textDocumentClose':
            return <span className="event-detail">{shortenUri(event.uri)}</span>;
        case 'debugSession':
            return (
                <span className="event-detail">
                    {event.action}{formatDebugSessionMeta(event.sessionName, event.sessionType)}
                </span>
            );
        case 'breakpointChange': {
            const first = event.breakpoints[0];
            return (
                <span className="event-detail">
                    {event.action} | {event.breakpoints.length} breakpoint(s)
                    {first && ` | ${formatBreakpointLocation(first.uri, first.line)}`}
                </span>
            );
        }
        default:
            return null;
    }
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
                    <span className={`event-badge ${event.type}`}>{event.type}</span>
                    <EventDetail event={event} />
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
