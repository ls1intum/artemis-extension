import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import type { Annotation, RecordedEvent, EventType } from '../types.ts';
import { ALL_LABELS } from '../types.ts';
import { formatOffset, shortenUri } from '../utils/format.ts';

interface Props {
    events: RecordedEvent[];
    sessionStartTime: number;
    annotations: Annotation[];
    enabledTypes: Set<EventType>;
    onAddAnnotation: (timestamp: number, text: string) => void;
    onUpdateAnnotation: (id: string, text: string) => void;
    onDeleteAnnotation: (id: string) => void;
    scrollToTimestamp?: number | null;
    onScrollComplete?: () => void;
    videoTimeRef?: React.RefObject<number>;
    isVideoPlaying?: boolean;
    onSeekVideo?: (timestamp: number) => void;
}

type StreamItem =
    | { kind: 'event'; event: RecordedEvent; index: number }
    | { kind: 'annotation'; annotation: Annotation };

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

function EventDetail({ event }: { event: RecordedEvent }) {
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

function AnnotationRow({ annotation, sessionStartTime, onUpdate, onDelete }: {
    annotation: Annotation;
    sessionStartTime: number;
    onUpdate: (id: string, text: string) => void;
    onDelete: (id: string) => void;
}) {
    const [editing, setEditing] = useState(false);
    const [editText, setEditText] = useState(annotation.text);

    if (editing) {
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
                            onUpdate(annotation.id, editText.trim());
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
                    onClick={() => { onUpdate(annotation.id, editText.trim()); setEditing(false); }}
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
            <span className="annotation-text" onClick={() => setEditing(true)} title="Click to edit">
                {annotation.text}
            </span>
            <div className="annotation-actions">
                <button className="annotation-action-btn edit" onClick={() => setEditing(true)} title="Edit">&#9998;</button>
                <button className="annotation-action-btn delete" onClick={() => onDelete(annotation.id)} title="Delete">&times;</button>
            </div>
        </div>
    );
}

export function EventStream({ events, sessionStartTime, annotations, enabledTypes, onAddAnnotation, onUpdateAnnotation, onDeleteAnnotation, scrollToTimestamp, onScrollComplete, videoTimeRef, isVideoPlaying, onSeekVideo }: Props) {
    const [showAnnotations, setShowAnnotations] = useState(true);
    const [annotatingTimestamp, setAnnotatingTimestamp] = useState<number | null>(null);
    const [expandedTerminals, setExpandedTerminals] = useState<Set<number>>(new Set());
    const [followPlayback, setFollowPlayback] = useState(false);
    const programmaticScroll = useRef(false);
    const listRef = useRef<HTMLDivElement>(null);

    // Scroll to timestamp when requested; clear after 2s animation
    useEffect(() => {
        if (scrollToTimestamp == null || !listRef.current) return;

        // Find the closest event row by timestamp
        const rows = listRef.current.querySelectorAll<HTMLElement>('[data-timestamp]');
        let closest: HTMLElement | null = null;
        let closestDist = Infinity;
        rows.forEach(row => {
            const ts = Number(row.dataset.timestamp);
            const dist = Math.abs(ts - scrollToTimestamp);
            if (dist < closestDist) {
                closestDist = dist;
                closest = row;
            }
        });

        if (closest) {
            (closest as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'center' });
        }

        const timer = setTimeout(() => onScrollComplete?.(), 2000);
        return () => clearTimeout(timer);
    }, [scrollToTimestamp, onScrollComplete]);

    // Pre-sorted timestamps for binary search in follow mode
    const sortedTimestamps = useMemo(() => {
        return events
            .filter(e => enabledTypes.has(e.type))
            .map(e => e.timestamp)
            .sort((a, b) => a - b);
    }, [events, enabledTypes]);

    // Manual scroll detection: disable follow mode.
    // programmaticScroll flag is set before scrollIntoView and cleared by
    // 'scrollend' (fires after scroll settles) with rAF fallback.
    useEffect(() => {
        const el = listRef.current;
        if (!el) return;
        const onScroll = () => {
            if (programmaticScroll.current) return;
            setFollowPlayback(false);
        };
        const onScrollEnd = () => {
            programmaticScroll.current = false;
        };
        el.addEventListener('scroll', onScroll, { passive: true });
        el.addEventListener('scrollend', onScrollEnd, { passive: true });
        return () => {
            el.removeEventListener('scroll', onScroll);
            el.removeEventListener('scrollend', onScrollEnd);
        };
    }, []);

    // Follow playback mode
    useEffect(() => {
        if (!followPlayback || !isVideoPlaying || !videoTimeRef || !listRef.current) return;

        const interval = setInterval(() => {
            const ts = videoTimeRef.current;
            if (ts <= 0) return;

            // Binary search for nearest timestamp
            let lo = 0, hi = sortedTimestamps.length - 1;
            while (lo < hi) {
                const mid = (lo + hi) >> 1;
                if (sortedTimestamps[mid] < ts) lo = mid + 1;
                else hi = mid;
            }
            // Check if lo-1 is closer
            if (lo > 0 && Math.abs(sortedTimestamps[lo - 1] - ts) < Math.abs(sortedTimestamps[lo] - ts)) {
                lo = lo - 1;
            }
            const nearestTs = sortedTimestamps[lo];
            if (nearestTs == null) return;

            const rows = listRef.current?.querySelectorAll<HTMLElement>('[data-timestamp]');
            if (!rows) return;
            let closest: HTMLElement | null = null;
            let closestDist = Infinity;
            rows.forEach(row => {
                const rowTs = Number(row.dataset.timestamp);
                const dist = Math.abs(rowTs - nearestTs);
                if (dist < closestDist) {
                    closestDist = dist;
                    closest = row;
                }
            });

            if (closest) {
                programmaticScroll.current = true;
                (closest as HTMLElement).scrollIntoView({ behavior: 'instant', block: 'nearest' });
                // Fallback for browsers without scrollend: clear after next frame
                requestAnimationFrame(() => {
                    programmaticScroll.current = false;
                });
            }
        }, 1000);

        return () => clearInterval(interval);
    }, [followPlayback, isVideoPlaying, videoTimeRef, sortedTimestamps]);

    const handleSeekToEvent = useCallback((timestamp: number) => {
        onSeekVideo?.(timestamp);
    }, [onSeekVideo]);

    const stream = useMemo<StreamItem[]>(() => {
        const items: StreamItem[] = [];
        events.forEach((event, index) => {
            if (enabledTypes.has(event.type)) {
                items.push({ kind: 'event', event, index });
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
    }, [events, enabledTypes, annotations, showAnnotations]);

    const eventCount = stream.filter(s => s.kind === 'event').length;

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

            <div className="event-list" ref={listRef}>
                {stream.map((item) => {
                    if (item.kind === 'annotation') {
                        return (
                            <AnnotationRow
                                key={`annot-${item.annotation.id}`}
                                annotation={item.annotation}
                                sessionStartTime={sessionStartTime}
                                onUpdate={onUpdateAnnotation}
                                onDelete={onDeleteAnnotation}
                            />
                        );
                    }

                    const { event, index } = item;
                    const isHighlighted = scrollToTimestamp != null && Math.abs(event.timestamp - scrollToTimestamp) < 500;
                    const isTermCmd = event.type === 'terminalCommand';
                    const isTermExpanded = isTermCmd && expandedTerminals.has(index);
                    return (
                        <div key={`${event.timestamp}-${event.type}-${index}`} data-timestamp={event.timestamp}>
                            <div
                                className={`event-row ${event.type}${isHighlighted ? ' flash-highlight' : ''}${isTermCmd ? ' clickable' : ''}`}
                                onClick={isTermCmd ? () => setExpandedTerminals(prev => {
                                    const next = new Set(prev);
                                    if (next.has(index)) next.delete(index); else next.add(index);
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
                            </div>
                            {isTermExpanded && event.type === 'terminalCommand' && (
                                <pre className="terminal-output">{stripAnsi(event.output)}</pre>
                            )}
                            {annotatingTimestamp === event.timestamp && (
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
                })}
            </div>
        </div>
    );
}
