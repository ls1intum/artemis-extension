import { useEffect, useState } from 'react';
import type { SessionMetadata } from '../types';

interface SessionEntry {
    id: string;
    metadata: SessionMetadata | null;
}

interface SessionListResponse {
    sessions: SessionEntry[];
    recordingsDir: string;
}

interface Props {
    onSelectSession: (sessionId: string) => void;
}

function formatTime(ts: number): string {
    return new Date(ts).toLocaleString();
}

function formatDuration(start: number, end: number | undefined): string {
    if (!end) return '—';
    const ms = end - start;
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
}

export function SessionList({ onSelectSession }: Props) {
    const [data, setData] = useState<SessionListResponse | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetch('/api/recordings')
            .then(res => res.json())
            .then(d => { setData(d); setLoading(false); })
            .catch(err => { setError(String(err)); setLoading(false); });
    }, []);

    if (loading) {
        return <div className="session-list-status">Loading sessions...</div>;
    }

    if (error) {
        return <div className="session-list-status error">Failed to load sessions: {error}</div>;
    }

    if (!data || data.sessions.length === 0) {
        return (
            <div className="session-list-empty">
                <p>No recordings found.</p>
                <p className="path-hint">
                    Looking in: <code>{data?.recordingsDir}</code>
                </p>
                <p className="path-hint">
                    Start a recording session in VS Code to see data here.
                </p>
            </div>
        );
    }

    return (
        <div className="session-list">
            <p className="path-hint">
                Recordings: <code>{data.recordingsDir}</code>
            </p>
            <div className="session-table">
                <div className="session-table-header">
                    <span>Session</span>
                    <span>Exercise</span>
                    <span>Start</span>
                    <span>Duration</span>
                    <span>Events</span>
                </div>
                {data.sessions.map(entry => (
                    <button
                        key={entry.id}
                        className="session-table-row"
                        onClick={() => onSelectSession(entry.id)}
                    >
                        <span className="mono session-id-cell" title={entry.id}>
                            {entry.id.length > 30 ? entry.id.slice(0, 30) + '...' : entry.id}
                        </span>
                        <span>{entry.metadata?.exerciseId ?? '—'}</span>
                        <span>{entry.metadata?.startTime ? formatTime(entry.metadata.startTime) : '—'}</span>
                        <span>
                            {entry.metadata?.startTime
                                ? formatDuration(entry.metadata.startTime, entry.metadata.endTime)
                                : '—'}
                        </span>
                        <span>{entry.metadata?.eventCount ?? '—'}</span>
                    </button>
                ))}
            </div>
        </div>
    );
}
