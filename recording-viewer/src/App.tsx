import { useState, useCallback, useRef, useMemo } from 'react';
import type { Annotation, AnnotationLabel, LoadedSession, RecordedEvent, SessionMetadata, ReplayEqSnapshot, VideoSyncConfig } from './types';
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
import { SubtitleUpload } from './components/SubtitleUpload';
import { OffsetConfig } from './components/OffsetConfig';
import { FreeAnnotationForm } from './components/FreeAnnotationForm';
import { ALL_EVENT_TYPES } from './constants';

const ALL_ENABLED = new Set(ALL_EVENT_TYPES);

function App() {
    const [session, setSession] = useState<LoadedSession | null>(null);
    const [loading, setLoading] = useState(false);
    const [annotations, setAnnotations] = useState<Annotation[]>([]);
    const activeSessionId = useRef<string | null>(null);

    // Video state
    const [videoSyncConfig, setVideoSyncConfig] = useState<VideoSyncConfig | null>(null);
    const [hasSubtitles, setHasSubtitles] = useState(false);
    const [isVideoPlaying, setIsVideoPlaying] = useState(false);
    const [videoCacheBust, setVideoCacheBust] = useState(0);
    const videoTimeRef = useRef<number>(0);
    const videoPlayerRef = useRef<VideoPlayerHandle>(null);

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
            const [eventsRes, metaRes, replayRes, annotRes, videoSyncRes, subsRes] = await Promise.all([
                fetch(`/api/recordings/${sessionId}/events`),
                fetch(`/api/recordings/${sessionId}/metadata`),
                fetch(`/api/recordings/${sessionId}/replay-eq`),
                fetch(`/api/recordings/${sessionId}/annotations`),
                fetch(`/api/recordings/${sessionId}/video-sync`),
                fetch(`/api/recordings/${sessionId}/subtitles`, { method: 'HEAD' }),
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
            setHasSubtitles(subsRes.ok);
            setVideoCacheBust(Date.now());
            setIsVideoPlaying(false);
            videoTimeRef.current = 0;
            setZoomedXDomain(null);
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
        setHasSubtitles(false);
        setIsVideoPlaying(false);
        videoTimeRef.current = 0;
        setViewMode('timeline');
        setScrollToTimestamp(null);
        setZoomedXDomain(null);
        setSession(loaded);
    }, []);

    const handleBack = useCallback(() => {
        activeSessionId.current = null;
        setAnnotations([]);
        setVideoSyncConfig(null);
        setHasSubtitles(false);
        setIsVideoPlaying(false);
        videoTimeRef.current = 0;
        setViewMode('timeline');
        setScrollToTimestamp(null);
        setZoomedXDomain(null);
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

    const handleSubtitleUploadComplete = useCallback(() => {
        setHasSubtitles(true);
        setVideoCacheBust(Date.now());
        // `<track>` is remounted via React key change; force-activate after new load.
        requestAnimationFrame(() => videoPlayerRef.current?.showSubtitles());
    }, []);

    const handleOpenSessionFolder = useCallback(() => {
        if (!activeSessionId.current) return;
        fetch(`/api/recordings/${encodeURIComponent(activeSessionId.current)}/open`, { method: 'POST' })
            .catch(() => {/* best-effort */});
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
    const [zoomedXDomain, setZoomedXDomain] = useState<[number, number] | null>(null);

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

    const effectiveXDomain = zoomedXDomain ?? xDomain;

    const handleZoomChange = useCallback((domain: [number, number] | null) => {
        setZoomedXDomain(domain);
    }, []);

    const handleZoomIn = useCallback(() => {
        if (!xDomain) return;
        const current = zoomedXDomain ?? xDomain;
        const [min, max] = current;
        const range = max - min;
        const newRange = range / 1.5;
        if (newRange < 2000) return;
        const center = (min + max) / 2;
        setZoomedXDomain([center - newRange / 2, center + newRange / 2]);
    }, [xDomain, zoomedXDomain]);

    const handleZoomOut = useCallback(() => {
        if (!xDomain) return;
        const current = zoomedXDomain ?? xDomain;
        const [min, max] = current;
        const range = max - min;
        const fullRange = xDomain[1] - xDomain[0];
        const newRange = range * 1.5;
        if (newRange >= fullRange) {
            setZoomedXDomain(null);
            return;
        }
        let newMin = (min + max) / 2 - newRange / 2;
        let newMax = (min + max) / 2 + newRange / 2;
        if (newMin < xDomain[0]) { newMin = xDomain[0]; newMax = newMin + newRange; }
        if (newMax > xDomain[1]) { newMax = xDomain[1]; newMin = newMax - newRange; }
        setZoomedXDomain([newMin, newMax]);
    }, [xDomain, zoomedXDomain]);

    const videoUrl = activeSessionId.current && videoSyncConfig
        ? `/api/recordings/${encodeURIComponent(activeSessionId.current)}/video?v=${videoCacheBust}`
        : null;

    const subtitlesUrl = activeSessionId.current && hasSubtitles
        ? `/api/recordings/${encodeURIComponent(activeSessionId.current)}/subtitles?v=${videoCacheBust}`
        : null;

    return (
        <div className="app">
            <header className="app-header">
                <h1>Artemis Extension Session Analyzer</h1>
                {session && (
                    <div className="header-actions">
                        {activeSessionId.current && (
                            <button className="reset-btn" onClick={handleOpenSessionFolder} title="Open session folder in Finder">
                                Open Folder
                            </button>
                        )}
                        <button className="reset-btn" onClick={handleBack}>
                            &larr; Back
                        </button>
                    </div>
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
                                subtitlesUrl={subtitlesUrl}
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
                                <SubtitleUpload
                                    sessionId={activeSessionId.current}
                                    hasSubtitles={hasSubtitles}
                                    onUploadComplete={handleSubtitleUploadComplete}
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
                        {viewMode === 'timeline' && xDomain && (
                            <div className="zoom-controls">
                                <button className="zoom-btn" onClick={handleZoomIn} title="Zoom in">+</button>
                                <button className="zoom-btn" onClick={handleZoomOut} title="Zoom out">&minus;</button>
                                {zoomedXDomain && (
                                    <button className="zoom-btn reset" onClick={() => setZoomedXDomain(null)} title="Reset zoom">Reset</button>
                                )}
                            </div>
                        )}
                        <FreeAnnotationForm
                            sessionStartTime={sessionStartTime}
                            onAdd={handleAddAnnotation}
                            videoTimeRef={videoSyncConfig ? videoTimeRef : undefined}
                            annotationCount={annotations.length}
                        />
                    </div>
                    {viewMode === 'timeline' && effectiveXDomain && (
                        <div className="stacked-timelines">
                            <SessionTimeline
                                events={session.events}
                                sessionStartTime={sessionStartTime}
                                replayEq={session.replayEq}
                                annotations={annotations}
                                xDomain={xDomain}
                                zoomedRange={zoomedXDomain ?? undefined}
                                videoTimeRef={videoTimeRef}
                            />
                            <TrackingTimeline
                                events={session.events}
                                sessionStartTime={sessionStartTime}
                                xDomain={effectiveXDomain}
                                fullXDomain={xDomain}
                                annotations={annotations}
                                enabledTypes={ALL_ENABLED}
                                onAddAnnotation={handleAddAnnotation}
                                onUpdateAnnotation={handleUpdateAnnotation}
                                onDeleteAnnotation={handleDeleteAnnotation}
                                onViewInList={handleViewInList}
                                videoTimeRef={videoTimeRef}
                                onSeekVideo={videoSyncConfig ? handleVideoSeek : undefined}
                                videoTimeAtSessionStartSeconds={videoSyncConfig?.videoTimeAtSessionStartSeconds}
                                onZoomChange={handleZoomChange}
                            />
                        </div>
                    )}
                    {viewMode === 'list' && (
                        <EventStream
                            events={session.events}
                            sessionStartTime={sessionStartTime}
                            annotations={annotations}
                            enabledTypes={ALL_ENABLED}
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
