import { useState, useMemo } from 'react';
import type { RecordedEvent, EventType } from '../types.ts';
import { formatOffset, shortenUri } from '../utils/format.ts';

interface Props {
    events: RecordedEvent[];
    sessionStartTime: number;
}

const ALL_EVENT_TYPES = [
    'sessionStart', 'sessionEnd',
    'eqSnapshot', 'eqEngineState', 'buildResult',
    'textChange', 'save',
    'diagnostics',
    'fileSwitch',
    'windowFocus', 'fileSnapshot',
    'irisChatMessage',
    'selectionChange', 'visibleRangeChange',
] as const satisfies readonly EventType[];

// Compile error if a new event type is added but not listed above
type _MissingEventTypes = Exclude<EventType, (typeof ALL_EVENT_TYPES)[number]>;
void (true satisfies (_MissingEventTypes extends never ? true : never));

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
        case 'textChange':
            return (
                <span className="event-detail">
                    {shortenUri(event.uri)} | {event.changes.length} change(s)
                    {event.changes[0] && (
                        <span className="change-preview">
                            {event.changes[0].text.length > 0
                                ? ` +${event.changes[0].text.length} chars`
                                : ` -${event.changes[0].rangeLength} chars`}
                        </span>
                    )}
                </span>
            );
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
        default:
            return null;
    }
}

export function EventStream({ events, sessionStartTime }: Props) {
    const [enabledTypes, setEnabledTypes] = useState<Set<EventType>>(() => {
        // Start with meaningful events enabled, hide noisy ones
        return new Set<EventType>([
            'sessionStart', 'sessionEnd',
            'eqSnapshot', 'buildResult',
            'textChange', 'save',
            'diagnostics',
            'fileSwitch',
            'irisChatMessage',
            'windowFocus',
        ]);
    });

    const filtered = useMemo(
        () => events.filter(e => enabledTypes.has(e.type)),
        [events, enabledTypes],
    );

    const toggleType = (type: EventType) => {
        setEnabledTypes(prev => {
            const next = new Set(prev);
            if (next.has(type)) {
                next.delete(type);
            } else {
                next.add(type);
            }
            return next;
        });
    };

    return (
        <div className="event-stream">
            <h2>Event Stream ({filtered.length} / {events.length})</h2>

            <div className="filter-bar">
                {ALL_EVENT_TYPES.map(type => (
                    <button
                        key={type}
                        className={`filter-btn ${type} ${enabledTypes.has(type) ? 'active' : ''}`}
                        onClick={() => toggleType(type)}
                    >
                        {type}
                    </button>
                ))}
            </div>

            <div className="event-list">
                {filtered.map((event, i) => (
                    <div key={`${event.timestamp}-${event.type}-${i}`} className={`event-row ${event.type}`}>
                        <span className="event-time mono">
                            {formatOffset(event.timestamp - sessionStartTime)}
                        </span>
                        <span className={`event-badge ${event.type}`}>{event.type}</span>
                        <EventDetail event={event} />
                    </div>
                ))}
            </div>
        </div>
    );
}
