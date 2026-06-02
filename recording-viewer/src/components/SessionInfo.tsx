import type { LoadedSession, RecordedEvent } from '../types.ts';
import { ALL_EVENT_TYPES } from '../constants.ts';
import { formatDuration, formatTime } from '../utils/format.ts';
import { orderTypesActiveFirst } from '../utils/timelineLayout.ts';
import { EventBadge } from './EventBadge.tsx';

interface Props {
    session: LoadedSession;
    /**
     * Events to summarise. In live mode these are the streamed events, which
     * grow over time and differ from the open-time `session.events` snapshot;
     * passing them explicitly keeps the breakdown, totals and duration live.
     */
    events: RecordedEvent[];
}

export function SessionInfo({ session, events }: Props) {
    const { metadata } = session;

    const eventTypeCounts = new Map<string, number>();
    for (const event of events) {
        eventTypeCounts.set(event.type, (eventTypeCounts.get(event.type) ?? 0) + 1);
    }
    // Always list every event type (0 count included), keeping the curated order
    // but pushing the types with no events to the bottom.
    const orderedTypes = orderTypesActiveFirst(
        ALL_EVENT_TYPES,
        t => (eventTypeCounts.get(t) ?? 0) > 0,
    );

    const firstTs = events[0]?.timestamp;
    const lastTs = events[events.length - 1]?.timestamp;
    const duration = firstTs && lastTs ? lastTs - firstTs : 0;

    return (
        <div className="session-info">
            <h2>Session Info</h2>
            <div className="info-grid">
                {metadata && (
                    <>
                        <span className="label">Session ID</span>
                        <span className="value mono">{metadata.sessionId}</span>
                        <span className="label">Exercise ID</span>
                        <span className="value">{metadata.exerciseId}</span>
                        {metadata.participantId && (
                            <>
                                <span className="label">Participant</span>
                                <span className="value mono">{metadata.participantId}</span>
                            </>
                        )}
                    </>
                )}
                <span className="label">Start</span>
                <span className="value">{firstTs ? formatTime(firstTs) : '—'}</span>
                <span className="label">End</span>
                <span className="value">{lastTs ? formatTime(lastTs) : '—'}</span>
                <span className="label">Duration</span>
                <span className="value">{formatDuration(duration)}</span>
                <span className="label">Events</span>
                <span className="value">{events.length}</span>
            </div>

            <h3>Event Breakdown</h3>
            <div className="event-breakdown">
                {orderedTypes.map(type => {
                    const count = eventTypeCounts.get(type) ?? 0;
                    return (
                        <div key={type} className={`event-count-row${count === 0 ? ' empty' : ''}`}>
                            <EventBadge type={type} />
                            <span className="event-count">{count}</span>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
