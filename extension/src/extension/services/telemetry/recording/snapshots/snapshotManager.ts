import * as vscode from 'vscode';

import { LogCategory, logger } from '@extension/services/loggingService';
import type { RecorderLifecycleState } from '@extension/services/telemetry/recording/lifecycleController';
import type { RecordingStorageWriter } from '@extension/services/telemetry/recording/storageWriter';
import type { FileSnapshotErrorEvent, RecordedEvent } from '@extension/services/telemetry/recording/types';
import { shouldRecordUri } from '@extension/services/telemetry/uriFilter';

interface SnapshotManagerDeps {
    state: RecorderLifecycleState;
    writer: RecordingStorageWriter;
    record: (
        event: RecordedEvent,
        opts: { allowDuringStartup?: boolean; allowDuringEnding?: boolean },
        generation: number,
    ) => void;
    /**
     * Synchronous lifecycle-bypass channel. Used for `fileSnapshotError` so
     * the event reaches disk even outside a phase that `record(...)` accepts.
     */
    lifecycleAppend: (event: RecordedEvent) => void;
}

/**
 * Owns per-session snapshot state: which URIs have been successfully
 * snapshotted, failure retry counters, and in-flight dedup. All snapshot
 * content is captured at trigger time by the caller and passed as a string
 * so VS Code's synchronous `doc.getText()` result is preserved across the
 * async write boundary.
 *
 * Invariants:
 *   - `hasSnapshot(uri)` iff the URI is marked as permanently handled for the
 *     current session (either a successful write or `MAX_RETRIES` consecutive
 *     failures).
 *   - On successful write: `_snapshotedUris.add(uri)`, retries cleared.
 *   - On failure below max: only `_snapshotRetries++`; URI stays unmarked so
 *     the next editor-switch can retry.
 *   - On reaching `MAX_RETRIES`: URI gets permanently marked AND a single
 *     `fileSnapshotError` event is appended via `lifecycleAppend`.
 *   - In-flight dedup: while a `writeSnapshot` is pending for a URI, further
 *     `snapshotContent(uri, ...)` calls are no-ops (prevents the
 *     rapid-editor-switch race where multiple concurrent writes could each
 *     emit a `fileSnapshot` event for the same URI).
 */
export class SnapshotManager {
    static readonly MAX_RETRIES = 3;

    private readonly _snapshotedUris = new Set<string>();
    private readonly _snapshotRetries = new Map<string, number>();
    private readonly _inFlightSnapshots = new Set<string>();

    constructor(private readonly _deps: SnapshotManagerDeps) {}

    /** True if the URI has either been successfully snapshotted or permanently marked as failed. */
    hasSnapshot(uri: string): boolean {
        return this._snapshotedUris.has(uri);
    }

    /**
     * Phase + generation gate for starting snapshot I/O. Returns false if the
     * snapshot must be skipped (session rotated, disabled, or already
     * disposing).
     *
     * Caveat: evaluated synchronously BEFORE the writer enqueues. A snapshot
     * already in the writer lane when `disable()` fires will still hit disk.
     */
    canWriteSnapshot(generation: number): boolean {
        if (generation !== this._deps.state.currentGeneration) { return false; }
        const phase = this._deps.state.phase;
        return phase === 'starting' || phase === 'recording';
    }

    /**
     * Snapshot document content to disk. Caller captures `content` at trigger
     * time via `doc.getText()` synchronously, so the async boundary of
     * `writeSnapshot` cannot observe a later state.
     */
    async snapshotContent(
        uri: string,
        content: string,
        generation: number,
        opts: { allowDuringStartup?: boolean } = {},
    ): Promise<void> {
        // Pre-write gate.
        if (!this.canWriteSnapshot(generation)) { return; }
        // In-flight dedup — fixes rapid-switch race where two concurrent
        // snapshot calls for the same URI could each emit a fileSnapshot event.
        if (this._inFlightSnapshots.has(uri)) { return; }

        this._inFlightSnapshots.add(uri);
        try {
            const snapshotPath = this._deps.writer.getSnapshotRelativePath(uri);
            const success = await this._deps.writer.writeSnapshot(uri, content);

            // Post-write gate: consent may have been revoked during await;
            // use the same predicate so disabled-but-same-generation does not
            // pollute the per-session tracking sets.
            if (!this.canWriteSnapshot(generation)) { return; }

            if (!success) {
                const retries = (this._snapshotRetries.get(uri) ?? 0) + 1;
                this._snapshotRetries.set(uri, retries);

                if (retries >= SnapshotManager.MAX_RETRIES) {
                    this._snapshotedUris.add(uri);
                    this._snapshotRetries.delete(uri);
                    const errorEvent: FileSnapshotErrorEvent = {
                        type: 'fileSnapshotError',
                        timestamp: Date.now(),
                        uri,
                        reason: 'snapshot-write-failed-after-3-retries',
                    };
                    this._deps.lifecycleAppend(errorEvent);
                    logger.warn(
                        `[SnapshotManager] Snapshot permanently failed for ${uri} after ${SnapshotManager.MAX_RETRIES} retries`,
                        LogCategory.TELEMETRY,
                    );
                }
                return;
            }

            this._snapshotedUris.add(uri);
            this._snapshotRetries.delete(uri);
            this._deps.record(
                { type: 'fileSnapshot', timestamp: Date.now(), uri, snapshotPath },
                { allowDuringStartup: opts.allowDuringStartup },
                generation,
            );
        } finally {
            this._inFlightSnapshots.delete(uri);
        }
    }

    /**
     * Capture open-file snapshots for every recordable document currently in
     * `vscode.workspace.textDocuments`. Reads `doc.getText()` synchronously at
     * trigger time so concurrent edits do not affect captured content.
     */
    async captureOpenFileSnapshots(
        generation: number,
        exerciseRootUri: vscode.Uri | undefined,
    ): Promise<void> {
        for (const doc of vscode.workspace.textDocuments) {
            if (!shouldRecordUri(doc.uri, exerciseRootUri)) { continue; }
            // Stop starting new snapshot writes as soon as the session is
            // superseded or disabled.
            if (!this.canWriteSnapshot(generation)) { return; }
            const uri = doc.uri.toString();
            const content = doc.getText();
            try {
                await this.snapshotContent(uri, content, generation, { allowDuringStartup: true });
            } catch (err) {
                logger.error('Failed to capture file snapshot', LogCategory.TELEMETRY, err);
            }
        }
    }

    /** Reset per-session state. Called at session boundary. */
    reset(): void {
        this._snapshotedUris.clear();
        this._snapshotRetries.clear();
        this._inFlightSnapshots.clear();
    }
}
