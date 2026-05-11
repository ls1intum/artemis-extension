import { useEffect, useRef, useState } from 'react';
import type { RecordedEvent } from '../types';

export interface LiveSessionState {
    connected: boolean;
    events: RecordedEvent[];
    latestEventTimestamp: number | null;
    error: string | null;
}

const INITIAL: LiveSessionState = { connected: false, events: [], latestEventTimestamp: null, error: null };

/** Maximum number of live events retained in browser memory. Older events
 * drop off the front as new ones arrive; the full archive remains
 * accessible via /api/recordings/:id/events after the session ends. */
export const MAX_LIVE_EVENTS = 5000;

type ScheduleHandle = { cancel: () => void };

function scheduleAnimationFrame(cb: () => void): ScheduleHandle {
    if (typeof requestAnimationFrame === 'function') {
        const id = requestAnimationFrame(cb);
        return { cancel: () => cancelAnimationFrame(id) };
    }
    // jsdom/Node fallback: microtask-ish coalescing via setTimeout.
    const id = setTimeout(cb, 0);
    return { cancel: () => clearTimeout(id) };
}

export function useLiveSession(sessionId: string | null, enabled: boolean): LiveSessionState {
    const [state, setState] = useState<LiveSessionState>(INITIAL);
    const eventsRef = useRef<RecordedEvent[]>([]);
    const maxLineNoRef = useRef<number>(0);
    const pendingRef = useRef<RecordedEvent[]>([]);
    const sessionEndPendingRef = useRef(false);
    const scheduledRef = useRef<ScheduleHandle | null>(null);
    const closedRef = useRef(false);

    useEffect(() => {
        // Reset all per-session refs before opening the connection. Critical
        // when switching sessions while a flush was scheduled — otherwise
        // pending events from the old session can leak into the new one.
        eventsRef.current = [];
        maxLineNoRef.current = 0;
        pendingRef.current = [];
        sessionEndPendingRef.current = false;
        closedRef.current = false;
        if (scheduledRef.current) {
            scheduledRef.current.cancel();
            scheduledRef.current = null;
        }

        if (!enabled || !sessionId) {
            queueMicrotask(() => setState(INITIAL));
            return;
        }
        queueMicrotask(() => setState({ ...INITIAL }));

        const flush = () => {
            scheduledRef.current = null;
            if (closedRef.current) return;
            if (pendingRef.current.length === 0 && !sessionEndPendingRef.current) return;

            const incoming = pendingRef.current;
            pendingRef.current = [];

            // Pre-cap: if a pathological burst dumps >MAX events into pending
            // (e.g. initial SSE catch-up of a long session), keep only the
            // last MAX so the subsequent concat doesn't transiently allocate
            // hundreds of megabytes.
            const tailIncoming = incoming.length > MAX_LIVE_EVENTS
                ? incoming.slice(incoming.length - MAX_LIVE_EVENTS)
                : incoming;

            let combined = eventsRef.current.concat(tailIncoming);
            if (combined.length > MAX_LIVE_EVENTS) {
                combined = combined.slice(combined.length - MAX_LIVE_EVENTS);
            }
            eventsRef.current = combined;

            const last = combined[combined.length - 1];
            const ended = sessionEndPendingRef.current;
            sessionEndPendingRef.current = false;

            setState((s) => ({
                ...s,
                events: combined,
                latestEventTimestamp: last?.timestamp ?? s.latestEventTimestamp,
                connected: ended ? false : s.connected,
                // Clear any stale "Disconnected, retrying..." error: if we're
                // flushing real events, we obviously aren't disconnected.
                error: ended ? 'Session ended' : null,
            }));
        };

        const scheduleFlush = () => {
            if (scheduledRef.current != null) return;
            scheduledRef.current = scheduleAnimationFrame(flush);
        };

        const url = `/api/recordings/${encodeURIComponent(sessionId)}/events/stream`;
        const es = new EventSource(url, { withCredentials: true });

        es.onopen = () => {
            if (closedRef.current) return;
            setState((s) => ({ ...s, connected: true, error: null }));
        };
        es.onerror = () => {
            if (closedRef.current) return;
            setState((s) => ({ ...s, connected: false, error: 'Disconnected, retrying...' }));
        };
        es.onmessage = (evt) => {
            if (closedRef.current) return;
            const lineNo = Number(evt.lastEventId);
            if (Number.isFinite(lineNo) && lineNo <= maxLineNoRef.current) return;
            if (Number.isFinite(lineNo)) maxLineNoRef.current = lineNo;
            try {
                const parsed = JSON.parse(evt.data) as RecordedEvent;
                pendingRef.current.push(parsed);
                const isSessionEnd = (parsed as { type?: string }).type === 'sessionEnd';
                if (isSessionEnd) {
                    sessionEndPendingRef.current = true;
                    // Flush sync so the final state lands before the
                    // EventSource closes.
                    if (scheduledRef.current) {
                        scheduledRef.current.cancel();
                        scheduledRef.current = null;
                    }
                    flush();
                    es.close();
                } else {
                    scheduleFlush();
                }
            } catch { /* malformed line */ }
        };
        es.addEventListener('session-gone', () => {
            if (closedRef.current) return;
            es.close();
            setState((s) => ({ ...s, connected: false, error: 'Session ended' }));
        });

        return () => {
            closedRef.current = true;
            if (scheduledRef.current) {
                scheduledRef.current.cancel();
                scheduledRef.current = null;
            }
            pendingRef.current = [];
            sessionEndPendingRef.current = false;
            es.close();
        };
    }, [sessionId, enabled]);

    return state;
}
