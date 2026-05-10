import { useState, useRef, useCallback } from 'react';
import type { AnnotationLabel } from '../types';
import { STRUGGLE_LABELS, CONTEXT_LABELS, ALL_LABELS } from '../types';

/** Parse "M:SS" or "MM:SS" or raw seconds into milliseconds offset. Returns null on invalid input. */
function parseTimeInput(input: string): number | null {
    const trimmed = input.trim();
    const colonMatch = trimmed.match(/^(\d{1,3}):(\d{1,2})$/);
    if (colonMatch) {
        const m = parseInt(colonMatch[1], 10);
        const s = parseInt(colonMatch[2], 10);
        if (s >= 60) return null;
        return (m * 60 + s) * 1000;
    }
    const num = Number(trimmed);
    if (!Number.isNaN(num) && num >= 0) {
        return Math.round(num * 1000);
    }
    return null;
}

interface Props {
    sessionStartTime: number;
    onAdd: (timestamp: number, text: string, label?: AnnotationLabel) => void;
    videoTimeRef?: React.RefObject<number>;
    annotationCount: number;
}

export function FreeAnnotationForm({ sessionStartTime, onAdd, videoTimeRef, annotationCount }: Props) {
    const [open, setOpen] = useState(false);
    const [time, setTime] = useState('');
    const [text, setText] = useState('');
    const [selectedLabel, setSelectedLabel] = useState<AnnotationLabel | null>(null);
    const timeRef = useRef<HTMLInputElement>(null);

    const getCurrentVideoOffset = useCallback((): string | null => {
        if (!videoTimeRef) return null;
        const ts = videoTimeRef.current;
        if (ts <= 0) return null;
        const offsetMs = ts - sessionStartTime;
        const totalSeconds = Math.max(0, Math.floor(offsetMs / 1000));
        const m = Math.floor(totalSeconds / 60);
        const s = totalSeconds % 60;
        return `${m}:${s.toString().padStart(2, '0')}`;
    }, [videoTimeRef, sessionStartTime]);

    const handleLabelQuick = useCallback((label: AnnotationLabel) => {
        const videoOffset = getCurrentVideoOffset();
        if (videoOffset) {
            setTime(videoOffset);
        }
        setSelectedLabel(label);
        setOpen(true);
    }, [getCurrentVideoOffset]);

    const submit = () => {
        const offsetMs = parseTimeInput(time);
        if (offsetMs === null) return;
        const labelText = selectedLabel ? ALL_LABELS.find(l => l.value === selectedLabel)?.label ?? '' : '';
        const finalText = text.trim() || labelText;
        if (!finalText) return;
        onAdd(sessionStartTime + offsetMs, finalText, selectedLabel ?? undefined);
        setTime('');
        setText('');
        setSelectedLabel(null);
        setOpen(false);
    };

    if (!open) {
        return (
            <div className="label-bar">
                {STRUGGLE_LABELS.map(l => (
                    <button
                        key={l.value}
                        className="label-quick-btn"
                        style={{ '--label-color': l.color } as React.CSSProperties}
                        onClick={() => handleLabelQuick(l.value)}
                        title={videoTimeRef ? `Add "${l.label}" at current video time` : `Add "${l.label}"`}
                    >
                        {l.label}
                    </button>
                ))}
                <span className="label-divider" />
                {CONTEXT_LABELS.map(l => (
                    <button
                        key={l.value}
                        className="label-quick-btn"
                        style={{ '--label-color': l.color } as React.CSSProperties}
                        onClick={() => handleLabelQuick(l.value)}
                        title={videoTimeRef ? `Add "${l.label}" at current video time` : `Add "${l.label}"`}
                    >
                        {l.label}
                    </button>
                ))}
                <span className="label-divider" />
                <button className="label-quick-btn label-freetext" onClick={() => setOpen(true)}>
                    + Note
                </button>
                <span className="annotation-count">{annotationCount}</span>
            </div>
        );
    }

    const offsetMs = parseTimeInput(time);
    const labelInfo = selectedLabel ? ALL_LABELS.find(l => l.value === selectedLabel) : null;
    const valid = offsetMs !== null && (text.trim().length > 0 || selectedLabel !== null);

    return (
        <div className="free-annotation-form">
            {labelInfo && (
                <span
                    className="label-selected-badge"
                    style={{ '--label-color': labelInfo.color } as React.CSSProperties}
                >
                    {labelInfo.label}
                    <button className="label-clear-btn" onClick={() => setSelectedLabel(null)}>&times;</button>
                </span>
            )}
            <input
                ref={timeRef}
                autoFocus
                className="annotation-input time-input"
                placeholder="M:SS"
                value={time}
                onChange={e => setTime(e.target.value)}
                onKeyDown={e => {
                    if (e.key === 'Enter' && valid) submit();
                    if (e.key === 'Escape') { setOpen(false); setSelectedLabel(null); }
                }}
            />
            <input
                className="annotation-input"
                placeholder={selectedLabel ? 'Optional note...' : 'Annotation text...'}
                value={text}
                onChange={e => setText(e.target.value)}
                onKeyDown={e => {
                    if (e.key === 'Enter' && valid) submit();
                    if (e.key === 'Escape') { setOpen(false); setSelectedLabel(null); }
                }}
            />
            <button className="annotation-save-btn" disabled={!valid} onClick={submit}>Add</button>
            <button className="annotation-cancel-btn" onClick={() => { setOpen(false); setSelectedLabel(null); }}>Cancel</button>
        </div>
    );
}
