/**
 * Handles all file I/O for session recordings.
 *
 * Uses a 10-event / 1-second buffer to batch writes.
 * Never throws: recording must not impact IDE stability.
 *
 * ## Durability Policy
 *
 * Awaiting shutdown() guarantees all buffered events are written first.
 * `deactivate()` in `extension.ts` awaits it, so graceful unload loses nothing.
 * An extension-host crash or process-kill bypasses `finally` and can lose up to
 * `BUFFER_THRESHOLD` (10) events; lifecycle events (`sessionStart`,
 * `sessionEnd`, `consentChange`) share that same boundary.
 *
 * ## Serialisation (Write Lane)
 *
 * All file-system operations are serialised through a single Promise chain
 * (`_writeLane`). This guarantees:
 *   1. No two `appendFile` calls run in parallel, so JSONL line order holds.
 *   2. Buffer removal is atomic: `splice` only runs after a successful write,
 *      so a failed write retains the full batch for the next attempt.
 *
 * ## Partial-Write Residual Risk
 *
 * If `appendFile` fails mid-write the file may contain an incomplete final
 * line. JSONL consumers MUST wrap each `JSON.parse` in try/catch and skip
 * malformed lines with a warning.
 */

import * as crypto from 'crypto';
import * as fsSync from 'fs';
import * as fsPromises from 'fs/promises';
import * as path from 'path';

import { LogCategory, logger } from '@extension/services/loggingService';
import pkg from '@root/package.json';

import type { RecordedEvent, SessionMetadata } from './types';

const BUFFER_THRESHOLD = 10;
const FLUSH_INTERVAL_MS = 1_000;
const MAX_SNAPSHOT_BYTES = 1_024 * 1_024; // 1 MB
const MAX_CONSECUTIVE_ERRORS = 5;
const LANE_DRAIN_TIMEOUT_MS = 5_000;

/**
 * Minimal async file-system interface used by RecordingStorageWriter.
 * Extracted so tests can inject a mock without fighting Node's non-configurable
 * module property descriptors.
 *
 * Note: `appendFileSync` exists solely for the shutdown() sync-fallback path,
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
     * Safe to use a sync fallback in `shutdown()` only when this is true.
     */
    private get _laneIdle(): boolean {
        return this._activeWrites === 0 && this._queuedWrites === 0;
    }

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
            void this._enqueueThresholdFlush();
        }
    }

    /**
     * Resolves once all events buffered at call time are on disk. Unlike the
     * threshold-debounced flush in appendEvent, this always enqueues a real
     * flush and awaits it. Concurrent callers each get their own flush; later
     * ones find the buffer already drained and return quickly.
     */
    async flush(): Promise<void> {
        if (this._disabled || !this._eventsPath) {
            return;
        }
        if (this._buffer.length === 0 && this._laneIdle) {
            return;
        }
        return this._enqueueFlush();
    }

    async writeSnapshot(uri: string, content: string): Promise<boolean> {
        if (this._disabled || !this._snapshotsDir) {
            return false;
        }
        // Capture before enqueuing: abort()/endSession() may null the field
        // before this lane work runs (abort() does not drain the lane).
        const snapshotsDir = this._snapshotsDir;
        let success = false;
        await this._enqueueLaneWork(async () => {
            const sanitized = this._sanitizeFileName(uri);
            const snapshotPath = path.join(snapshotsDir, `${sanitized}.txt`);
            const truncated = content.length > MAX_SNAPSHOT_BYTES
                ? content.slice(0, MAX_SNAPSHOT_BYTES) + '\n[TRUNCATED at 1MB]'
                : content;
            await this._fs.writeFile(snapshotPath, truncated, 'utf-8');
            this._consecutiveErrors = 0;
            success = true;
        }, 'Failed to write file snapshot');
        return success;
    }

    async writeMetadata(metadata: SessionMetadata): Promise<void> {
        if (this._disabled || !this._sessionDir) {
            return;
        }
        // Capture before enqueuing (see writeSnapshot): the field may be nulled
        // by abort()/endSession() before this lane work runs.
        const sessionDir = this._sessionDir;
        const enriched: SessionMetadata = {
            ...metadata,
            schemaVersion: 2,
            recorderVersion: this._recorderVersion,
        };
        return this._enqueueLaneWork(async () => {
            const metadataPath = path.join(sessionDir, 'metadata.json');
            await this._fs.writeFile(metadataPath, JSON.stringify(enriched, null, 2), 'utf-8');
            this._consecutiveErrors = 0;
        }, 'Failed to write session metadata');
    }

    async endSession(): Promise<void> {
        // Two-drain pattern. A single flush() is not enough: a debounced flush
        // queued inside the first flush's finally block runs after _drainLane()
        // resolves, so events buffered during it (including sessionEnd) would be
        // lost when _eventsPath is cleared below.
        await this._drainLane();
        await this._enqueueFlush();
        await this._drainLane();

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
     * Awaitable shutdown. Guarantees all buffered events are written to disk
     * before returning. Deliberately NOT named `dispose()`: it must be awaited
     * for the durability guarantee to hold, so it must never be mistaken for a
     * synchronous `vscode.Disposable.dispose()`.
     *
     * An idle lane takes a synchronous fallback write for minimal latency. A
     * busy lane gets up to 5 seconds to drain, then a final flush plus a second
     * drain for the deferred follow-up. On drain timeout the remaining buffer is
     * lost and a warning is logged.
     */
    async shutdown(): Promise<void> {
        if (this._disposed) { return; }
        this._disposed = true;
        this._stopFlushTimer();

        if (this._laneIdle) {
            // Lane is free, so the sync fallback gives the lowest-latency shutdown.
            if (this._buffer.length > 0 && this._eventsPath && !this._disabled) {
                try {
                    const lines = this._buffer.map(e => JSON.stringify(e)).join('\n') + '\n';
                    this._fs.appendFileSync(this._eventsPath, lines, 'utf-8');
                    this._buffer.length = 0;
                } catch (err) {
                    logger.warn('Recording writer shutdown: sync fallback write failed', LogCategory.TELEMETRY, err);
                }
            }
        } else {
            // Lane busy: wait for it to drain with a timeout.
            const drained = await Promise.race([
                this._drainLane().then(() => true as const),
                this._timeout(LANE_DRAIN_TIMEOUT_MS).then(() => false as const),
            ]);

            if (drained) {
                // Flush anything buffered during the drain, then drain again: the
                // debounced follow-up enqueued inside the first flush's finally
                // block would otherwise run after we return.
                await this._enqueueFlush();
                await this._drainLane();
            } else {
                logger.warn(
                    'Recording writer shutdown: lane drain timed out, accepting buffer loss',
                    LogCategory.TELEMETRY,
                );
            }
        }
    }

    /**
     * Abort a partially-initialised session. Stops the flush timer, clears
     * the buffer, and removes the session directory tree if it exists.
     *
     * NOT routed through the write lane: this is an emergency cleanup path for
     * when session start itself fails (e.g. pre-commit abort in
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
     * Threshold-driven flush from appendEvent. Debounced: if a flush is already
     * in-flight or queued, sets `_flushRequested` instead of enqueuing a second
     * one, and the finally block of the running lane work picks it up.
     *
     * The returned promise resolves when the lane drains, which suits
     * fire-and-forget triggers. For "await my events to disk", use flush().
     */
    private _enqueueThresholdFlush(): Promise<void> {
        if (this._activeWrites > 0 || this._queuedWrites > 0) {
            this._flushRequested = true;
            return this._drainLane();
        }
        return this._enqueueFlush();
    }

    /**
     * Enqueues a fresh flush on the write lane without debouncing. Resolves
     * when that specific flush completes.
     */
    private _enqueueFlush(): Promise<void> {
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
        }, 'Failed to flush recording events');
    }

    /**
     * Generic lane-enqueue helper. Wraps any async `work` lambda in the
     * serialisation machinery (counters, error handling, flush-debounce).
     *
     * Always resolves, never rejects: storage I/O errors are logged and counted
     * so recording cannot impact IDE stability. The defensive try/catch around
     * the non-work code keeps `_writeLane` out of a rejected state, which would
     * hang all subsequent lane work silently.
     */
    private _enqueueLaneWork(
        work: () => Promise<void>,
        errorMessage: string,
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
                            // Honour deferred flush requests after ANY lane work,
                            // not just flushes: a threshold trigger fired during a
                            // writeSnapshot or writeMetadata would otherwise sit
                            // unprocessed until the next threshold hit or timer tick.
                            if (this._flushRequested) {
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
                    // _writeLane must never reject: swallow so _queuedWrites does
                    // not leak and future enqueues do not deadlock.
                    logger.error(
                        '[StorageWriter] Lane rejected; this should never happen',
                        LogCategory.TELEMETRY,
                        err,
                    );
                });
        });

        return result;
    }

    private _startFlushTimer(): void {
        this._stopFlushTimer();
        this._flushTimer = setInterval(() => {
            // Timer ticks use the debounced threshold path so they coalesce
            // with appendEvent-triggered flushes instead of piling up behind
            // them under heavy load.
            void this._enqueueThresholdFlush();
        }, FLUSH_INTERVAL_MS);
    }

    private _stopFlushTimer(): void {
        if (this._flushTimer) {
            clearInterval(this._flushTimer);
            this._flushTimer = undefined;
        }
    }

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
