import { useState, useCallback, useRef, useMemo, useEffect, useDeferredValue } from 'react';
import type { Annotation, LoadedSession, RecordedEvent, SessionMetadata, SessionStartEvent, ReplayEqSnapshot, VideoSyncConfig } from './types';
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
import { LiveControlBar } from './components/LiveControlBar';
import { HotkeyLegend } from './components/HotkeyLegend';
import { ALL_EVENT_TYPES } from './constants';
import type { AuthStatus } from './hooks/useAuth';
import { useLiveSessions } from './hooks/useLiveSessions';
import { useOpenLiveOnSpace } from './hooks/useOpenLiveOnSpace';
import { useLiveSession } from './hooks/useLiveSession';
import { useAnnotationMutations, type AnnotationToast } from './hooks/useAnnotationMutations';
import { ToastStack, appendToast, MAX_TOASTS, TOAST_DURATION_MS, type ActiveToast } from './components/ToastStack';
import { RaterComparisonView } from './components/RaterComparisonView';
import { useLiveHotkeys } from './hooks/useLiveHotkeys';
import { useResearcherLanePolling } from './hooks/useResearcherLanePolling';

const ALL_ENABLED = new Set(ALL_EVENT_TYPES);

interface RecordingViewerAppProps { authStatus: AuthStatus }

export function RecordingViewerApp({ authStatus }: RecordingViewerAppProps) {
    const apiFetch = useCallback((url: string, init?: RequestInit) => {
        return fetch(url, { ...init, credentials: 'include' });
    }, []);
    const [session, setSession] = useState<LoadedSession | null>(null);
    const [loading, setLoading] = useState(false);
    const [annotations, setAnnotations] = useState<Annotation[]>([]);
    const [researcherLanes, setResearcherLanes] = useState<Array<{ raterId: string; raterName: string; annotations: Annotation[] }> | null>(null);
    const activeSessionId = useRef<string | null>(null);
    const isResearcher = authStatus.role === 'researcher';

    // Video state
    const [videoSyncConfig, setVideoSyncConfig] = useState<VideoSyncConfig | null>(null);
    const [hasSubtitles, setHasSubtitles] = useState(false);
    const [isVideoPlaying, setIsVideoPlaying] = useState(false);
    const [videoCacheBust, setVideoCacheBust] = useState(0);
    const videoTimeRef = useRef<number>(0);
    const videoPlayerRef = useRef<VideoPlayerHandle>(null);

    // Live state
    const [toasts, setToasts] = useState<ActiveToast[]>([]);
    const nextToastId = useRef(0);
    const pushToast = useCallback((toast: AnnotationToast) => {
        const id = nextToastId.current++;
        setToasts(prev => appendToast(prev, { ...toast, id }, MAX_TOASTS));
    }, []);
    const dismissToast = useCallback((id: number) => {
        setToasts(prev => prev.filter(t => t.id !== id));
    }, []);
    const [stickyLive, setStickyLive] = useState(false);

    // Pending timeline marker position (click-to-place). The ref mirrors the
    // state synchronously so a label keypress immediately after a click reads
    // the fresh value (an effect-based mirror would lag a commit and re-introduce
    // the race).
    const [pendingTimestamp, setPendingTimestamp] = useState<number | null>(null);
    const pendingTsRef = useRef<number | null>(null);
    const setPending = useCallback((ts: number | null) => {
        pendingTsRef.current = ts;   // synchronous, no render lag
        setPendingTimestamp(ts);
    }, []);

    // Track most recently ended live session so latch-on cannot flip back to live
    // during the brief window between sessionEnd event arrival and metadata.json
    // being written by the recorder (the live-sessions endpoint may still report
    // the session as live for a moment).
    const [endedLiveSessionId, setEndedLiveSessionId] = useState<string | null>(null);

    const liveSessionIds = useLiveSessions(true);

    const isLiveSession = stickyLive;
    const isReadOnly = !authStatus.allowWrite || isResearcher;
    const writesDisabled = isLiveSession || isReadOnly;

    const loadFromApi = useCallback(async (sessionId: string, isLive: boolean, tailLimit?: number) => {
        activeSessionId.current = sessionId; // claim ownership before any await
        setLoading(true);
        setViewMode('timeline');
        setScrollToTimestamp(null);
        setToasts([]);
        setStickyLive(isLive); // immediate latch — bypasses polling cadence
        try {
            const eventsUrl = isLive
                ? null
                : tailLimit !== undefined
                    ? `/api/recordings/${sessionId}/events?tail=${tailLimit}`
                    : `/api/recordings/${sessionId}/events`;
            const annotationsUrl = isResearcher
                ? `/api/recordings/${sessionId}/annotations/all`
                : `/api/recordings/${sessionId}/annotations`;
            const fetches: Promise<Response>[] = [
                eventsUrl ? apiFetch(eventsUrl) : Promise.resolve(new Response('[]', { status: 200 })),
                apiFetch(`/api/recordings/${sessionId}/metadata`),
                apiFetch(`/api/recordings/${sessionId}/replay-eq`),
                apiFetch(annotationsUrl),
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
                const json = await annotRes.json();
                if (isResearcher) {
                    setResearcherLanes(json as Array<{ raterId: string; raterName: string; annotations: Annotation[] }>);
                    loadedAnnotations = []; // single-rater list stays empty for researcher
                } else {
                    setResearcherLanes(null);
                    loadedAnnotations = json;
                }
            } else if (isResearcher) {
                setResearcherLanes(null);
            }

            let syncConfig: VideoSyncConfig | null = null;
            if (videoSyncRes.ok) {
                syncConfig = await videoSyncRes.json();
            }

            mutator.reset(loadedAnnotations);
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
    // `mutator` is stable (memoized with [] deps in useAnnotationMutations) so
    // including it here doesn't churn the callback identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [apiFetch, isResearcher]);

    const live = useLiveSession(activeSessionId.current, isLiveSession);

    const showAnnotationError = useCallback((message: string) => {
        // Surface mutator failures through the toast stack (same channel as adds).
        console.warn('[annotations]', message);
        pushToast({ kind: 'error', text: message, at: Date.now() });
    }, [pushToast]);
    const mutator = useAnnotationMutations({
        sessionId: activeSessionId.current,
        raterName: authStatus.raterName,
        setAnnotations,
        onToast: pushToast,
        onError: showAnnotationError,
    });

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

    // On the session list, Space opens a live recording (live-only convenience).
    const openLiveSession = useCallback((id: string) => { void loadFromApi(id, true); }, [loadFromApi]);
    useOpenLiveOnSpace(!session && !loading, liveSessionIds, openLiveSession);

    // Whenever sticky-live transitions ON, reseed the mutator from the latest
    // annotations so any archive-mode edits made before the latch don't leave
    // the controller's `annotationsRef` stale. Reset also clears the redo
    // stack, which is the right semantic for entering a fresh live session.
    useEffect(() => {
        if (isLiveSession) {
            mutator.reset(annotations);
        }
    // We INTENTIONALLY don't depend on `annotations` here — only on the latch
    // edge. Mid-live edits flow through the controller already.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isLiveSession, mutator]);

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

    // While a researcher watches a LIVE session, poll the all-lanes endpoint
    // once a second so raters' new marks appear without a manual reload. Only
    // the lanes refresh; the researcher's video/zoom/scroll stay put.
    useResearcherLanePolling(isResearcher && isLiveSession, activeSessionId, apiFetch, setResearcherLanes);

    // Hotkeys enabled for any rater with a session loaded. The reference timestamp
    // is a clicked pending position if one is set (in any mode); otherwise the
    // latest observed event in live mode, or the video playback cursor projected
    // onto the absolute event timeline (session start as a fallback) when offline.
    const onEscape = useCallback(() => {
        if (pendingTsRef.current != null) { setPending(null); return true; }
        return false;
    }, [setPending]);

    useLiveHotkeys(
        !isResearcher && session !== null,
        // pendingTimestamp is intentionally NOT a dep — it is read via the ref so
        // the window keydown listener does not re-subscribe on pending changes.
        useCallback((label) => {
            // Resolve where the marker lands:
            //  - a clicked pending position always wins (precise placement, any mode)
            //  - live: the latest observed event (the red live edge)
            //  - archive: the video playhead (the red line). videoTimeRef already
            //    holds an ABSOLUTE session timestamp (set by VideoPlayer via
            //    videoTimeToSession), so use it directly. It stays 0 until the video
            //    reports a real position; when there is no synced video / no playhead,
            //    there is nothing to anchor to, so the keypress is a no-op.
            const pending = pendingTsRef.current;
            const referenceTs = pending
                ?? (isLiveSession
                    ? live.latestEventTimestamp
                    : (videoTimeRef.current > 0 ? videoTimeRef.current : null));
            if (referenceTs == null) return;
            mutator.addLabel(label, referenceTs, { persistTimestamp: pending != null || !isLiveSession });
            if (pending != null) setPending(null);
        }, [mutator, live.latestEventTimestamp, isLiveSession, setPending]),
        mutator.undoLast,
        mutator.redoLast,
        onEscape,
    );

    // Force-clear pending on every session boundary / live toggle so it can never
    // leak across sessions or into live mode.
    useEffect(() => { setPending(null); }, [session, isLiveSession, setPending]);

    const handleFileSession = useCallback((loaded: LoadedSession) => {
        activeSessionId.current = null;
        mutator.reset(loaded.annotations ?? []);
        setResearcherLanes(null);
        setVideoSyncConfig(null);
        setHasSubtitles(false);
        setIsVideoPlaying(false);
        videoTimeRef.current = 0;
        setViewMode('timeline');
        setScrollToTimestamp(null);
        setToasts([]);
        setZoomedXDomain(null);
        setAutoFollowLive(true);
        setStickyLive(false);
        setEndedLiveSessionId(null);
        setSession(loaded);
    }, [mutator]);

    const handleBack = useCallback(() => {
        activeSessionId.current = null;
        mutator.reset([]);
        setResearcherLanes(null);
        setVideoSyncConfig(null);
        setHasSubtitles(false);
        setIsVideoPlaying(false);
        videoTimeRef.current = 0;
        setViewMode('timeline');
        setScrollToTimestamp(null);
        setToasts([]);
        setZoomedXDomain(null);
        setAutoFollowLive(true);
        setSession(null);
    }, [mutator]);

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

    // Defer live event updates so the expensive chart/timeline renders can
    // be interrupted by newer SSE batches. Under sustained load the charts
    // may visibly lag the most-recent event by a frame or two, which is
    // acceptable. live.latestEventTimestamp (used by annotation anchoring)
    // stays non-deferred so hotkey-driven annotations target the correct
    // wall-clock position.
    const liveEventsForDisplay = useDeferredValue(live.events);
    const displayedEvents = useMemo(() => {
        if (!session) return [];
        return isLiveSession ? liveEventsForDisplay : session.events;
    }, [session, isLiveSession, liveEventsForDisplay]);

    // For researcher mode, the regular `annotations` state is empty and
    // per-rater data lives in `researcherLanes`. We flatten the lanes into a
    // single array so the existing single-lane consumers (xDomain math,
    // TrackingTimeline marker overlay, EventStream sidebar) still show the
    // full set of marks. The dedicated multi-lane rendering lives in
    // SessionTimeline.
    const displayAnnotations = useMemo<Annotation[]>(() => {
        if (researcherLanes) {
            return researcherLanes.flatMap(lane => lane.annotations);
        }
        return annotations;
    }, [researcherLanes, annotations]);

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

    // Authoritative session start for the live elapsed timer: metadata.startTime,
    // else the sessionStart event's timestamp. Deliberately NOT the generic
    // earliest-event fallback above — on a late join that would understate
    // elapsed. Latched per session so that once an authoritative start is seen
    // it survives the live buffer trimming the sessionStart event out of the
    // sliding window. 0 (hidden) until a source is observed.
    const liveStartRef = useRef<{ id: string | null; start: number }>({ id: null, start: 0 });
    const liveElapsedStart = useMemo(() => {
        const id = session?.fileName ?? null;
        if (liveStartRef.current.id !== id) {
            liveStartRef.current = { id, start: 0 };
        }
        if (liveStartRef.current.start === 0 && session) {
            const authoritative = session.metadata?.startTime
                ?? displayedEvents.find(e => e.type === 'sessionStart')?.timestamp
                ?? 0;
            if (authoritative > 0) liveStartRef.current.start = authoritative;
        }
        return liveStartRef.current.start;
    }, [session, displayedEvents]);
    const [viewMode, setViewMode] = useState<'timeline' | 'list' | 'compare'>('timeline');
    const [scrollToTimestamp, setScrollToTimestamp] = useState<number | null>(null);
    const [zoomedXDomain, setZoomedXDomain] = useState<[number, number] | null>(null);
    const [autoFollowLive, setAutoFollowLive] = useState(true);
    const [hideEmptyLanes, setHideEmptyLanes] = useState(false);

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
        for (const a of displayAnnotations) {
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
    }, [session, displayedEvents, displayAnnotations, sessionStartTime]);

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

    // Archive mode: keep the video playhead in view while zoomed. The playhead
    // lives in videoTimeRef (updated per frame by the player without re-rendering),
    // so poll it on an rAF loop instead of reacting to state. Reposition only when
    // it drifts out of a comfortable band, so setState (and canvas redraws) stay
    // infrequent (~once per page). Manual pan/zoom flips autoFollow off, tearing
    // this loop down. setZoomedXDomain here does not echo back through onZoomChange
    // (useTimelinePan emits that only on user drag), so follow stays on.
    useEffect(() => {
        if (!autoFollowLive || isLiveSession || !zoomedXDomain || !xDomain || !videoSyncConfig) return;
        const [min, max] = zoomedXDomain;
        const range = max - min;
        const margin = range * 0.15;
        let rafId: number;
        const tick = () => {
            const playhead = videoTimeRef.current;
            if (playhead > 0 && (playhead < min + margin || playhead > max - margin)) {
                let newMin = playhead - margin;
                let newMax = newMin + range;
                if (newMin < xDomain[0]) { newMin = xDomain[0]; newMax = newMin + range; }
                if (newMax > xDomain[1]) { newMax = xDomain[1]; newMin = newMax - range; }
                // Skip no-op repositions (e.g. clamped at a timeline edge) so we
                // don't setState every frame when the window can't move further.
                if (Math.abs(newMin - min) >= 1 || Math.abs(newMax - max) >= 1) {
                    setZoomedXDomain([newMin, newMax]);
                    return; // effect re-runs with the new window; a fresh loop continues
                }
            }
            rafId = requestAnimationFrame(tick);
        };
        rafId = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(rafId);
    }, [autoFollowLive, isLiveSession, zoomedXDomain, xDomain, videoSyncConfig]);

    const handleToggleAutoFollow = useCallback(() => {
        const next = !autoFollowLive;
        setAutoFollowLive(next);
        if (next && zoomedXDomain && xDomain) {
            const range = zoomedXDomain[1] - zoomedXDomain[0];
            if (isLiveSession) {
                setZoomedXDomain([xDomain[1] - range, xDomain[1]]);
            } else {
                // Center the window on the current playhead when enabling follow.
                const playhead = videoTimeRef.current > 0 ? videoTimeRef.current : zoomedXDomain[0];
                let newMin = playhead - range / 2;
                let newMax = newMin + range;
                if (newMin < xDomain[0]) { newMin = xDomain[0]; newMax = newMin + range; }
                if (newMax > xDomain[1]) { newMax = xDomain[1]; newMin = newMax - range; }
                setZoomedXDomain([newMin, newMax]);
            }
        }
    }, [autoFollowLive, isLiveSession, xDomain, zoomedXDomain]);

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

    // Click-to-place is only meaningful in a server-backed archival session. A
    // file-loaded session has activeSessionId.current === null (addLabel is a
    // silent no-op). Reading the ref during render is safe: every file-vs-server
    // transition sets it synchronously and then re-renders via setSession.
    const isServerSession = session !== null && activeSessionId.current !== null;

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
                            bufferSize={live.events.length}
                            totalReceived={live.totalReceived}
                            latestEventTimestamp={live.latestEventTimestamp}
                            startTime={liveElapsedStart}
                        />
                    )}
                    {activeSessionId.current && !writesDisabled && (
                        <div className="hotkey-legend-bar">
                            <HotkeyLegend />
                        </div>
                    )}
                    <SessionInfo session={session} events={displayedEvents} />
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
                            {isResearcher && researcherLanes && xDomain && (
                                <button
                                    className={`view-toggle-btn ${viewMode === 'compare' ? 'active' : ''}`}
                                    onClick={() => setViewMode('compare')}
                                >
                                    Compare
                                </button>
                            )}
                        </div>
                        {viewMode === 'timeline' && xDomain && (
                            <div className="zoom-controls">
                                <label
                                    className="lane-toggle"
                                    title={hideEmptyLanes
                                        ? 'Showing only lanes with events — switch off to show all lanes'
                                        : 'Showing all lanes — switch on to hide the empty ones'}
                                >
                                    <span className="lane-toggle-text">Hide empty lanes</span>
                                    <input
                                        type="checkbox"
                                        className="lane-toggle-input"
                                        checked={hideEmptyLanes}
                                        onChange={e => setHideEmptyLanes(e.target.checked)}
                                    />
                                    <span className="lane-toggle-slider" />
                                </label>
                                {/* Reset/Follow sit between the toggle and the zoom +/- buttons,
                                    so the +/- stay pinned to the right edge and don't shift when
                                    these conditional buttons appear/disappear. */}
                                {zoomedXDomain && (
                                    <button className="zoom-btn reset" onClick={() => setZoomedXDomain(null)} title="Reset zoom">Reset</button>
                                )}
                                {zoomedXDomain && (isLiveSession || videoSyncConfig) && (
                                    <button
                                        className={`zoom-btn follow ${autoFollowLive ? 'active' : ''}`}
                                        onClick={handleToggleAutoFollow}
                                        title={`Auto-follow ${isLiveSession ? 'latest events' : 'playhead'} (${autoFollowLive ? 'on' : 'off'})`}
                                    >
                                        Follow
                                    </button>
                                )}
                                <button className="zoom-btn" onClick={handleZoomIn} title="Zoom in">+</button>
                                <button className="zoom-btn" onClick={handleZoomOut} title="Zoom out">&minus;</button>
                            </div>
                        )}
                    </div>
                    {viewMode === 'timeline' && effectiveXDomain && (
                        <div className="stacked-timelines">
                            <SessionTimeline
                                events={displayedEvents}
                                sessionStartTime={sessionStartTime}
                                replayEq={session.replayEq}
                                annotations={displayAnnotations}
                                researcherLanes={researcherLanes ?? undefined}
                                xDomain={xDomain}
                                zoomedRange={zoomedXDomain ?? undefined}
                                videoTimeRef={videoTimeRef}
                            />
                            <TrackingTimeline
                                events={displayedEvents}
                                sessionStartTime={sessionStartTime}
                                xDomain={effectiveXDomain}
                                fullXDomain={xDomain}
                                annotations={displayAnnotations}
                                enabledTypes={ALL_ENABLED}
                                hideEmptyLanes={hideEmptyLanes}
                                readOnly={writesDisabled}
                                onViewInList={handleViewInList}
                                videoTimeRef={videoTimeRef}
                                onSeekVideo={videoSyncConfig ? handleVideoSeek : undefined}
                                videoTimeAtSessionStartSeconds={videoSyncConfig?.videoTimeAtSessionStartSeconds}
                                onZoomChange={handleZoomChange}
                                pendingTimestamp={pendingTimestamp}
                                onSetPendingPosition={isServerSession && !isResearcher ? setPending : undefined}
                            />
                        </div>
                    )}
                    {viewMode === 'list' && (
                        <EventStream
                            events={displayedEvents}
                            sessionStartTime={sessionStartTime}
                            annotations={displayAnnotations}
                            enabledTypes={ALL_ENABLED}
                            readOnly={writesDisabled}
                            scrollToTimestamp={scrollToTimestamp}
                            onScrollComplete={handleScrollComplete}
                            videoTimeRef={videoTimeRef}
                            isVideoPlaying={isVideoPlaying}
                            onSeekVideo={videoSyncConfig ? handleVideoSeek : undefined}
                        />
                    )}
                    {viewMode === 'compare' && researcherLanes && xDomain && (
                        <RaterComparisonView
                            researcherLanes={researcherLanes}
                            xDomain={xDomain}
                            sessionStartTime={sessionStartTime}
                            videoTimeRef={videoTimeRef}
                            onSeekVideo={videoSyncConfig ? handleVideoSeek : undefined}
                        />
                    )}
                </div>
            )}
            <ToastStack toasts={toasts} durationMs={TOAST_DURATION_MS} onDismiss={dismissToast} />
        </div>
    );
}
