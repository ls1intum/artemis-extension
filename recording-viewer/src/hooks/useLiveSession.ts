import { useEffect, useRef, useState } from 'react';
import type { RecordedEvent } from '../types';

export interface LiveSessionState {
    connected: boolean;
    events: RecordedEvent[];
    latestEventTimestamp: number | null;
    error: string | null;
}

const INITIAL: LiveSessionState = { connected: false, events: [], latestEventTimestamp: null, error: null };

export function useLiveSession(sessionId: string | null, enabled: boolean): LiveSessionState {
    const [state, setState] = useState<LiveSessionState>(INITIAL);
    const eventsRef = useRef<RecordedEvent[]>([]);
    const maxLineNoRef = useRef<number>(0);

    useEffect(() => {
        if (!enabled || !sessionId) {
            eventsRef.current = [];
            maxLineNoRef.current = 0;
            queueMicrotask(() => setState(INITIAL));
            return;
        }
        eventsRef.current = [];
        maxLineNoRef.current = 0;
        queueMicrotask(() => setState({ ...INITIAL }));

        const url = `/api/recordings/${encodeURIComponent(sessionId)}/events/stream`;
        const es = new EventSource(url, { withCredentials: true });

        es.onopen = () => setState((s) => ({ ...s, connected: true, error: null }));
        es.onerror = () => setState((s) => ({ ...s, connected: false, error: 'Disconnected, retrying...' }));
        es.onmessage = (evt) => {
            const lineNo = Number(evt.lastEventId);
            if (Number.isFinite(lineNo) && lineNo <= maxLineNoRef.current) return;
            if (Number.isFinite(lineNo)) maxLineNoRef.current = lineNo;
            try {
                const parsed = JSON.parse(evt.data) as RecordedEvent;
                eventsRef.current.push(parsed);
                const isSessionEnd = (parsed as { type?: string }).type === 'sessionEnd';
                setState((s) => ({
                    ...s,
                    events: eventsRef.current.slice(),
                    latestEventTimestamp: parsed.timestamp ?? s.latestEventTimestamp,
                    connected: isSessionEnd ? false : s.connected,
                    error: isSessionEnd ? 'Session ended' : null,
                }));
                if (isSessionEnd) es.close();
            } catch { /* malformed line */ }
        };
        es.addEventListener('session-gone', () => {
            es.close();
            setState((s) => ({ ...s, connected: false, error: 'Session ended' }));
        });

        return () => { es.close(); };
    }, [sessionId, enabled]);

    return state;
}
