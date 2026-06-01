import { useCallback, useEffect, useRef, type MutableRefObject } from 'react';
import type { Annotation } from '../types';

export type ResearcherLane = { raterId: string; raterName: string; annotations: Annotation[] };

/**
 * While a researcher views a LIVE session, poll `/annotations/all` on an
 * interval so raters' new marks appear without a manual reload. Only the lanes
 * are fetched and handed to `onLanes`; the caller's video/zoom/scroll/session
 * state is left untouched (unlike a full `loadFromApi`).
 *
 * The active session id is read from `activeSessionId` on every tick, so
 * switching sessions while `enabled` stays true automatically re-targets the
 * poll. A single in-flight guard prevents overlapping requests from piling up
 * if a fetch ever outlasts the interval.
 *
 * @param enabled         poll only while true (e.g. `isResearcher && isLiveSession`)
 * @param activeSessionId ref to the currently viewed session id (null = none)
 * @param apiFetch        credentialed fetch wrapper
 * @param onLanes         receives the freshly fetched lanes
 * @param intervalMs      poll cadence, default 1000ms
 */
export function useResearcherLanePolling(
    enabled: boolean,
    activeSessionId: MutableRefObject<string | null>,
    apiFetch: (url: string, init?: RequestInit) => Promise<Response>,
    onLanes: (lanes: ResearcherLane[]) => void,
    intervalMs = 1000,
): void {
    const inFlight = useRef(false);

    const refresh = useCallback(async (sessionId: string, isCancelled: () => boolean) => {
        if (inFlight.current) return; // a previous poll is still running
        inFlight.current = true;
        try {
            const res = await apiFetch(`/api/recordings/${sessionId}/annotations/all`);
            if (!res.ok) return;
            const lanes = (await res.json()) as ResearcherLane[];
            // Drop the result if polling was torn down while we were fetching
            // (e.g. the live session ended and loadFromApi already wrote the
            // authoritative final lanes), or the user switched sessions. Checked
            // as late as possible, right before the write.
            if (isCancelled() || activeSessionId.current !== sessionId) return;
            onLanes(lanes);
        } catch {
            // Transient (network blip / server restart); the next tick retries.
        } finally {
            inFlight.current = false;
        }
    }, [apiFetch, onLanes, activeSessionId]);

    useEffect(() => {
        if (!enabled) return;
        let cancelled = false;
        const interval = setInterval(() => {
            const id = activeSessionId.current;
            if (id) void refresh(id, () => cancelled);
        }, intervalMs);
        return () => {
            cancelled = true;
            clearInterval(interval);
        };
    }, [enabled, intervalMs, refresh, activeSessionId]);
}
