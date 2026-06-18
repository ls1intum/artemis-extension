import { useEffect, useState } from 'react';
import { formatDuration } from '../utils/format';
import { HotkeyLegend } from './HotkeyLegend';

interface Props {
    connected: boolean;
    /** Number of events currently in the browser buffer (the sliding window). */
    bufferSize: number;
    /** Cumulative number of events received since this session connected.
     *  When this exceeds bufferSize, the window has been trimming oldest events. */
    totalReceived: number;
    latestEventTimestamp: number | null;
    /** Authoritative session start (metadata.startTime or the sessionStart event);
     *  0 when unknown, in which case the elapsed timer is hidden. */
    startTime: number;
}

export function LiveControlBar({
    connected, bufferSize, totalReceived, latestEventTimestamp, startTime,
}: Props) {
    // Re-render every second so the elapsed timer and "last event N s ago" update live
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        const t = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(t);
    }, []);

    const elapsedMs = startTime > 0 ? Math.max(0, now - startTime) : null;
    const ageMs = latestEventTimestamp ? now - latestEventTimestamp : null;

    return (
        <div className="live-control-bar">
            <div className="live-status">
                <span className={`live-dot ${connected ? 'on' : 'off'}`} />
                <strong>{connected ? 'LIVE' : 'Disconnected'}</strong>
                {elapsedMs !== null && (
                    <span className="live-elapsed">{formatDuration(elapsedMs)}</span>
                )}
                <span className="live-counter">
                    {bufferSize < totalReceived
                        ? `${bufferSize.toLocaleString()} of ${totalReceived.toLocaleString()} events`
                        : `${totalReceived.toLocaleString()} events`}
                </span>
                {ageMs !== null && (
                    <span className="live-age">last event {(ageMs / 1000).toFixed(1)}s ago</span>
                )}
            </div>
            <HotkeyLegend />
        </div>
    );
}
