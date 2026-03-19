import { useState, useRef } from 'react';

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

export function FreeAnnotationForm({ sessionStartTime, onAdd }: {
    sessionStartTime: number;
    onAdd: (timestamp: number, text: string) => void;
}) {
    const [open, setOpen] = useState(false);
    const [time, setTime] = useState('');
    const [text, setText] = useState('');
    const timeRef = useRef<HTMLInputElement>(null);

    if (!open) {
        return (
            <button className="free-annotate-btn" onClick={() => setOpen(true)}>
                + Add annotation at time...
            </button>
        );
    }

    const offsetMs = parseTimeInput(time);
    const valid = offsetMs !== null && text.trim().length > 0;

    const submit = () => {
        if (offsetMs === null || !text.trim()) return;
        onAdd(sessionStartTime + offsetMs, text.trim());
        setTime('');
        setText('');
        setOpen(false);
    };

    return (
        <div className="free-annotation-form">
            <input
                ref={timeRef}
                autoFocus
                className="annotation-input time-input"
                placeholder="M:SS"
                value={time}
                onChange={e => setTime(e.target.value)}
                onKeyDown={e => {
                    if (e.key === 'Enter' && valid) submit();
                    if (e.key === 'Escape') setOpen(false);
                }}
            />
            <input
                className="annotation-input"
                placeholder="Annotation text..."
                value={text}
                onChange={e => setText(e.target.value)}
                onKeyDown={e => {
                    if (e.key === 'Enter' && valid) submit();
                    if (e.key === 'Escape') setOpen(false);
                }}
            />
            <button className="annotation-save-btn" disabled={!valid} onClick={submit}>Add</button>
            <button className="annotation-cancel-btn" onClick={() => setOpen(false)}>Cancel</button>
        </div>
    );
}
