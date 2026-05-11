import { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import type { Annotation, AnnotationLabel, LoadedSession, RecordedEvent, SessionMetadata, SessionStartEvent, ReplayEqSnapshot, VideoSyncConfig } from './types';
import { resolveSchemaVersion } from './parseSession';
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
import { LiveControlBar } from './components/LiveControlBar';
import { ALL_EVENT_TYPES } from './constants';
import type { AuthStatus } from './hooks/useAuth';
import { useLiveSessions } from './hooks/useLiveSessions';
import { useLiveSession } from './hooks/useLiveSession';
import { useLiveAnnotations } from './hooks/useLiveAnnotations';
import { useLiveHotkeys } from './hooks/useLiveHotkeys';

const ALL_ENABLED = new Set(ALL_EVENT_TYPES);

interface RecordingViewerAppProps { authStatus: AuthStatus }

export function RecordingViewerApp({ authStatus }: RecordingViewerAppProps) {
    const apiFetch = useCallback((url: string, init?: RequestInit) => {
        return fetch(url, { ...init, credentials: 'include' });
    }, []);
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

    // Live state
    const [reactionDelayMs, setReactionDelayMs] = useState(300);
    const [lastLabelToast, setLastLabelToast] = useState<{ label: string; at: number } | null>(null);
    const [stickyLive, setStickyLive] = useState(false);

    // Track most recently ended live session so latch-on cannot flip back to live
    // during the brief window between sessionEnd event arrival and metadata.json
    // being written by the recorder (the live-sessions endpoint may still report
    // the session as live for a moment).
    const [endedLiveSessionId, setEndedLiveSessionId] = useState<string | null>(null);

    const liveSessionIds = useLiveSessions(true);

    const isLiveSession = stickyLive;
    const isReadOnly = !authStatus.allowWrite;
    const writesDisabled = isLiveSession || isReadOnly;

    const saveAnnotations = useCallback(async (updated: Annotation[]) => {
        setAnnotations(updated);
        if (activeSessionId.current) {
            await apiFetch(`/api/recordings/${activeSessionId.current}/annotations`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updated),
            }).catch((err) => {
                console.warn('Failed to persist annotations:', err);
            });
        }
    }, [apiFetch]);

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

    const loadFromApi = useCallback(async (sessionId: string, isLive: boolean, tailLimit?: number) => {
        activeSessionId.current = sessionId; // claim ownership before any await
        setLoading(true);
        setViewMode('timeline');
        setScrollToTimestamp(null);
        setStickyLive(isLive); // immediate latch — bypasses polling cadence
        try {
            const eventsUrl = isLive
                ? null
                : tailLimit !== undefined
                    ? `/api/recordings/${sessionId}/events?tail=${tailLimit}`
                    : `/api/recordings/${sessionId}/events`;
            const fetches: Promise<Response>[] = [
                eventsUrl ? apiFetch(eventsUrl) : Promise.resolve(new Response('[]', { status: 200 })),
                apiFetch(`/api/recordings/${sessionId}/metadata`),
                apiFetch(`/api/recordings/${sessionId}/replay-eq`),
                apiFetch(`/api/recordings/${sessionId}/annotations`),
                apiFetch(`/api/recordings/${sessionId}/video-sync`),
                apiFetch(`/api/recordings/${sessionId}/subtitles`, { method: 'HEAD' }),
            ];
            const [eventsRes, metaRes, replayRes, annotRes, videoSyncRes, subsRes] = await Promise.all(fetches);
            if (activeSessionId.current !== sessionId) return; // user navigated away during fetch

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

            setAnnotations(loadedAnnotations);
            setVideoSyncConfig(syncConfig);
            setHasSubtitles(subsRes.ok);
            setVideoCacheBust(Date.now());
            setIsVideoPlaying(false);
            videoTimeRef.current = 0;
            setZoomedXDomain(null);
            setAutoFollowLive(true);
            const firstSessionStart = events.find(e => e.type === 'sessionStart') as SessionStartEvent | undefined;
            const schemaVersion = resolveSchemaVersion(metadata, firstSessionStart);
            setSession({ metadata, events, fileName: sessionId, schemaVersion, replayEq, annotations: loadedAnnotations });
        } catch (err) {
            console.error('Failed to load session:', err);
        } finally {
            setLoading(false);
        }
    }, [apiFetch]);

    const live = useLiveSession(activeSessionId.current, isLiveSession);
    const liveAnnot = useLiveAnnotations(activeSessionId.current);

    // Latch sticky-live ON the moment we observe the current session in the live set,
    // UNLESS we already saw it end during this view.
    // Note: `loadFromApi(id, isLive)` also sets sticky-live directly when the user clicks
    // a live-badged session, so the initial latch is immediate (not poll-delayed).
    useEffect(() => {
        const id = activeSessionId.current;
        if (id && liveSessionIds.has(id) && endedLiveSessionId !== id) {
            setStickyLive(true);
        }
    }, [liveSessionIds, endedLiveSessionId]);

    // Reset sticky-live + ended-id when leaving the session view.
    useEffect(() => {
        if (session === null) {
            setStickyLive(false);
            setEndedLiveSessionId(null);
        }
    }, [session]);

    // When the live session ends (sessionEnd event OR file disappeared),
    // remember it (suppresses re-latch), drop sticky-live, and after 500ms
    // reload in archive mode.
    useEffect(() => {
        if (live.error === 'Session ended' && activeSessionId.current) {
            const id = activeSessionId.current;
            // Stash current live events into session so display doesn't blank out
            // during the 500ms grace before archive reload.
            setSession((prev) => prev ? { ...prev, events: live.events } : prev);
            setEndedLiveSessionId(id);
            setStickyLive(false);
            setTimeout(() => {
                // Tail-limit the archive reload so a long session can't
                // crash the tab a second time after live mode capped at 5k.
                if (activeSessionId.current === id) void loadFromApi(id, false, 5000);
            }, 500);
        }
    }, [live.error, live.events, loadFromApi]);

    useLiveHotkeys(isLiveSession, useCallback(async (label) => {
        const ann = await liveAnnot.post(label, live.latestEventTimestamp, reactionDelayMs);
        if (ann) {
            setLastLabelToast({ label, at: Date.now() });
            setAnnotations((prev) => [...prev, ann]);
        }
    }, [liveAnnot, live.latestEventTimestamp, reactionDelayMs]));

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
        setAutoFollowLive(true);
        setStickyLive(false);
        setEndedLiveSessionId(null);
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
        setAutoFollowLive(true);
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
        apiFetch(`/api/recordings/${encodeURIComponent(activeSessionId.current)}/open`, { method: 'POST' })
            .catch(() => {/* best-effort */});
    }, [apiFetch]);

    const handleOffsetChange = useCallback(async (newOffset: number) => {
        if (!activeSessionId.current || !videoSyncConfig) return;
        const updated = { ...videoSyncConfig, videoTimeAtSessionStartSeconds: newOffset };
        setVideoSyncConfig(updated);
        await apiFetch(`/api/recordings/${activeSessionId.current}/video-sync`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updated),
        }).catch(() => {/* best-effort */});
    }, [videoSyncConfig, apiFetch]);

    const handleVideoPlayStateChange = useCallback((playing: boolean) => {
        setIsVideoPlaying(playing);
    }, []);

    const displayedEvents = useMemo(() => {
        if (!session) return [];
        return isLiveSession ? live.events : session.events;
    }, [session, isLiveSession, live.events]);

    // Use metadata.startTime if available, otherwise the earliest event timestamp
    const sessionStartTime = useMemo(() => {
        if (!session) return 0;
        if (session.metadata?.startTime != null) return session.metadata.startTime;
        if (displayedEvents.length === 0) return 0;
        let min = displayedEvents[0].timestamp;
        for (let i = 1; i < displayedEvents.length; i++) {
            if (displayedEvents[i].timestamp < min) min = displayedEvents[i].timestamp;
        }
        return min;
    }, [session, displayedEvents]);
    const [viewMode, setViewMode] = useState<'timeline' | 'list'>('timeline');
    const [scrollToTimestamp, setScrollToTimestamp] = useState<number | null>(null);
    const [zoomedXDomain, setZoomedXDomain] = useState<[number, number] | null>(null);
    const [autoFollowLive, setAutoFollowLive] = useState(true);

    const handleViewInList = useCallback((timestamp: number) => {
        setScrollToTimestamp(timestamp);
        setViewMode('list');
    }, []);

    const handleScrollComplete = useCallback(() => {
        setScrollToTimestamp(null);
    }, []);

    // Shared xDomain: compute from all events + annotations + replayEq
    const xDomain = useMemo<[number, number] | undefined>(() => {
        if (!session || displayedEvents.length === 0) return undefined;
        let min = Infinity;
        let max = -Infinity;
        for (const e of displayedEvents) {
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
    }, [session, displayedEvents, annotations, sessionStartTime]);

    const sessionEndTime = useMemo(() => {
        if (!session || displayedEvents.length === 0) return sessionStartTime;
        let max = displayedEvents[0].timestamp;
        for (let i = 1; i < displayedEvents.length; i++) {
            if (displayedEvents[i].timestamp > max) max = displayedEvents[i].timestamp;
        }
        return max;
    }, [session, displayedEvents, sessionStartTime]);

    const effectiveXDomain = zoomedXDomain ?? xDomain;

    // Slide the zoomed window right when new live events arrive, preserving width.
    // Only active when isLiveSession + autoFollowLive + currently zoomed in.
    useEffect(() => {
        if (!autoFollowLive || !isLiveSession || !zoomedXDomain || !xDomain) return;
        if (xDomain[1] <= zoomedXDomain[1]) return;
        const range = zoomedXDomain[1] - zoomedXDomain[0];
        setZoomedXDomain([xDomain[1] - range, xDomain[1]]);
    }, [autoFollowLive, isLiveSession, xDomain, zoomedXDomain]);

    const handleToggleAutoFollow = useCallback(() => {
        const next = !autoFollowLive;
        setAutoFollowLive(next);
        if (next && zoomedXDomain && xDomain) {
            const range = zoomedXDomain[1] - zoomedXDomain[0];
            setZoomedXDomain([xDomain[1] - range, xDomain[1]]);
        }
    }, [autoFollowLive, xDomain, zoomedXDomain]);

    const handleZoomChange = useCallback((domain: [number, number] | null) => {
        setZoomedXDomain(domain);
        setAutoFollowLive(false);
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
        setAutoFollowLive(false);
    }, [xDomain, zoomedXDomain]);

    const handleZoomOut = useCallback(() => {
        if (!xDomain) return;
        const current = zoomedXDomain ?? xDomain;
        const [min, max] = current;
        const range = max - min;
        const fullRange = xDomain[1] - xDomain[0];
        const newRange = range * 1.5;
        setAutoFollowLive(false);
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
                        {activeSessionId.current && !writesDisabled && (
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
                    <SessionList
                        onSelectSession={(id) => void loadFromApi(id, liveSessionIds.has(id))}
                        liveIds={liveSessionIds}
                        readOnly={isReadOnly}
                    />
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
                    {activeSessionId.current && videoSyncConfig && videoUrl && !isLiveSession && (
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
                            {!writesDisabled && (
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
                            )}
                        </div>
                    )}
                    {activeSessionId.current && !videoSyncConfig && !writesDisabled && (
                        <VideoUpload
                            sessionId={activeSessionId.current}
                            hasVideo={false}
                            onUploadComplete={handleVideoUploadComplete}
                        />
                    )}
                    {isLiveSession && (
                        <LiveControlBar
                            connected={live.connected}
                            eventsReceived={live.events.length}
                            latestEventTimestamp={live.latestEventTimestamp}
                            reactionDelayMs={reactionDelayMs}
                            onReactionDelayChange={setReactionDelayMs}
                            lastLabelToast={lastLabelToast}
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
                                {isLiveSession && zoomedXDomain && (
                                    <button
                                        className={`zoom-btn follow ${autoFollowLive ? 'active' : ''}`}
                                        onClick={handleToggleAutoFollow}
                                        title={autoFollowLive ? 'Auto-follow latest events (on)' : 'Auto-follow latest events (off)'}
                                    >
                                        Follow
                                    </button>
                                )}
                            </div>
                        )}
                        {!writesDisabled && (
                            <FreeAnnotationForm
                                sessionStartTime={sessionStartTime}
                                onAdd={handleAddAnnotation}
                                videoTimeRef={videoSyncConfig ? videoTimeRef : undefined}
                                annotationCount={annotations.length}
                            />
                        )}
                    </div>
                    {viewMode === 'timeline' && effectiveXDomain && (
                        <div className="stacked-timelines">
                            <SessionTimeline
                                events={displayedEvents}
                                sessionStartTime={sessionStartTime}
                                replayEq={session.replayEq}
                                annotations={annotations}
                                xDomain={xDomain}
                                zoomedRange={zoomedXDomain ?? undefined}
                                videoTimeRef={videoTimeRef}
                            />
                            <TrackingTimeline
                                events={displayedEvents}
                                sessionStartTime={sessionStartTime}
                                xDomain={effectiveXDomain}
                                fullXDomain={xDomain}
                                annotations={annotations}
                                enabledTypes={ALL_ENABLED}
                                onAddAnnotation={writesDisabled ? undefined : handleAddAnnotation}
                                onUpdateAnnotation={writesDisabled ? undefined : handleUpdateAnnotation}
                                onDeleteAnnotation={writesDisabled ? undefined : handleDeleteAnnotation}
                                readOnly={writesDisabled}
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
                            events={displayedEvents}
                            sessionStartTime={sessionStartTime}
                            annotations={annotations}
                            enabledTypes={ALL_ENABLED}
                            onAddAnnotation={writesDisabled ? undefined : handleAddAnnotation}
                            onUpdateAnnotation={writesDisabled ? undefined : handleUpdateAnnotation}
                            onDeleteAnnotation={writesDisabled ? undefined : handleDeleteAnnotation}
                            readOnly={writesDisabled}
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
