import { useEffect, useState } from 'react';
import { STRUGGLE_LABELS, CONTEXT_LABELS, ALL_LABELS } from '../types';
import type { AnnotationToast } from '../hooks/useAnnotationMutations';

interface Props {
    connected: boolean;
    eventsReceived: number;
    latestEventTimestamp: number | null;
    lastLabelToast: AnnotationToast | null;
}

function renderToast(toast: AnnotationToast): string {
    const labelName = toast.label
        ? (ALL_LABELS.find(l => l.value === toast.label)?.label ?? toast.label)
        : null;
    const body = labelName ?? toast.text ?? 'annotation';
    switch (toast.kind) {
        case 'add': return `+ ${body}`;
        case 'undo': return `↶ ${body}`;
        case 'redo': return `↷ ${body}`;
        case 'error': return `⚠ ${body}`;
    }
}

export function LiveControlBar({
    connected, eventsReceived, latestEventTimestamp, lastLabelToast,
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
            <div className="live-legend">
                <strong>Struggle:</strong>
                {STRUGGLE_LABELS.map((s, i) => (
                    <span key={s.value} style={{ color: s.color }}>{i + 1}={s.label}</span>
                ))}
                <strong>Context:</strong>
                {CONTEXT_LABELS.map((s, i) => (
                    <span key={s.value} style={{ color: s.color }}>{'qwert'[i]}={s.label}</span>
                ))}
            </div>
            {toastVisible && (
                <div className={`live-toast live-toast-${lastLabelToast!.kind}`}>{renderToast(lastLabelToast!)}</div>
            )}
        </div>
    );
}
