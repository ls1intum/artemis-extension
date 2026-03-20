import { useState, useCallback, useRef, useMemo } from 'react';
import type { Annotation, AnnotationLabel, LoadedSession, RecordedEvent, SessionMetadata, ReplayEqSnapshot, EventType, VideoSyncConfig } from './types';
import { FileDropZone } from './components/FileDropZone';
import { RecordingInfo } from './components/RecordingInfo';
import { SessionList } from './components/SessionList';
import { SessionInfo } from './components/SessionInfo';
import { SessionTimeline } from './components/SessionTimeline';
import { EventStream } from './components/EventStream';
import { TrackingTimeline } from './components/TrackingTimeline';
import { VideoPlayer } from './components/VideoPlayer';
import type { VideoPlayerHandle } from './components/VideoPlayer';
import { VideoUpload } from './components/VideoUpload';
import { OffsetConfig } from './components/OffsetConfig';
import { FreeAnnotationForm } from './components/FreeAnnotationForm';
import { ALL_EVENT_TYPES } from './constants';

const DEFAULT_ENABLED: EventType[] = [
    'sessionStart', 'sessionEnd',
    'eqSnapshot', 'buildResult',
    'textChange', 'save',
    'diagnostics',
    'fileSwitch',
    'irisChatMessage',
    'windowFocus',
    'viewNavigation', 'panelVisibility',
];

function App() {
    const [session, setSession] = useState<LoadedSession | null>(null);
    const [loading, setLoading] = useState(false);
    const [annotations, setAnnotations] = useState<Annotation[]>([]);
    const [enabledTypes, setEnabledTypes] = useState(() => new Set<EventType>(DEFAULT_ENABLED));
    const activeSessionId = useRef<string | null>(null);

    // Video state
    const [videoSyncConfig, setVideoSyncConfig] = useState<VideoSyncConfig | null>(null);
    const [isVideoPlaying, setIsVideoPlaying] = useState(false);
    const [videoCacheBust, setVideoCacheBust] = useState(0);
    const videoTimeRef = useRef<number>(0);
    const videoPlayerRef = useRef<VideoPlayerHandle>(null);

    const toggleType = useCallback((type: EventType) => {
        setEnabledTypes(prev => {
            const next = new Set(prev);
            if (next.has(type)) next.delete(type);
            else next.add(type);
            return next;
        });
    }, []);

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

    const handleAddAnnotation = useCallback((timestamp: number, text: string, label?: AnnotationLabel) => {
        const annotation: Annotation = {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            timestamp,
            text,
            label,
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
        setViewMode('timeline');
        setScrollToTimestamp(null);
        try {
            const [eventsRes, metaRes, replayRes, annotRes, videoSyncRes] = await Promise.all([
                fetch(`/api/recordings/${sessionId}/events`),
                fetch(`/api/recordings/${sessionId}/metadata`),
                fetch(`/api/recordings/${sessionId}/replay-eq`),
                fetch(`/api/recordings/${sessionId}/annotations`),
                fetch(`/api/recordings/${sessionId}/video-sync`),
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

            let syncConfig: VideoSyncConfig | null = null;
            if (videoSyncRes.ok) {
                syncConfig = await videoSyncRes.json();
            }

            activeSessionId.current = sessionId;
            setAnnotations(loadedAnnotations);
            setVideoSyncConfig(syncConfig);
            setVideoCacheBust(Date.now());
            setIsVideoPlaying(false);
            videoTimeRef.current = 0;
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
        setVideoSyncConfig(null);
        setIsVideoPlaying(false);
        videoTimeRef.current = 0;
        setViewMode('timeline');
        setScrollToTimestamp(null);
        setSession(loaded);
    }, []);

    const handleBack = useCallback(() => {
        activeSessionId.current = null;
        setAnnotations([]);
        setVideoSyncConfig(null);
        setIsVideoPlaying(false);
        videoTimeRef.current = 0;
        setViewMode('timeline');
        setScrollToTimestamp(null);
        setSession(null);
    }, []);

    // Video callbacks
    const handleVideoSeek = useCallback((timestamp: number) => {
        videoPlayerRef.current?.seekToSessionTimestamp(timestamp);
    }, []);

    const handleVideoUploadComplete = useCallback((ext: 'mp4' | 'webm') => {
        setVideoSyncConfig(prev => ({
            videoTimeAtSessionStartSeconds: prev?.videoTimeAtSessionStartSeconds ?? 0,
            videoExtension: ext,
        }));
        setVideoCacheBust(Date.now());
    }, []);

    const handleOffsetChange = useCallback(async (newOffset: number) => {
        if (!activeSessionId.current || !videoSyncConfig) return;
        const updated = { ...videoSyncConfig, videoTimeAtSessionStartSeconds: newOffset };
        setVideoSyncConfig(updated);
        await fetch(`/api/recordings/${activeSessionId.current}/video-sync`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updated),
        }).catch(() => {/* best-effort */});
    }, [videoSyncConfig]);

    const handleVideoPlayStateChange = useCallback((playing: boolean) => {
        setIsVideoPlaying(playing);
    }, []);

    // Use metadata.startTime if available, otherwise the earliest event timestamp
    const sessionStartTime = useMemo(() => {
        if (!session) return 0;
        if (session.metadata?.startTime != null) return session.metadata.startTime;
        if (session.events.length === 0) return 0;
        let min = session.events[0].timestamp;
        for (let i = 1; i < session.events.length; i++) {
            if (session.events[i].timestamp < min) min = session.events[i].timestamp;
        }
        return min;
    }, [session]);
    const [viewMode, setViewMode] = useState<'timeline' | 'list'>('timeline');
    const [scrollToTimestamp, setScrollToTimestamp] = useState<number | null>(null);

    const handleViewInList = useCallback((timestamp: number) => {
        setScrollToTimestamp(timestamp);
        setViewMode('list');
    }, []);

    const handleScrollComplete = useCallback(() => {
        setScrollToTimestamp(null);
    }, []);

    // Shared xDomain: compute from all events + annotations + replayEq
    const xDomain = useMemo<[number, number] | undefined>(() => {
        if (!session || session.events.length === 0) return undefined;
        let min = Infinity;
        let max = -Infinity;
        for (const e of session.events) {
            const offset = e.timestamp - sessionStartTime;
            if (offset < min) min = offset;
            if (offset > max) max = offset;
        }
        for (const a of annotations) {
            const offset = a.timestamp - sessionStartTime;
            if (offset < min) min = offset;
            if (offset > max) max = offset;
        }
        if (session.replayEq) {
            for (const r of session.replayEq) {
                const offset = r.timestamp - sessionStartTime;
                if (offset < min) min = offset;
                if (offset > max) max = offset;
            }
        }
        const padding = Math.max((max - min) * 0.03, 1000);
        return [Math.max(0, min - padding), max + padding];
    }, [session, annotations, sessionStartTime]);

    const sessionEndTime = useMemo(() => {
        if (!session || session.events.length === 0) return sessionStartTime;
        let max = session.events[0].timestamp;
        for (let i = 1; i < session.events.length; i++) {
            if (session.events[i].timestamp > max) max = session.events[i].timestamp;
        }
        return max;
    }, [session, sessionStartTime]);

    const videoUrl = activeSessionId.current && videoSyncConfig
        ? `/api/recordings/${encodeURIComponent(activeSessionId.current)}/video?v=${videoCacheBust}`
        : null;

    return (
        <div className="app">
            <header className="app-header">
                <h1>Artemis Extension Session Analyzer</h1>
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
                    {activeSessionId.current && videoSyncConfig && videoUrl && (
                        <div className="video-section">
                            <VideoPlayer
                                ref={videoPlayerRef}
                                sessionStartTime={sessionStartTime}
                                sessionEndTime={sessionEndTime}
                                videoTimeAtSessionStartSeconds={videoSyncConfig.videoTimeAtSessionStartSeconds}
                                videoUrl={videoUrl}
                                videoTimeRef={videoTimeRef}
                                onPlayStateChange={handleVideoPlayStateChange}
                            />
                            <div className="video-config-row">
                                <OffsetConfig
                                    videoTimeAtSessionStartSeconds={videoSyncConfig.videoTimeAtSessionStartSeconds}
                                    onOffsetChange={handleOffsetChange}
                                />
                                <VideoUpload
                                    sessionId={activeSessionId.current}
                                    hasVideo={true}
                                    onUploadComplete={handleVideoUploadComplete}
                                />
                            </div>
                        </div>
                    )}
                    {activeSessionId.current && !videoSyncConfig && (
                        <VideoUpload
                            sessionId={activeSessionId.current}
                            hasVideo={false}
                            onUploadComplete={handleVideoUploadComplete}
                        />
                    )}
                    <SessionInfo session={session} />
                    <SessionTimeline
                        events={session.events}
                        sessionStartTime={sessionStartTime}
                        replayEq={session.replayEq}
                        annotations={annotations}
                        xDomain={xDomain}
                        videoTimeRef={videoTimeRef}
                    />
                    <div className="filter-bar shared-filter-bar">
                        <button
                            className="filter-btn toggle-all"
                            onClick={() => setEnabledTypes(new Set(ALL_EVENT_TYPES))}
                        >
                            all
                        </button>
                        <button
                            className="filter-btn toggle-all"
                            onClick={() => setEnabledTypes(new Set())}
                        >
                            none
                        </button>
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
                    <div className="view-toggle-row">
                        <div className="view-toggle">
                            <button
                                className={`view-toggle-btn ${viewMode === 'timeline' ? 'active' : ''}`}
                                onClick={() => setViewMode('timeline')}
                            >
                                Timeline
                            </button>
                            <button
                                className={`view-toggle-btn ${viewMode === 'list' ? 'active' : ''}`}
                                onClick={() => setViewMode('list')}
                            >
                                List
                            </button>
                        </div>
                        <FreeAnnotationForm
                            sessionStartTime={sessionStartTime}
                            onAdd={handleAddAnnotation}
                            videoTimeRef={videoSyncConfig ? videoTimeRef : undefined}
                            annotationCount={annotations.length}
                        />
                    </div>
                    {viewMode === 'timeline' && xDomain && (
                        <TrackingTimeline
                            events={session.events}
                            sessionStartTime={sessionStartTime}
                            xDomain={xDomain}
                            annotations={annotations}
                            enabledTypes={enabledTypes}
                            onAddAnnotation={handleAddAnnotation}
                            onUpdateAnnotation={handleUpdateAnnotation}
                            onDeleteAnnotation={handleDeleteAnnotation}
                            onViewInList={handleViewInList}
                            videoTimeRef={videoTimeRef}
                            onSeekVideo={videoSyncConfig ? handleVideoSeek : undefined}
                            videoTimeAtSessionStartSeconds={videoSyncConfig?.videoTimeAtSessionStartSeconds}
                        />
                    )}
                    {viewMode === 'list' && (
                        <EventStream
                            events={session.events}
                            sessionStartTime={sessionStartTime}
                            annotations={annotations}
                            enabledTypes={enabledTypes}
                            onAddAnnotation={handleAddAnnotation}
                            onUpdateAnnotation={handleUpdateAnnotation}
                            onDeleteAnnotation={handleDeleteAnnotation}
                            scrollToTimestamp={scrollToTimestamp}
                            onScrollComplete={handleScrollComplete}
                            videoTimeRef={videoTimeRef}
                            isVideoPlaying={isVideoPlaying}
                            onSeekVideo={videoSyncConfig ? handleVideoSeek : undefined}
                        />
                    )}
                </div>
            )}
        </div>
    );
}

export default App;
