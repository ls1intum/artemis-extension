/**
 * Handles all file I/O for session recordings.
 *
 * Uses a 20-event / 5-second buffer to batch writes.
 * Never throws — recording must not impact IDE stability.
 *
 * ## Durability Policy
 *
 * On graceful shutdown (dispose() is awaited), data integrity is guaranteed:
 * all buffered events are written before the method returns. On extension-host
 * crash, process-kill, or any fatal failure that bypasses `finally` execution,
 * up to `BUFFER_THRESHOLD` (20) events may be lost. Lifecycle events
 * (`sessionStart`, `sessionEnd`, `consentChange`) are recorded like any other
 * event and share the same crash-durability boundary.
 *
 * On graceful extension unload, `deactivate()` in `extension.ts` is async
 * and explicitly awaits `SessionRecorder.dispose()`, so all buffered events
 * reach disk before the extension host tears down the process.
 *
 * ## Serialisation (Write Lane)
 *
 * All file-system operations are serialised through a single Promise chain
 * (`_writeLane`). This guarantees:
 *   1. No two `appendFile` calls run in parallel — JSONL line order is preserved.
 *   2. Buffer removal is atomic: `splice` only runs after a successful write,
 *      so a failed write retains the full batch for the next attempt.
 *
 * ## Partial-Write Residual Risk
 *
 * If `appendFile` fails mid-write the file may contain an incomplete final
 * line. JSONL consumers MUST wrap each `JSON.parse` in try/catch and skip
 * malformed lines with a warning (already best-practice; required here).
 */

import * as crypto from 'crypto';
import * as fsPromises from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import type { RecordedEvent, SessionMetadata } from './types';
import { logger, LogCategory } from '../../loggingService';
import pkg from '../../../../../package.json';

const BUFFER_THRESHOLD = 20;
const FLUSH_INTERVAL_MS = 5_000;
const MAX_SNAPSHOT_BYTES = 1_024 * 1_024; // 1 MB
const MAX_CONSECUTIVE_ERRORS = 5;
const LANE_DRAIN_TIMEOUT_MS = 5_000;

/**
 * Minimal async file-system interface used by RecordingStorageWriter.
 * Extracted so tests can inject a mock without fighting Node's non-configurable
 * module property descriptors.
 *
 * Note: `appendFileSync` exists solely for the dispose() sync-fallback path,
 * which runs when the write lane is idle and we need the lowest-latency
 * shutdown (no microtask scheduling overhead).
 */
export interface RecordingFs {
    mkdir(path: string, options: { recursive: boolean }): Promise<string | undefined>;
    writeFile(path: string, data: string, encoding: BufferEncoding): Promise<void>;
    appendFile(path: string, data: string, encoding: BufferEncoding): Promise<void>;
    rm(path: string, options: { recursive: boolean; force: boolean }): Promise<void>;
    appendFileSync(path: string, data: string, encoding: BufferEncoding): void;
}

/** Default implementation that delegates to Node's built-in fs modules. */
const defaultFs: RecordingFs = {
    mkdir: (p, opts) => fsPromises.mkdir(p, opts) as Promise<string | undefined>,
    writeFile: (p, data, enc) => fsPromises.writeFile(p, data, enc),
    appendFile: (p, data, enc) => fsPromises.appendFile(p, data, enc),
    rm: (p, opts) => fsPromises.rm(p, opts),
    appendFileSync: (p, data, enc) => fsSync.appendFileSync(p, data, enc),
};

export class RecordingStorageWriter {
    private _buffer: RecordedEvent[] = [];
    private _flushTimer: NodeJS.Timeout | undefined;
    private _sessionDir: string | undefined;
    private _eventsPath: string | undefined;
    private _snapshotsDir: string | undefined;
    private _consecutiveErrors = 0;
    private _disabled = false;
    private _disposed = false;
    private readonly _fs: RecordingFs;

    // ── Write-Lane state ──────────────────────────────────────────────────

    /**
     * Single Promise chain that serialises all fs writes. Every write
     * operation appends to this chain via `.then(() => ...)` so that at most
     * one fs call is in flight at any time.
     */
    private _writeLane: Promise<void> = Promise.resolve();

    /**
     * Number of write operations currently executing inside the lane.
     * Incremented immediately before the fs call, decremented in `finally`.
     */
    private _activeWrites = 0;

    /**
     * Number of write lambdas queued in the lane but not yet started.
     * Incremented at enqueue time, decremented when the lambda begins.
     */
    private _queuedWrites = 0;

    /**
     * True when no write is executing and no write is queued.
     * Safe to use a sync fallback in `dispose()` only when this is true.
     */
    private get _laneIdle(): boolean {
        return this._activeWrites === 0 && this._queuedWrites === 0;
    }

    // ── Threshold-flush debounce flag ─────────────────────────────────────

    /**
     * Set to true when a threshold-triggered flush is requested while another
     * flush is already in-flight. Checked after each lane operation completes
     * to avoid runaway queue growth.
     */
    private _flushRequested = false;

    constructor(
        private readonly _baseDir: string,
        fs?: RecordingFs,
        private readonly _recorderVersion: string = pkg.version,
    ) {
        this._fs = fs ?? defaultFs;
    }

    async initSession(sessionId: string): Promise<void> {
        this._disabled = false;
        this._consecutiveErrors = 0;
        this._sessionDir = path.join(this._baseDir, 'recordings', sessionId);
        this._snapshotsDir = path.join(this._sessionDir, 'snapshots');
        this._eventsPath = path.join(this._sessionDir, 'events.jsonl');

        try {
            await this._fs.mkdir(this._snapshotsDir, { recursive: true });
            await this._fs.writeFile(this._eventsPath, '', 'utf-8');
        } catch (err) {
            logger.error('Failed to initialize recording session directory', LogCategory.TELEMETRY, err);
            this._recordError();
        }

        this._startFlushTimer();
    }

    appendEvent(event: RecordedEvent): void {
        if (this._disabled) {
            return;
        }
        this._buffer.push(event);
        if (this._buffer.length >= BUFFER_THRESHOLD) {
            void this._enqueueFlush();
        }
    }

    /**
     * Enqueues a flush onto the write lane and returns a Promise that resolves
     * when that specific flush has finished (successfully or not).
     */
    async flush(): Promise<void> {
        return this._enqueueFlush();
    }

    async writeSnapshot(uri: string, content: string): Promise<void> {
        if (this._disabled || !this._snapshotsDir) {
            return;
        }
        return this._enqueueLaneWork(async () => {
            const sanitized = this._sanitizeFileName(uri);
            const snapshotPath = path.join(this._snapshotsDir!, `${sanitized}.txt`);
            const truncated = content.length > MAX_SNAPSHOT_BYTES
                ? content.slice(0, MAX_SNAPSHOT_BYTES) + '\n[TRUNCATED at 1MB]'
                : content;
            await this._fs.writeFile(snapshotPath, truncated, 'utf-8');
            this._consecutiveErrors = 0;
        }, 'Failed to write file snapshot');
    }

    async writeMetadata(metadata: SessionMetadata): Promise<void> {
        if (this._disabled || !this._sessionDir) {
            return;
        }
        const enriched: SessionMetadata = {
            ...metadata,
            schemaVersion: 2,
            recorderVersion: this._recorderVersion,
        };
        return this._enqueueLaneWork(async () => {
            const metadataPath = path.join(this._sessionDir!, 'metadata.json');
            await this._fs.writeFile(metadataPath, JSON.stringify(enriched, null, 2), 'utf-8');
            this._consecutiveErrors = 0;
        }, 'Failed to write session metadata');
    }

    async endSession(): Promise<void> {
        // Two-drain pattern: ensure any in-flight flush completes, then flush
        // whatever was buffered during that flush, then wait for that too.
        // A single await flush() is not enough: if a debounced flush was queued
        // inside the current flush's finally block, _drainLane() resolves before
        // that deferred flush runs, so events buffered during flush1 (including
        // the sessionEnd event itself) would be silently lost when _eventsPath
        // is cleared below.
        await this._drainLane();          // wait for any in-flight work
        await this._enqueueFlush();       // flush everything currently buffered
        await this._drainLane();          // wait for that flush + any deferred follow-up

        if (this._buffer.length > 0) {
            logger.warn(
                `[StorageWriter] endSession: ${this._buffer.length} event(s) remain in buffer after drain (new events arrived during shutdown)`,
                LogCategory.TELEMETRY,
            );
        }

        this._stopFlushTimer();
        this._sessionDir = undefined;
        this._eventsPath = undefined;
        this._snapshotsDir = undefined;
    }

    /**
     * Awaitable dispose. On graceful shutdown, guarantees all buffered events
     * are written to disk before returning.
     *
     * If the lane is already idle (no active/queued writes), a synchronous
     * fallback writes the remaining buffer directly for minimal latency.
     *
     * If the lane is busy, waits up to 5 seconds for it to drain, then
     * performs one final async flush for any events that arrived during the
     * drain, then drains once more to ensure the deferred follow-up flush also
     * completes. If the drain times out, the remaining buffer is lost and a
     * warning is logged.
     */
    async dispose(): Promise<void> {
        if (this._disposed) { return; }
        this._disposed = true;
        this._stopFlushTimer();

        if (this._laneIdle) {
            // Lane is free — use sync fallback for lowest-latency shutdown.
            if (this._buffer.length > 0 && this._eventsPath && !this._disabled) {
                try {
                    const lines = this._buffer.map(e => JSON.stringify(e)).join('\n') + '\n';
                    this._fs.appendFileSync(this._eventsPath, lines, 'utf-8');
                    this._buffer.length = 0;
                } catch (err) {
                    logger.warn('Recording writer dispose: sync fallback write failed', LogCategory.TELEMETRY, err);
                }
            }
        } else {
            // Lane busy: wait for it to drain with a timeout.
            const drained = await Promise.race([
                this._drainLane().then(() => true as const),
                this._timeout(LANE_DRAIN_TIMEOUT_MS).then(() => false as const),
            ]);

            if (drained) {
                // Lane drained — flush anything buffered during the drain, then
                // drain once more so the deferred follow-up flush also completes.
                // (One _enqueueFlush() alone is not enough: the debounced flush2
                // enqueued inside flush1's finally block resolves after _drainLane
                // was captured, so without a second drain it runs after we return.)
                await this._enqueueFlush();
                await this._drainLane();
            } else {
                logger.warn(
                    'Recording writer dispose: lane drain timed out, accepting buffer loss',
                    LogCategory.TELEMETRY,
                );
            }
        }
    }

    /**
     * Abort a partially-initialised session. Stops the flush timer, clears
     * the buffer, and removes the session directory tree if it exists.
     *
     * NOT routed through the write lane — intended as an emergency cleanup
     * path when session start itself fails (e.g. pre-commit abort in
     * SessionRecorder._doStart). Safe to call even if initSession was never
     * completed.
     */
    async abort(): Promise<void> {
        if (this._disposed) { return; }
        this._stopFlushTimer();
        this._buffer = [];
        const dirToRemove = this._sessionDir;
        this._sessionDir = undefined;
        this._eventsPath = undefined;
        this._snapshotsDir = undefined;

        if (dirToRemove) {
            try {
                await this._fs.rm(dirToRemove, { recursive: true, force: true });
            } catch (err) {
                logger.error('Failed to remove aborted session directory', LogCategory.TELEMETRY, err);
            }
        }
    }

    /**
     * Returns the relative path within the snapshots dir for a given URI.
     * Used by SessionRecorder to create fileSnapshot events.
     */
    getSnapshotRelativePath(uri: string): string {
        return `snapshots/${this._sanitizeFileName(uri)}.txt`;
    }

    // ── Private: Lane management ──────────────────────────────────────────

    /**
     * Returns a Promise that resolves once the current write lane has fully
     * drained (all queued and active writes complete).
     *
     * The `.then(() => {})` intentionally detaches the returned promise from
     * the lane chain: callers get a void promise that settles when the lane is
     * empty, but appending to it does not extend _writeLane itself.
     */
    private _drainLane(): Promise<void> {
        return this._writeLane.then(() => {});
    }

    /**
     * Enqueues a flush operation on the write lane.
     * Returns a Promise that resolves when that flush completes.
     *
     * Debounce: if a flush is already in-flight or queued, sets `_flushRequested`
     * instead of enqueuing a second one. After each flush completes, the lane
     * completion logic checks the flag and enqueues one more if set. This
     * applies to both threshold-triggered flushes (via appendEvent) and
     * timer-triggered flushes (via public flush()), ensuring at most one
     * pending flush is ever queued behind the active one.
     */
    private _enqueueFlush(): Promise<void> {
        if (this._activeWrites > 0 || this._queuedWrites > 0) {
            // A flush is already in flight or queued; mark that we need
            // another flush once it finishes instead of enqueuing a second.
            this._flushRequested = true;
            return this._drainLane();
        }
        return this._enqueueLaneWork(async () => {
            if (this._disabled || !this._eventsPath) {
                return;
            }

            // Snapshot the buffer at lane-start time so we pick up events that
            // arrived since the flush was enqueued.
            const batch = this._buffer.slice();
            const batchSize = batch.length;
            if (batchSize === 0) {
                return;
            }

            const lines = batch.map(e => JSON.stringify(e)).join('\n') + '\n';

            await this._fs.appendFile(this._eventsPath, lines, 'utf-8');

            // Success: remove exactly the events we just wrote. Events that
            // arrived during the appendFile call remain in _buffer for the
            // next flush, preserving order.
            this._buffer.splice(0, batchSize);
            this._consecutiveErrors = 0;
        }, 'Failed to flush recording events', /* isFlush */ true);
    }

    /**
     * Generic lane-enqueue helper. Wraps any async `work` lambda in the
     * serialisation machinery (counters, error handling, flush-debounce).
     *
     * Always resolves — never rejects. Storage I/O errors are logged and
     * counted; the caller does not need to catch. This upholds the class
     * contract: "Never throws — recording must not impact IDE stability."
     *
     * A defensive try/catch around non-work code (counters, debounce) ensures
     * unexpected exceptions do not leave `_writeLane` in a rejected state
     * (which would cause all subsequent lane work to hang silently).
     */
    private _enqueueLaneWork(
        work: () => Promise<void>,
        errorMessage: string,
        isFlush = false,
    ): Promise<void> {
        this._queuedWrites++;

        const result = new Promise<void>((resolve) => {
            this._writeLane = this._writeLane
                .then(async () => {
                    this._queuedWrites--;
                    this._activeWrites++;
                    try {
                        await work();
                    } catch (err) {
                        logger.error(errorMessage, LogCategory.TELEMETRY, err);
                        this._recordError();
                    } finally {
                        this._activeWrites--;
                        try {
                            // After a flush completes, honour deferred threshold requests.
                            if (isFlush && this._flushRequested) {
                                this._flushRequested = false;
                                void this._enqueueFlush();
                            }
                        } catch {
                            // Defensive: debounce logic must not poison the lane
                        }
                        resolve();
                    }
                })
                .catch((err) => {
                    // Defensive invariant: _writeLane must never reject. If it
                    // somehow does, swallow the error so _queuedWrites does not
                    // leak and the lane does not deadlock on all future enqueues.
                    logger.error(
                        '[StorageWriter] Lane rejected; this should never happen',
                        LogCategory.TELEMETRY,
                        err,
                    );
                });
        });

        return result;
    }

    // ── Private: Timer ────────────────────────────────────────────────────

    private _startFlushTimer(): void {
        this._stopFlushTimer();
        this._flushTimer = setInterval(() => {
            void this.flush();
        }, FLUSH_INTERVAL_MS);
    }

    private _stopFlushTimer(): void {
        if (this._flushTimer) {
            clearInterval(this._flushTimer);
            this._flushTimer = undefined;
        }
    }

    // ── Private: Helpers ──────────────────────────────────────────────────

    private _sanitizeFileName(uri: string): string {
        const lastSegment = uri.split('/').pop() ?? 'unknown';
        const sanitized = lastSegment.replace(/[^a-zA-Z0-9._-]/g, '_');
        const hash = crypto.createHash('sha1').update(uri).digest('hex').slice(0, 8);
        return `${hash}_${sanitized}`;
    }

    private _recordError(): void {
        this._consecutiveErrors++;
        if (this._consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
            logger.error(
                `Recording storage disabled after ${MAX_CONSECUTIVE_ERRORS} consecutive I/O errors`,
                LogCategory.TELEMETRY,
            );
            this._disabled = true;
            this._stopFlushTimer();
        }
    }

    private _timeout(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
