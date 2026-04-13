import { useRef, useState, useCallback } from 'react';

interface Props {
    sessionId: string;
    hasSubtitles: boolean;
    onUploadComplete: () => void;
}

type UploadState = 'idle' | 'uploading' | 'done' | 'error';

function contentTypeFor(file: File): string {
    if (file.type === 'text/vtt' || file.name.toLowerCase().endsWith('.vtt')) return 'text/vtt';
    if (file.type === 'application/x-subrip' || file.name.toLowerCase().endsWith('.srt')) return 'application/x-subrip';
    return 'text/plain';
}

export function SubtitleUpload({ sessionId, hasSubtitles, onUploadComplete }: Props) {
    const inputRef = useRef<HTMLInputElement>(null);
    const [state, setState] = useState<UploadState>('idle');
    const [errorMsg, setErrorMsg] = useState('');

    const handleFile = useCallback(async (file: File) => {
        const name = file.name.toLowerCase();
        if (!name.endsWith('.srt') && !name.endsWith('.vtt')) {
            setState('error');
            setErrorMsg('Only .srt and .vtt files are supported');
            return;
        }

        setState('uploading');
        setErrorMsg('');

        try {
            const res = await fetch(`/api/recordings/${encodeURIComponent(sessionId)}/subtitles`, {
                method: 'PUT',
                headers: { 'Content-Type': contentTypeFor(file) },
                body: file,
            });

            if (!res.ok) {
                const err = await res.json().catch(() => ({ error: 'Upload failed' }));
                throw new Error(err.error || 'Upload failed');
            }

            setState('done');
            onUploadComplete();
            setTimeout(() => setState('idle'), 2000);
        } catch (err) {
            setState('error');
            setErrorMsg(err instanceof Error ? err.message : 'Upload failed');
        }
    }, [sessionId, onUploadComplete]);

    return (
        <div className="video-upload">
            <input
                ref={inputRef}
                type="file"
                accept=".srt,.vtt,text/vtt,application/x-subrip"
                style={{ display: 'none' }}
                onChange={e => {
                    const file = e.target.files?.[0];
                    if (file) handleFile(file);
                    e.target.value = '';
                }}
            />
            <button
                className="video-upload-btn"
                onClick={() => inputRef.current?.click()}
                disabled={state === 'uploading'}
            >
                {state === 'uploading' ? 'Uploading...' :
                 state === 'done' ? 'Uploaded!' :
                 hasSubtitles ? 'Replace subtitles' : 'Upload subtitles'}
            </button>
            {state === 'error' && <span className="video-upload-error">{errorMsg}</span>}
        </div>
    );
}
