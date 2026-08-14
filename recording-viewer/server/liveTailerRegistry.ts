import * as fs from 'fs';
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
            // Seek the tailer past historical content synchronously at
            // acquire time. Per-connection catch-up replays the relevant
            // tail from disk; the shared tailer only broadcasts lines that
            // arrive AFTER this construction-time cursor.
            //
            // Doing this synchronously (statSync + sync newline count)
            // closes the race between construction and the first poll: any
            // line written in that window would otherwise be skipped (if it
            // landed before the first poll's first-time seek) or
            // double-broadcast (if it landed after the seek but before
            // subscribers attached).
            let initialOffset = 0;
            let initialLineNo = 0;
            let initialMtimeNs: bigint = 0n;
            try {
                const stat = fs.statSync(eventsPath, { bigint: true });
                initialMtimeNs = stat.mtimeNs;
                if (stat.size > 0n) {
                    const buf = fs.readFileSync(eventsPath);
                    let count = 0;
                    for (let i = 0; i < buf.length; i++) {
                        if (buf[i] === 0x0A) count++;
                    }
                    initialOffset = Number(stat.size);
                    initialLineNo = count;
                }
            } catch { /* file missing, leave the cursor at 0/0 */ }
            const tailer = new LiveTailer(eventsPath, {
                ...this._opts,
                initialOffset,
                initialLineNo,
                initialMtimeNs,
            });
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
