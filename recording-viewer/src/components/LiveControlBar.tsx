import { useEffect, useState } from 'react';
import { STRUGGLE_LABELS, CONTEXT_LABELS } from '../types';

interface Props {
    connected: boolean;
    eventsReceived: number;
    latestEventTimestamp: number | null;
    reactionDelayMs: number;
    onReactionDelayChange: (ms: number) => void;
    lastLabelToast: { label: string; at: number } | null;
}

export function LiveControlBar({
    connected, eventsReceived, latestEventTimestamp,
    reactionDelayMs, onReactionDelayChange, lastLabelToast,
}: Props) {
    // Re-render every second so the "last event N s ago" updates live
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        const t = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(t);
    }, []);

    const ageMs = latestEventTimestamp ? now - latestEventTimestamp : null;
    const toastVisible = lastLabelToast && now - lastLabelToast.at < 1500;

    return (
        <div className="live-control-bar">
            <div className="live-status">
                <span className={`live-dot ${connected ? 'on' : 'off'}`} />
                <strong>{connected ? 'LIVE' : 'Disconnected'}</strong>
                <span className="live-counter">{eventsReceived} events</span>
                {ageMs !== null && (
                    <span className="live-age">last event {(ageMs / 1000).toFixed(1)}s ago</span>
                )}
            </div>
            <div className="live-reaction">
                <label>
                    Reaction delay
                    <input
                        type="range"
                        min={0} max={1000} step={50}
                        value={reactionDelayMs}
                        onChange={(e) => onReactionDelayChange(Number(e.target.value))}
                    />
                    <span>{reactionDelayMs}ms</span>
                </label>
            </div>
            <div className="live-legend">
                <strong>Struggle:</strong>
                {STRUGGLE_LABELS.map((s, i) => (
                    <span key={s.value} style={{ color: s.color }}>{i + 1}={s.label.split(' ')[0]}</span>
                ))}
                <strong>Context:</strong>
                {CONTEXT_LABELS.map((s, i) => (
                    <span key={s.value} style={{ color: s.color }}>{'qwert'[i]}={s.label.split(' ')[0]}</span>
                ))}
            </div>
            {toastVisible && (
                <div className="live-toast">Tagged: {lastLabelToast!.label}</div>
            )}
        </div>
    );
}
