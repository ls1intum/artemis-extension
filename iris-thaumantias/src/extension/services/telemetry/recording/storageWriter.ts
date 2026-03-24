/**
 * Handles all file I/O for session recordings.
 *
 * Uses a 20-event / 5-second buffer to batch writes.
 * Never throws — recording must not impact IDE stability.
 */

import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import type { RecordedEvent, SessionMetadata } from './types';
import { logger, LogCategory } from '../../loggingService';

const BUFFER_THRESHOLD = 20;
const FLUSH_INTERVAL_MS = 5_000;
const MAX_SNAPSHOT_BYTES = 1_024 * 1_024; // 1 MB
const MAX_CONSECUTIVE_ERRORS = 5;

export class RecordingStorageWriter {
    private _buffer: RecordedEvent[] = [];
    private _flushTimer: NodeJS.Timeout | undefined;
    private _sessionDir: string | undefined;
    private _eventsPath: string | undefined;
    private _snapshotsDir: string | undefined;
    private _consecutiveErrors = 0;
    private _disabled = false;

    constructor(private readonly _baseDir: string) {}

    async initSession(sessionId: string): Promise<void> {
        this._disabled = false;
        this._consecutiveErrors = 0;
        this._sessionDir = path.join(this._baseDir, 'recordings', sessionId);
        this._snapshotsDir = path.join(this._sessionDir, 'snapshots');
        this._eventsPath = path.join(this._sessionDir, 'events.jsonl');

        try {
            await fs.mkdir(this._snapshotsDir, { recursive: true });
            await fs.writeFile(this._eventsPath, '', 'utf-8');
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
            void this.flush();
        }
    }

    async writeSnapshot(uri: string, content: string): Promise<void> {
        if (this._disabled || !this._snapshotsDir) {
            return;
        }
        try {
            const sanitized = this._sanitizeFileName(uri);
            const snapshotPath = path.join(this._snapshotsDir, `${sanitized}.txt`);
            const truncated = content.length > MAX_SNAPSHOT_BYTES
                ? content.slice(0, MAX_SNAPSHOT_BYTES) + '\n[TRUNCATED at 1MB]'
                : content;
            await fs.writeFile(snapshotPath, truncated, 'utf-8');
            this._consecutiveErrors = 0;
        } catch (err) {
            logger.error('Failed to write file snapshot', LogCategory.TELEMETRY, err);
            this._recordError();
        }
    }

    async writeMetadata(metadata: SessionMetadata): Promise<void> {
        if (this._disabled || !this._sessionDir) {
            return;
        }
        try {
            const metadataPath = path.join(this._sessionDir, 'metadata.json');
            await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2), 'utf-8');
            this._consecutiveErrors = 0;
        } catch (err) {
            logger.error('Failed to write session metadata', LogCategory.TELEMETRY, err);
            this._recordError();
        }
    }

    async flush(): Promise<void> {
        if (this._disabled || !this._eventsPath || this._buffer.length === 0) {
            return;
        }
        const batch = this._buffer.splice(0);
        const lines = batch.map(e => JSON.stringify(e)).join('\n') + '\n';
        try {
            await fs.appendFile(this._eventsPath, lines, 'utf-8');
            this._consecutiveErrors = 0;
        } catch (err) {
            logger.error('Failed to flush recording events', LogCategory.TELEMETRY, err);
            this._recordError();
        }
    }

    async endSession(): Promise<void> {
        await this.flush();
        this._stopFlushTimer();
        this._sessionDir = undefined;
        this._eventsPath = undefined;
        this._snapshotsDir = undefined;
    }

    dispose(): void {
        this._stopFlushTimer();
        // Best-effort final flush — fire-and-forget
        void this.flush();
        this._buffer = [];
    }

    /**
     * Returns the relative path within the snapshots dir for a given URI.
     * Used by SessionRecorder to create fileSnapshot events.
     */
    getSnapshotRelativePath(uri: string): string {
        return `snapshots/${this._sanitizeFileName(uri)}.txt`;
    }

    // ── Private ───────────────────────────────────────────────────────

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
}
