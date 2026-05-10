import { useState, useCallback } from 'react';

interface Props {
    videoTimeAtSessionStartSeconds: number;
    onOffsetChange: (newOffset: number) => void;
}

function OffsetConfigInner({ videoTimeAtSessionStartSeconds, onOffsetChange }: Props) {
    const [value, setValue] = useState(String(videoTimeAtSessionStartSeconds));
    const dirty = value !== String(videoTimeAtSessionStartSeconds);

    const handleSave = useCallback(() => {
        const num = Number(value);
        if (!Number.isFinite(num)) return;
        onOffsetChange(num);
    }, [value, onOffsetChange]);

    return (
        <div className="offset-config">
            <label className="offset-label">Video time at session start (s):</label>
            <input
                type="number"
                className="annotation-input offset-input"
                value={value}
                step="any"
                onChange={e => setValue(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleSave(); }}
            />
            {dirty && (
                <button className="annotation-save-btn" onClick={handleSave}>
                    Save
                </button>
            )}
        </div>
    );
}

// Key on the prop value so the component resets when the offset changes externally
export function OffsetConfig(props: Props) {
    return <OffsetConfigInner key={props.videoTimeAtSessionStartSeconds} {...props} />;
}
