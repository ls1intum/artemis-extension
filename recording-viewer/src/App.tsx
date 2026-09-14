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
import { ALL_EVENT_TYPES_WITH_LEGACY } from './constants';
import type { AuthStatus } from './hooks/useAuth';
import { useLiveSessions } from './hooks/useLiveSessions';
import { useOpenLiveOnSpace } from './hooks/useOpenLiveOnSpace';
import { useLiveSession } from './hooks/useLiveSession';
import { useAnnotationMutations, type AnnotationToast } from './hooks/useAnnotationMutations';
import { ToastStack, appendToast, MAX_TOASTS, TOAST_DURATION_MS, type ActiveToast } from './components/ToastStack';
import { RaterComparisonView } from './components/RaterComparisonView';
import { useLiveHotkeys } from './hooks/useLiveHotkeys';
import { useResearcherLanePolling } from './hooks/useResearcherLanePolling';

const ALL_ENABLED = new Set(ALL_EVENT_TYPES_WITH_LEGACY);

interface RecordingViewerAppProps { authStatus: AuthStatus }

export function RecordingViewerApp({ authStatus }: RecordingViewerAppProps) {
    const apiFetch = useCallback((url: string, init?: RequestInit) => {
        return fetch(url, { ...init, credentials: 'include' });
    }, []);
    const [session, setSession] = useState<LoadedSession | null>(null);
    const [loading, setLoading] = useState(false);
    const [annotations, setAnnotations] = useState<Annotation[]>([]);
    const [researcherLanes, setResearcherLanes] = useState<Array<{ raterId: string; raterName: string; annotations: Annotation[] }> | null>(null);
    // Which session is open. The state is what every render reads; the ref is the
    // synchronous ownership claim, written before the first await so a response
    // that arrives after the user moved on can be discarded. React does not
    // re-render on a ref write, so the two are always set together.
    const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
    const activeSessionIdRef = useRef<string | null>(null);
    const claimSession = useCallback((id: string | null) => {
        activeSessionIdRef.current = id;
        setActiveSessionId(id);
    }, []);
    const isResearcher = authStatus.role === 'researcher';

    const [videoSyncConfig, setVideoSyncConfig] = useState<VideoSyncConfig | null>(null);
    const [hasSubtitles, setHasSubtitles] = useState(false);
    const [isVideoPlaying, setIsVideoPlaying] = useState(false);
    const [videoCacheBust, setVideoCacheBust] = useState(0);
    const videoTimeRef = useRef<number>(0);
    const videoPlayerRef = useRef<VideoPlayerHandle>(null);

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

    const [viewMode, setViewMode] = useState<'timeline' | 'list' | 'compare'>('timeline');
    const [scrollToTimestamp, setScrollToTimestamp] = useState<number | null>(null);
    const [zoomedXDomain, setZoomedXDomain] = useState<[number, number] | null>(null);
    const [autoFollowLive, setAutoFollowLive] = useState(true);
    const [hideEmptyLanes, setHideEmptyLanes] = useState(false);

    // Pending timeline marker position (click-to-place). The ref mirrors the
    // state synchronously so a label keypress immediately after a click reads
    // the fresh value; an effect-based mirror would lag a commit and race.
    // It is cleared by every transition that replaces what the timeline shows:
    // `loadFromApi`, `handleFileSession`, `handleBack`, the live-session end,
    // and the sticky-live latch below.
    const [pendingTimestamp, setPendingTimestamp] = useState<number | null>(null);
    const pendingTsRef = useRef<number | null>(null);
    const setPending = useCallback((ts: number | null) => {
        pendingTsRef.current = ts;   // synchronous, no render lag
        setPendingTimestamp(ts);
    }, []);
    // The latch is the one clear that happens during render, where writing the
    // ref is not allowed, so it sets the state alone and this mirror follows a
    // commit later. Every user-driven write still goes through `setPending` and
    // keeps its synchronous guarantee.
    useEffect(() => { pendingTsRef.current = pendingTimestamp; }, [pendingTimestamp]);

    // Track most recently ended live session so latch-on cannot flip back to live
    // during the brief window between sessionEnd event arrival and metadata.json
    // being written by the recorder (the live-sessions endpoint may still report
    // the session as live for a moment).
    const [endedLiveSessionId, setEndedLiveSessionId] = useState<string | null>(null);

    const liveSessionIds = useLiveSessions(true);

    // Sticky-live latches ON as soon as the polled live set contains the open
    // session, and stays on until something clears it (leaving the view, or the
    // session ending). Adjusted during render because it is a pure function of
    // state: an effect would latch a commit later and cost an extra render.
    // `loadFromApi(id, isLive)` also latches directly on click, so opening a
    // live-badged session never waits for the poll.
    const observedLive = activeSessionId !== null
        && liveSessionIds.has(activeSessionId)
        && endedLiveSessionId !== activeSessionId;
    if (observedLive && !stickyLive) {
        setStickyLive(true);
        // Parity with the boundary clear this latch replaced: a position clicked
        // on the archive timeline must not anchor the next live marker.
        setPendingTimestamp(null);
    }
    const isLiveSession = stickyLive || observedLive;
    const isReadOnly = !authStatus.allowWrite || isResearcher;
    const writesDisabled = isLiveSession || isReadOnly;

    const showAnnotationError = useCallback((message: string) => {
        // Surface mutator failures through the toast stack (same channel as adds).
        console.warn('[annotations]', message);
        pushToast({ kind: 'error', text: message, at: Date.now() });
    }, [pushToast]);
    const mutator = useAnnotationMutations({
        sessionId: activeSessionId,
        raterName: authStatus.raterName,
        setAnnotations,
        onToast: pushToast,
        onError: showAnnotationError,
    });

    const loadFromApi = useCallback(async (sessionId: string, isLive: boolean, tailLimit?: number) => {
        claimSession(sessionId); // claim ownership before any await
        setPending(null); // a clicked position belongs to the view being replaced
        setLoading(true);
        setViewMode('timeline');
        setScrollToTimestamp(null);
        setToasts([]);
        setStickyLive(isLive); // immediate latch, bypasses the polling cadence
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
            if (activeSessionIdRef.current !== sessionId) return; // user navigated away during fetch

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
    // `mutator` is stable (the controller is created once via lazy useState in
    // useAnnotationMutations) so listing it here doesn't churn the callback identity.
    }, [apiFetch, isResearcher, mutator, claimSession, setPending]);

    // The live stream tells us when the session is over (a `sessionEnd` line or
    // the recording disappearing). Remember the id so the sticky-live latch
    // cannot flip back on, leave live mode, and reload the archive shortly after
    // so the full event list replaces the capped live buffer.
    const handleLiveSessionEnded = useCallback((finalEvents: RecordedEvent[]) => {
        const id = activeSessionIdRef.current;
        if (!id) return;
        // Stash the final live events into the session so the display does not
        // blank out during the grace period before the archive reload.
        setSession((prev) => prev ? { ...prev, events: finalEvents } : prev);
        setPending(null);
        setEndedLiveSessionId(id);
        setStickyLive(false);
        setTimeout(() => {
            // Tail-limit the archive reload so a long session can't crash
            // the tab; live mode caps the buffer at 5k for the same reason.
            if (activeSessionIdRef.current === id) void loadFromApi(id, false, 5000);
        }, 500);
    }, [loadFromApi, setPending]);

    const live = useLiveSession(activeSessionId, isLiveSession, handleLiveSessionEnded);

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
    // Depends on the latch edge only, never on `annotations`: mid-live edits
    // already flow through the controller.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isLiveSession, mutator]);

    // While a researcher watches a LIVE session, poll the all-lanes endpoint
    // once a second so raters' new marks appear without a manual reload. Only
    // the lanes refresh; the researcher's video/zoom/scroll stay put.
    useResearcherLanePolling(isResearcher && isLiveSession, activeSessionIdRef, apiFetch, setResearcherLanes);

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
        // pendingTimestamp is deliberately not a dep: it is read via the ref so
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

    const handleFileSession = useCallback((loaded: LoadedSession) => {
        claimSession(null);
        setPending(null);
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
    }, [mutator, claimSession, setPending]);

    const handleBack = useCallback(() => {
        claimSession(null);
        setPending(null);
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
        // Leaving the session view is the only transition that clears these:
        // `handleFileSession` sets them for the file it loads, and every
        // server session goes through `loadFromApi`.
        setStickyLive(false);
        setEndedLiveSessionId(null);
        setSession(null);
    }, [mutator, claimSession, setPending]);

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
        if (!activeSessionId) return;
        apiFetch(`/api/recordings/${encodeURIComponent(activeSessionId)}/open`, { method: 'POST' })
            .catch(() => {/* best-effort */});
    }, [apiFetch, activeSessionId]);

    const handleOffsetChange = useCallback(async (newOffset: number) => {
        if (!activeSessionId || !videoSyncConfig) return;
        const updated = { ...videoSyncConfig, videoTimeAtSessionStartSeconds: newOffset };
        setVideoSyncConfig(updated);
        await apiFetch(`/api/recordings/${activeSessionId}/video-sync`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updated),
        }).catch(() => {/* best-effort */});
    }, [videoSyncConfig, apiFetch, activeSessionId]);

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
    // else the sessionStart event's timestamp. Not the generic earliest-event
    // fallback above, which understates elapsed time on a late join.
    // Latched per session so that once an authoritative start is seen
    // it survives the live buffer trimming the sessionStart event out of the
    // sliding window. 0 (hidden) until a source is observed.
    // The latch is adjusted during render rather than kept in a ref, so the value
    // the timer draws is the one React rendered with.
    const [liveStart, setLiveStart] = useState<{ id: string | null; start: number }>({ id: null, start: 0 });
    const liveStartSessionId = session?.fileName ?? null;
    let liveElapsedStart = liveStart.id === liveStartSessionId ? liveStart.start : 0;
    if (liveElapsedStart === 0 && session) {
        liveElapsedStart = session.metadata?.startTime
            ?? displayedEvents.find(e => e.type === 'sessionStart')?.timestamp
            ?? 0;
    }
    if (liveStart.id !== liveStartSessionId || liveStart.start !== liveElapsedStart) {
        setLiveStart({ id: liveStartSessionId, start: liveElapsedStart });
    }

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

    // Slide the zoomed window right when new live events arrive, preserving width.
    // Only active when isLiveSession + autoFollowLive + currently zoomed in.
    // Adjusted during render, before `effectiveXDomain` is read: from an effect
    // the window would trail the events it follows by a commit.
    if (autoFollowLive && isLiveSession && zoomedXDomain && xDomain && xDomain[1] > zoomedXDomain[1]) {
        const range = zoomedXDomain[1] - zoomedXDomain[0];
        setZoomedXDomain([xDomain[1] - range, xDomain[1]]);
    }

    const effectiveXDomain = zoomedXDomain ?? xDomain;

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

    const videoUrl = activeSessionId && videoSyncConfig
        ? `/api/recordings/${encodeURIComponent(activeSessionId)}/video?v=${videoCacheBust}`
        : null;

    const subtitlesUrl = activeSessionId && hasSubtitles
        ? `/api/recordings/${encodeURIComponent(activeSessionId)}/subtitles?v=${videoCacheBust}`
        : null;

    // Click-to-place is only meaningful in a server-backed archival session. A
    // file-loaded session has activeSessionId === null (addLabel is a silent no-op).
    const isServerSession = session !== null && activeSessionId !== null;

    return (
        <div className="app">
            <header className="app-header">
                <h1>Artemis Extension Session Analyzer</h1>
                {session && (
                    <div className="header-actions">
                        {activeSessionId && !writesDisabled && (
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
                    {activeSessionId && videoSyncConfig && videoUrl && !isLiveSession && (
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
                                        sessionId={activeSessionId}
                                        hasVideo={true}
                                        onUploadComplete={handleVideoUploadComplete}
                                    />
                                    <SubtitleUpload
                                        sessionId={activeSessionId}
                                        hasSubtitles={hasSubtitles}
                                        onUploadComplete={handleSubtitleUploadComplete}
                                    />
                                </div>
                            )}
                        </div>
                    )}
                    {activeSessionId && !videoSyncConfig && !writesDisabled && (
                        <VideoUpload
                            sessionId={activeSessionId}
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
                    {activeSessionId && !writesDisabled && (
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
