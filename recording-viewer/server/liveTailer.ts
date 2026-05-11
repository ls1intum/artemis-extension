import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import { StringDecoder } from 'string_decoder';

export type LineListener = (line: string, lineNo: number) => void;

export interface TailerOptions {
    pollIntervalMs?: number;
    maxChunkBytes?: number;
    /**
     * If true, the first poll positions `_offset` at end-of-file and counts
     * existing `\n`s to set `_lineNo` accordingly. Use this when a client
     * connects to a long-running session and the per-connection catch-up has
     * already replayed historical lines; the shared tailer should only
     * broadcast newly appended lines from this point forward.
     */
    startAtEnd?: boolean;
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
    private readonly _startAtEnd: boolean;
    private _seekedToEnd = false;
    private _inFlight: Promise<void> | undefined;

    constructor(filePath: string, opts: TailerOptions = {}) {
        this._filePath = filePath;
        this._pollIntervalMs = opts.pollIntervalMs ?? 250;
        this._maxChunkBytes = opts.maxChunkBytes ?? 4 * 1024 * 1024;
        this._startAtEnd = opts.startAtEnd ?? false;
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
            this._offset = 0;
            this._lineNo = 0;
            this._partial = '';
            this._decoder = new StringDecoder('utf8');
            this._seekedToEnd = false;
        }
        this._lastMtimeNs = mtimeNs;

        // One-time seek-to-end on the first poll, when enabled: skip historical
        // content present at construction time and broadcast only newly-appended
        // lines thereafter. _lineNo is set by counting existing `\n`s so future
        // SSE `id:` values stay aligned with file line numbers (critical for
        // Last-Event-ID resume).
        //
        // We mark `_seekedToEnd = true` even when size === 0, so a file that
        // appears later is treated as fresh content (no historical content to
        // skip) and emitted normally. Without this, content written after the
        // tailer was constructed would be incorrectly skipped as "historical".
        if (this._startAtEnd && !this._seekedToEnd) {
            this._seekedToEnd = true;
            if (size > 0) {
                const fd = await fsPromises.open(this._filePath, 'r');
                try {
                    let pos = 0;
                    let lineCount = 0;
                    const scratch = Buffer.alloc(Math.min(size, this._maxChunkBytes));
                    while (pos < size) {
                        const remaining = size - pos;
                        const chunkLen = Math.min(remaining, scratch.length);
                        const r = await fd.read(scratch, 0, chunkLen, pos);
                        if (r.bytesRead === 0) break;
                        for (let i = 0; i < r.bytesRead; i++) {
                            if (scratch[i] === 0x0A) lineCount++;
                        }
                        pos += r.bytesRead;
                    }
                    this._offset = size;
                    this._lineNo = lineCount;
                } finally {
                    await fd.close();
                }
            }
            return;
        }

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
