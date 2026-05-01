import * as path from 'path';
import { LiveTailer, type TailerOptions } from './liveTailer';

interface Entry { tailer: LiveTailer; refCount: number }

export interface AcquireHandle {
    tailer: LiveTailer;
    /** Idempotent: safe to call multiple times. Only the first call decrements the ref count. */
    release(): void;
}

export class LiveTailerRegistry {
    private _entries = new Map<string, Entry>();
    private readonly _recordingsDir: string;
    private readonly _opts: TailerOptions;

    constructor(recordingsDir: string, opts: TailerOptions = {}) {
        this._recordingsDir = recordingsDir;
        this._opts = opts;
    }

    acquire(sessionId: string): AcquireHandle {
        let entry = this._entries.get(sessionId);
        if (!entry) {
            const eventsPath = path.join(this._recordingsDir, sessionId, 'events.jsonl');
            const tailer = new LiveTailer(eventsPath, this._opts);
            tailer.start();
            entry = { tailer, refCount: 0 };
            this._entries.set(sessionId, entry);
        }
        entry.refCount++;
        let released = false;
        return {
            tailer: entry.tailer,
            release: () => {
                if (released) return;
                released = true;
                const e = this._entries.get(sessionId);
                if (!e) return;
                e.refCount--;
                if (e.refCount <= 0) {
                    e.tailer.stop();
                    this._entries.delete(sessionId);
                }
            },
        };
    }

    size(): number { return this._entries.size; }

    disposeAll(): void {
        for (const e of this._entries.values()) e.tailer.stop();
        this._entries.clear();
    }
}
