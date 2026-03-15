import { useState, useCallback } from 'react';
import type { LoadedSession, RecordedEvent, SessionMetadata, ReplayEqSnapshot } from './types';
import { FileDropZone } from './components/FileDropZone';
import { RecordingInfo } from './components/RecordingInfo';
import { SessionList } from './components/SessionList';
import { SessionInfo } from './components/SessionInfo';
import { SessionTimeline } from './components/SessionTimeline';
import { EventStream } from './components/EventStream';

function App() {
    const [session, setSession] = useState<LoadedSession | null>(null);
    const [loading, setLoading] = useState(false);

    const loadFromApi = useCallback(async (sessionId: string) => {
        setLoading(true);
        try {
            const [eventsRes, metaRes, replayRes] = await Promise.all([
                fetch(`/api/recordings/${sessionId}/events`),
                fetch(`/api/recordings/${sessionId}/metadata`),
                fetch(`/api/recordings/${sessionId}/replay-eq`),
            ]);

            const events: RecordedEvent[] = await eventsRes.json();
            let metadata: SessionMetadata | null = null;
            if (metaRes.ok) {
                metadata = await metaRes.json();
            }
            let replayEq: ReplayEqSnapshot[] | undefined;
            if (replayRes.ok) {
                replayEq = await replayRes.json();
            }

            setSession({ metadata, events, fileName: sessionId, replayEq });
        } catch (err) {
            console.error('Failed to load session:', err);
        } finally {
            setLoading(false);
        }
    }, []);

    const sessionStartTime = session?.events[0]?.timestamp ?? 0;

    return (
        <div className="app">
            <header className="app-header">
                <h1>Recording Viewer</h1>
                {session && (
                    <button className="reset-btn" onClick={() => setSession(null)}>
                        &larr; Back
                    </button>
                )}
            </header>

            {loading && <div className="loading">Loading session...</div>}

            {!session && !loading && (
                <>
                    <SessionList onSelectSession={loadFromApi} />
                    <div className="divider-or">
                        <span>or drop files manually</span>
                    </div>
                    <FileDropZone onSessionLoaded={setSession} />
                    <div style={{ marginTop: 24 }}>
                        <RecordingInfo />
                    </div>
                </>
            )}

            {session && (
                <div className="session-view">
                    <SessionInfo session={session} />
                    <SessionTimeline events={session.events} sessionStartTime={sessionStartTime} replayEq={session.replayEq} />
                    <EventStream events={session.events} sessionStartTime={sessionStartTime} />
                </div>
            )}
        </div>
    );
}

export default App;
