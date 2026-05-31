import type { LoadedSession } from '../types.ts';
import { formatDuration, formatTime } from '../utils/format.ts';
import { EventBadge } from './EventBadge.tsx';

interface Props {
    session: LoadedSession;
}

export function SessionInfo({ session }: Props) {
    const { metadata, events } = session;

    const eventTypeCounts = new Map<string, number>();
    for (const event of events) {
        eventTypeCounts.set(event.type, (eventTypeCounts.get(event.type) ?? 0) + 1);
    }

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
                {Array.from(eventTypeCounts.entries())
                    .sort((a, b) => b[1] - a[1])
                    .map(([type, count]) => (
                        <div key={type} className="event-count-row">
                            <EventBadge type={type} />
                            <span className="event-count">{count}</span>
                        </div>
                    ))}
            </div>
        </div>
    );
}
