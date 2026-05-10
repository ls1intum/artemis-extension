import { useRef, useState, useCallback } from 'react';

interface Props {
    sessionId: string;
    hasVideo: boolean;
    onUploadComplete: (videoExtension: 'mp4' | 'webm') => void;
}

type UploadState = 'idle' | 'uploading' | 'done' | 'error';

export function VideoUpload({ sessionId, hasVideo, onUploadComplete }: Props) {
    const inputRef = useRef<HTMLInputElement>(null);
    const [state, setState] = useState<UploadState>('idle');
    const [errorMsg, setErrorMsg] = useState('');

    const handleFile = useCallback(async (file: File) => {
        if (!file.type.match(/^video\/(mp4|webm)$/)) {
            setState('error');
            setErrorMsg('Only MP4 and WebM files are supported');
            return;
        }

        setState('uploading');
        setErrorMsg('');

        try {
            const res = await fetch(`/api/recordings/${encodeURIComponent(sessionId)}/video`, {
                method: 'PUT',
                headers: { 'Content-Type': file.type },
                body: file,
            });

            if (!res.ok) {
                const err = await res.json().catch(() => ({ error: 'Upload failed' }));
                throw new Error(err.error || 'Upload failed');
            }

            const data = await res.json();
            setState('done');
            onUploadComplete(data.videoExtension);

            // Reset to idle after brief feedback
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
                accept="video/mp4,video/webm"
                style={{ display: 'none' }}
                onChange={e => {
                    const file = e.target.files?.[0];
                    if (file) handleFile(file);
                    // Reset so the same file can be re-selected
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
                 hasVideo ? 'Replace video' : 'Upload video'}
            </button>
            {state === 'error' && <span className="video-upload-error">{errorMsg}</span>}
        </div>
    );
}
