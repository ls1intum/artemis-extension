import { useState, useCallback, useRef } from 'react';
import type { Annotation, LoadedSession, RecordedEvent, SessionMetadata, ReplayEqSnapshot } from './types';
import { FileDropZone } from './components/FileDropZone';
import { RecordingInfo } from './components/RecordingInfo';
import { SessionList } from './components/SessionList';
import { SessionInfo } from './components/SessionInfo';
import { SessionTimeline } from './components/SessionTimeline';
import { EventStream } from './components/EventStream';

function App() {
    const [session, setSession] = useState<LoadedSession | null>(null);
    const [loading, setLoading] = useState(false);
    const [annotations, setAnnotations] = useState<Annotation[]>([]);
    const activeSessionId = useRef<string | null>(null);

    const saveAnnotations = useCallback(async (updated: Annotation[]) => {
        setAnnotations(updated);
        if (activeSessionId.current) {
            await fetch(`/api/recordings/${activeSessionId.current}/annotations`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updated),
            }).catch(() => {/* best-effort persist */});
        }
    }, []);

    const handleAddAnnotation = useCallback((timestamp: number, text: string) => {
        const annotation: Annotation = {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            timestamp,
            text,
            createdAt: Date.now(),
        };
        saveAnnotations([...annotations, annotation]);
    }, [annotations, saveAnnotations]);

    const handleUpdateAnnotation = useCallback((id: string, text: string) => {
        saveAnnotations(annotations.map(a => a.id === id ? { ...a, text } : a));
    }, [annotations, saveAnnotations]);

    const handleDeleteAnnotation = useCallback((id: string) => {
        saveAnnotations(annotations.filter(a => a.id !== id));
    }, [annotations, saveAnnotations]);

    const loadFromApi = useCallback(async (sessionId: string) => {
        setLoading(true);
        try {
            const [eventsRes, metaRes, replayRes, annotRes] = await Promise.all([
                fetch(`/api/recordings/${sessionId}/events`),
                fetch(`/api/recordings/${sessionId}/metadata`),
                fetch(`/api/recordings/${sessionId}/replay-eq`),
                fetch(`/api/recordings/${sessionId}/annotations`),
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
            let loadedAnnotations: Annotation[] = [];
            if (annotRes.ok) {
                loadedAnnotations = await annotRes.json();
            }

            activeSessionId.current = sessionId;
            setAnnotations(loadedAnnotations);
            setSession({ metadata, events, fileName: sessionId, replayEq, annotations: loadedAnnotations });
        } catch (err) {
            console.error('Failed to load session:', err);
        } finally {
            setLoading(false);
        }
    }, []);

    const handleFileSession = useCallback((loaded: LoadedSession) => {
        activeSessionId.current = null;
        setAnnotations([]);
        setSession(loaded);
    }, []);

    const handleBack = useCallback(() => {
        activeSessionId.current = null;
        setAnnotations([]);
        setSession(null);
    }, []);

    const sessionStartTime = session?.events[0]?.timestamp ?? 0;

    return (
        <div className="app">
            <header className="app-header">
                <h1>Recording Viewer</h1>
                {session && (
                    <button className="reset-btn" onClick={handleBack}>
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
                    <FileDropZone onSessionLoaded={handleFileSession} />
                    <div style={{ marginTop: 24 }}>
                        <RecordingInfo />
                    </div>
                </>
            )}

            {session && (
                <div className="session-view">
                    <SessionInfo session={session} />
                    <SessionTimeline
                        events={session.events}
                        sessionStartTime={sessionStartTime}
                        replayEq={session.replayEq}
                        annotations={annotations}
                    />
                    <EventStream
                        events={session.events}
                        sessionStartTime={sessionStartTime}
                        annotations={annotations}
                        onAddAnnotation={handleAddAnnotation}
                        onUpdateAnnotation={handleUpdateAnnotation}
                        onDeleteAnnotation={handleDeleteAnnotation}
                    />
                </div>
            )}
        </div>
    );
}

export default App;
