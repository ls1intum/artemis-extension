import { useEffect, useState } from 'react';
import type { RecordedEvent } from '../types';

export interface LiveSessionState {
    connected: boolean;
    events: RecordedEvent[];
    latestEventTimestamp: number | null;
    error: string | null;
    /** Cumulative count of unique events received from the server since
     *  this session connected. Strictly monotonic: it does not decrease when
     *  the sliding window trims old events. */
    totalReceived: number;
}

const INITIAL: LiveSessionState = { connected: false, events: [], latestEventTimestamp: null, error: null, totalReceived: 0 };

/** Maximum number of live events retained in browser memory. Older events
 * drop off the front as new ones arrive; the full archive remains
 * accessible via /api/recordings/:id/events after the session ends.
 *
 * Sized to cover realistic study-session volumes (observed worst case so far:
 * ~4k events). Bumping further is bounded less by RAM (~400 bytes/event) than
 * by re-derivation cost in EventStream/TrackingTimeline on each RAF flush. */
const MAX_LIVE_EVENTS = 50_000;

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

    useEffect(() => {
        // All mutable state lives in this effect's closure so a stale
        // callback from a previous session-id cannot write into the next
        // session's buffers. The closed flag is per-effect-run too.
        let closed = false;
        const eventsBuf: RecordedEvent[] = [];
        const pendingBuf: RecordedEvent[] = [];
        let maxLineNo = 0;
        let totalReceived = 0;
        let sessionEndPending = false;
        let scheduled: ScheduleHandle | null = null;

        if (!enabled || !sessionId) {
            queueMicrotask(() => { if (!closed) setState(INITIAL); });
            return () => { closed = true; };
        }
        queueMicrotask(() => { if (!closed) setState({ ...INITIAL }); });

        const flush = () => {
            scheduled = null;
            if (closed) return;
            if (pendingBuf.length === 0 && !sessionEndPending) return;

            // Pre-cap: if a pathological burst dumps >MAX events into pending
            // (e.g. initial SSE catch-up of a long session), keep only the
            // last MAX so the subsequent concat doesn't transiently allocate
            // hundreds of megabytes.
            const tailIncoming = pendingBuf.length > MAX_LIVE_EVENTS
                ? pendingBuf.slice(pendingBuf.length - MAX_LIVE_EVENTS)
                : pendingBuf.slice();
            pendingBuf.length = 0;

            // In-place append + trim to keep within MAX_LIVE_EVENTS.
            for (const ev of tailIncoming) eventsBuf.push(ev);
            if (eventsBuf.length > MAX_LIVE_EVENTS) {
                eventsBuf.splice(0, eventsBuf.length - MAX_LIVE_EVENTS);
            }

            const last = eventsBuf[eventsBuf.length - 1];
            const ended = sessionEndPending;
            sessionEndPending = false;

            // Snapshot for React: a fresh array so identity-based memos see
            // the change and don't reuse stale results.
            const snapshot = eventsBuf.slice();
            setState((s) => ({
                ...s,
                events: snapshot,
                latestEventTimestamp: last?.timestamp ?? s.latestEventTimestamp,
                totalReceived,
                connected: ended ? false : s.connected,
                // Clear any stale "Disconnected, retrying..." error: if we're
                // flushing real events, we obviously aren't disconnected.
                error: ended ? 'Session ended' : null,
            }));
        };

        const scheduleFlush = () => {
            if (scheduled != null) return;
            scheduled = scheduleAnimationFrame(flush);
        };

        const url = `/api/recordings/${encodeURIComponent(sessionId)}/events/stream`;
        const es = new EventSource(url, { withCredentials: true });

        es.onopen = () => {
            if (closed) return;
            setState((s) => ({ ...s, connected: true, error: null }));
        };
        es.onerror = () => {
            if (closed) return;
            setState((s) => ({ ...s, connected: false, error: 'Disconnected, retrying...' }));
        };
        es.onmessage = (evt) => {
            if (closed) return;
            const lineNo = Number(evt.lastEventId);
            if (Number.isFinite(lineNo) && lineNo <= maxLineNo) return;
            if (Number.isFinite(lineNo)) maxLineNo = lineNo;
            try {
                const parsed = JSON.parse(evt.data) as RecordedEvent;
                pendingBuf.push(parsed);
                totalReceived += 1;
                const isSessionEnd = (parsed as { type?: string }).type === 'sessionEnd';
                if (isSessionEnd) {
                    sessionEndPending = true;
                    // Flush sync so the final state lands before the
                    // EventSource closes.
                    if (scheduled) {
                        scheduled.cancel();
                        scheduled = null;
                    }
                    flush();
                    es.close();
                } else {
                    scheduleFlush();
                }
            } catch { /* malformed line */ }
        };
        es.addEventListener('session-gone', () => {
            if (closed) return;
            es.close();
            setState((s) => ({ ...s, connected: false, error: 'Session ended' }));
        });

        return () => {
            closed = true;
            if (scheduled) {
                scheduled.cancel();
                scheduled = null;
            }
            es.close();
        };
    }, [sessionId, enabled]);

    return state;
}
