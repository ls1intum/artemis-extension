import { useCallback, useState, type DragEvent } from 'react';
import type { LoadedSession } from '../types';
import { parseDroppedFiles } from '../parseSession';

interface Props {
    onSessionLoaded: (session: LoadedSession) => void;
}

export function FileDropZone({ onSessionLoaded }: Props) {
    const [isDragging, setIsDragging] = useState(false);

    const handleDrop = useCallback(async (e: DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        setIsDragging(false);
        if (e.dataTransfer.files.length > 0) {
            const session = await parseDroppedFiles(e.dataTransfer.files);
            onSessionLoaded(session);
        }
    }, [onSessionLoaded]);

    const handleFileInput = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files.length > 0) {
            const session = await parseDroppedFiles(e.target.files);
            onSessionLoaded(session);
        }
    }, [onSessionLoaded]);

    return (
        <div
            className={`drop-zone ${isDragging ? 'dragging' : ''}`}
            onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
        >
            <div className="drop-zone-content">
                <div className="drop-icon">&#xe900;</div>
                <p>Drop <code>events.jsonl</code> + <code>metadata.json</code> here</p>
                <p className="drop-hint">or click to browse</p>
                <input
                    type="file"
                    multiple
                    accept=".jsonl,.json"
                    onChange={handleFileInput}
                    className="file-input"
                />
            </div>
        </div>
    );
}
