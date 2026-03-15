import { useState, useCallback } from 'react';
import type { LoadedSession, RecordedEvent, SessionMetadata } from './types';
import { FileDropZone } from './components/FileDropZone';
import { SessionList } from './components/SessionList';
import { SessionInfo } from './components/SessionInfo';
import { EqChart } from './components/EqChart';
import { EventStream } from './components/EventStream';

function App() {
    const [session, setSession] = useState<LoadedSession | null>(null);
    const [loading, setLoading] = useState(false);

    const loadFromApi = useCallback(async (sessionId: string) => {
        setLoading(true);
        try {
            const [eventsRes, metaRes] = await Promise.all([
                fetch(`/api/recordings/${sessionId}/events`),
                fetch(`/api/recordings/${sessionId}/metadata`),
            ]);

            const events: RecordedEvent[] = await eventsRes.json();
            let metadata: SessionMetadata | null = null;
            if (metaRes.ok) {
                metadata = await metaRes.json();
            }

            setSession({ metadata, events, fileName: sessionId });
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
                </>
            )}

            {session && (
                <div className="session-view">
                    <SessionInfo session={session} />
                    <EqChart events={session.events} sessionStartTime={sessionStartTime} />
                    <EventStream events={session.events} sessionStartTime={sessionStartTime} />
                </div>
            )}
        </div>
    );
}

export default App;
