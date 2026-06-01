import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import { StringDecoder } from 'string_decoder';

export type LineListener = (line: string, lineNo: number) => void;

export interface TailerOptions {
    pollIntervalMs?: number;
    maxChunkBytes?: number;
    /**
     * Byte offset and matching line number to start polling from. Allows the
     * registry to seek the tailer past historical content at construction
     * time (before any polls run) so lines that arrive between construction
     * and the first poll are still emitted to subscribers. The values must
     * be consistent: `initialLineNo` is the number of newlines in the file
     * up to `initialOffset`. Defaults to 0/0 (read from beginning).
     */
    initialOffset?: number;
    initialLineNo?: number;
    /**
     * mtime in nanoseconds at the moment the cursor was seeded. Lets the
     * tailer distinguish "file has grown since I was constructed" (normal)
     * from "file has been replaced" (rotation) on the first poll, which
     * would otherwise reset the seeded cursor to 0/0 unnecessarily.
     */
    initialMtimeNs?: bigint;
}

/**
 * Polls a JSONL file for new lines.
 *
 * Deterministic via `pollOnce()` for tests; otherwise drive with `start()`.
 *
 * Robust to:
 *   - file not yet existing
 *   - truncation/rotation (size < offset → re-read from 0, lineNo resets)
 *   - partial last line (buffered until \n)
 *   - UTF-8 multi-byte chars split across chunk boundaries (StringDecoder)
 *   - short fs.read returns (loops until requested length consumed)
 */
export class LiveTailer {
    private _offset = 0;
    private _lineNo = 0;
    private _partial = '';
    private _decoder = new StringDecoder('utf8');
    private _lastMtimeNs: bigint = 0n;
    private _timer: NodeJS.Timeout | undefined;
    private readonly _listeners = new Set<LineListener>();
    private readonly _pollIntervalMs: number;
    private readonly _maxChunkBytes: number;
    private readonly _filePath: string;
    private _inFlight: Promise<void> | undefined;

    constructor(filePath: string, opts: TailerOptions = {}) {
        this._filePath = filePath;
        this._pollIntervalMs = opts.pollIntervalMs ?? 250;
        this._maxChunkBytes = opts.maxChunkBytes ?? 4 * 1024 * 1024;
        this._offset = opts.initialOffset ?? 0;
        this._lineNo = opts.initialLineNo ?? 0;
        this._lastMtimeNs = opts.initialMtimeNs ?? 0n;
    }

    /**
     * Current line number the tailer has advanced past. Used by the SSE
     * handler to coordinate per-connection catch-up with the shared tailer's
     * live broadcast position. Read-only — no per-subscriber seek is exposed.
     */
    currentLineNo(): number {
        return this._lineNo;
    }

    subscribe(listener: LineListener): () => void {
        this._listeners.add(listener);
        return () => this._listeners.delete(listener);
    }

    listenerCount(): number { return this._listeners.size; }

    start(): void {
        if (this._timer) return;
        const tick = async () => {
            try { await this.pollOnce(); } catch { /* swallow */ }
            if (this._timer) this._timer = setTimeout(tick, this._pollIntervalMs);
        };
        this._timer = setTimeout(tick, 0);
    }

    stop(): void {
        if (this._timer) { clearTimeout(this._timer); this._timer = undefined; }
        this._listeners.clear();
    }

    /**
     * One synchronous-ish polling pass. Public for deterministic testing
     * and for the SSE server's "poll-now-on-watch-event" optimisation.
     *
     * Re-entrancy safe: concurrent callers share a single in-flight pass so
     * lines are never double-emitted when `start()`'s timer overlaps with a
     * watch-event-driven `pollOnce()` call.
     */
    async pollOnce(): Promise<void> {
        if (this._inFlight) return this._inFlight;
        this._inFlight = this._doPoll().finally(() => { this._inFlight = undefined; });
        return this._inFlight;
    }

    private async _doPoll(): Promise<void> {
        let stat: fs.BigIntStats;
        try { stat = await fsPromises.stat(this._filePath, { bigint: true }); }
        catch { return; }
        const size = Number(stat.size);
        const mtimeNs = stat.mtimeNs;
        // Truncation/rotation: shrunk file, OR same/smaller file that was
        // rewritten since we last saw it (mtime advanced past our marker).
        const rewritten = mtimeNs > this._lastMtimeNs && size <= this._offset;
        if (size < this._offset || rewritten) {
            // Truncation/rotation forces a re-read from the start. Pre-seeded
            // initialOffset/initialLineNo are intentionally discarded here:
            // the file has been replaced, so the construction-time cursor
            // no longer corresponds to any real file content.
            this._offset = 0;
            this._lineNo = 0;
            this._partial = '';
            this._decoder = new StringDecoder('utf8');
        }
        this._lastMtimeNs = mtimeNs;

        if (size === this._offset) return;

        const start = this._offset;
        const end = Math.min(size, start + this._maxChunkBytes);
        const length = end - start;
        const fd = await fsPromises.open(this._filePath, 'r');
        try {
            const buf = Buffer.alloc(length);
            let read = 0;
            while (read < length) {
                const r = await fd.read(buf, read, length - read, start + read);
                if (r.bytesRead === 0) break;
                read += r.bytesRead;
            }
            this._offset = start + read;
            const text = this._partial + this._decoder.write(buf.subarray(0, read));
            const lines = text.split('\n');
            this._partial = lines.pop() ?? '';
            for (const line of lines) {
                if (line.length === 0) continue;
                this._lineNo++;
                for (const l of this._listeners) {
                    try { l(line, this._lineNo); } catch { /* ignore listener errors */ }
                }
            }
        } finally {
            await fd.close();
        }
    }
}
