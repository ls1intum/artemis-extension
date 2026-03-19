import { useEffect, useState, useCallback } from 'react';
import type { SessionMetadata } from '../types.ts';
import { formatDuration, formatTime } from '../utils/format.ts';

interface SessionEntry {
    id: string;
    metadata: SessionMetadata | null;
    hasReplay: boolean;
    hasVideo: boolean;
}

interface SessionListResponse {
    sessions: SessionEntry[];
    recordingsDir: string;
}

interface Props {
    onSelectSession: (sessionId: string) => void;
}

export function SessionList({ onSelectSession }: Props) {
    const [data, setData] = useState<SessionListResponse | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [deleting, setDeleting] = useState<string | null>(null);
    const [renaming, setRenaming] = useState<string | null>(null);
    const [renameValue, setRenameValue] = useState('');

    const loadSessions = useCallback(() => {
        setLoading(true);
        fetch('/api/recordings')
            .then(res => res.json())
            .then(d => { setData(d); setLoading(false); })
            .catch(err => { setError(String(err)); setLoading(false); });
    }, []);

    useEffect(() => { loadSessions(); }, [loadSessions]);

    const deleteSession = useCallback(async (e: React.MouseEvent, sessionId: string) => {
        e.stopPropagation();
        if (!confirm(`Delete session "${sessionId}"?\n\nThis permanently removes all recording data.`)) {
            return;
        }
        setDeleting(sessionId);
        try {
            const res = await fetch(`/api/recordings/${sessionId}`, { method: 'DELETE' });
            if (res.ok) {
                setData(prev => prev ? {
                    ...prev,
                    sessions: prev.sessions.filter(s => s.id !== sessionId),
                } : null);
            }
        } catch (err) {
            console.error('Failed to delete session:', err);
        } finally {
            setDeleting(null);
        }
    }, []);

    const startRename = useCallback((e: React.MouseEvent, sessionId: string) => {
        e.stopPropagation();
        setRenaming(sessionId);
        setRenameValue(sessionId);
    }, []);

    const submitRename = useCallback(async (oldId: string) => {
        const newName = renameValue.trim();
        if (!newName || newName === oldId) {
            setRenaming(null);
            return;
        }
        try {
            const res = await fetch(`/api/recordings/${encodeURIComponent(oldId)}/rename`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: newName }),
            });
            if (res.ok) {
                setData(prev => prev ? {
                    ...prev,
                    sessions: prev.sessions.map(s =>
                        s.id === oldId ? { ...s, id: newName } : s
                    ),
                } : null);
            } else {
                const err = await res.json();
                alert(err.error ?? 'Rename failed');
            }
        } catch (err) {
            console.error('Failed to rename session:', err);
        } finally {
            setRenaming(null);
        }
    }, [renameValue]);

    const openSessionFolder = useCallback(async (e: React.MouseEvent, sessionId: string) => {
        e.stopPropagation();
        await fetch(`/api/recordings/${sessionId}/open`, { method: 'POST' });
    }, []);

    const openRecordingsFolder = useCallback(async () => {
        await fetch('/api/recordings/open-folder', { method: 'POST' });
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
            <div className="session-list-toolbar">
                <p className="path-hint">
                    Recordings: <code>{data.recordingsDir}</code>
                </p>
                <button className="toolbar-btn" onClick={openRecordingsFolder} title="Open in Finder">
                    Open Folder
                </button>
            </div>
            <div className="session-table">
                <div className="session-table-header">
                    <span>Session</span>
                    <span>Exercise</span>
                    <span>Start</span>
                    <span>Duration</span>
                    <span>Events</span>
                    <span>Replay</span>
                    <span>Video</span>
                    <span></span>
                </div>
                {data.sessions.map(entry => (
                    <div
                        key={entry.id}
                        className={`session-table-row ${deleting === entry.id ? 'deleting' : ''}`}
                        onClick={() => renaming !== entry.id && onSelectSession(entry.id)}
                    >
                        {renaming === entry.id ? (
                            <input
                                autoFocus
                                className="rename-input mono"
                                value={renameValue}
                                onClick={e => e.stopPropagation()}
                                onChange={e => setRenameValue(e.target.value)}
                                onKeyDown={e => {
                                    if (e.key === 'Enter') submitRename(entry.id);
                                    if (e.key === 'Escape') setRenaming(null);
                                }}
                                onBlur={() => submitRename(entry.id)}
                            />
                        ) : (
                            <span className="mono session-id-cell" title={entry.id}>
                                {entry.id.length > 30 ? entry.id.slice(0, 30) + '...' : entry.id}
                            </span>
                        )}
                        <span>{entry.metadata?.exerciseId ?? '—'}</span>
                        <span>{entry.metadata?.startTime ? formatTime(entry.metadata.startTime) : '—'}</span>
                        <span>
                            {entry.metadata?.startTime && entry.metadata.endTime
                                ? formatDuration(entry.metadata.endTime - entry.metadata.startTime)
                                : '\u2014'}
                        </span>
                        <span>{entry.metadata?.eventCount ?? '—'}</span>
                        <span className={`replay-indicator ${entry.hasReplay ? 'has-replay' : ''}`}>
                            {entry.hasReplay ? 'Yes' : '—'}
                        </span>
                        <span className={`replay-indicator ${entry.hasVideo ? 'has-replay' : ''}`}>
                            {entry.hasVideo ? 'Yes' : '—'}
                        </span>
                        <span className="session-actions">
                            <button
                                className="action-btn rename-btn"
                                onClick={e => startRename(e, entry.id)}
                                title="Rename session"
                            >
                                &#9998;
                            </button>
                            <button
                                className="action-btn open-btn"
                                onClick={e => openSessionFolder(e, entry.id)}
                                title="Open in Finder"
                            >
                                &#x1F4C2;
                            </button>
                            <button
                                className="action-btn delete-btn"
                                onClick={e => deleteSession(e, entry.id)}
                                title="Delete session"
                                disabled={deleting === entry.id}
                            >
                                {deleting === entry.id ? '...' : '\u00D7'}
                            </button>
                        </span>
                    </div>
                ))}
            </div>
        </div>
    );
}
