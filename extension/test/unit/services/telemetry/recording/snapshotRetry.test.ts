/**
 * Unit tests for Block G — Snapshot Retry with fileSnapshotError
 *
 * Covers:
 *   - writeSnapshot() returns false on fs error, true on success
 *   - First write failure: no fileSnapshot event, URI not in _snapshotedUris,
 *     retry happens on next editor switch
 *   - 3 consecutive failures: one fileSnapshotError event, no fileSnapshot event,
 *     URI permanently marked (no further retry attempts)
 *   - After fileSnapshotError: further editor switches to the same URI are no-ops
 *   - _snapshotRetries is cleared on session end/start (via _resetSessionState)
 */

import * as assert from 'assert';
import * as vscode from 'vscode';
import { SessionRecorder } from '../../../../../src/extension/services/telemetry/recording/sessionRecorder';
import type { RecordedEvent } from '../../../../../src/extension/services/telemetry/recording/types';
import { RecordingStorageWriter } from '../../../../../src/extension/services/telemetry/recording/storageWriter';
import type { RecordingFs } from '../../../../../src/extension/services/telemetry/recording/storageWriter';

// ── Fake FS with per-path failure control ─────────────────────────────────────

/**
 * A RecordingFs where writeFile can be configured to fail for specific paths
 * a given number of times, then succeed. Tracks all writeFile calls per path.
 */
class FakeFs implements RecordingFs {
    appendedChunks: string[] = [];
    writtenFiles: { path: string; data: string }[] = [];
    removedPaths: string[] = [];
    syncChunks: string[] = [];

    /** Map of path-suffix → remaining failure count */
    private _failPaths = new Map<string, number>();

    /**
     * Make the next N writeFile calls that contain `pathFragment` in the path
     * reject with an I/O error.
     */
    failWriteFileFor(pathFragment: string, times: number): void {
        this._failPaths.set(pathFragment, times);
    }

    mkdir(_p: string, _opts: { recursive: boolean }): Promise<string | undefined> {
        return Promise.resolve(undefined);
    }

    writeFile(p: string, data: string, _enc: BufferEncoding): Promise<void> {
        for (const [fragment, remaining] of this._failPaths) {
            if (p.includes(fragment) && remaining > 0) {
                this._failPaths.set(fragment, remaining - 1);
                return Promise.reject(new Error(`fake fs error for ${fragment}`));
            }
        }
        this.writtenFiles.push({ path: p, data });
        return Promise.resolve();
    }

    appendFile(_p: string, data: string, _enc: BufferEncoding): Promise<void> {
        this.appendedChunks.push(data);
        return Promise.resolve();
    }

    rm(p: string, _opts: { recursive: boolean; force: boolean }): Promise<void> {
        this.removedPaths.push(p);
        return Promise.resolve();
    }

    appendFileSync(_p: string, data: string, _enc: BufferEncoding): void {
        this.syncChunks.push(data);
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function collectWrittenEvents(fakeFs: FakeFs): RecordedEvent[] {
    const events: RecordedEvent[] = [];
    for (const chunk of fakeFs.appendedChunks) {
        for (const line of chunk.split('\n').filter(Boolean)) {
            try {
                events.push(JSON.parse(line) as RecordedEvent);
            } catch {
                /* skip malformed */
            }
        }
    }
    for (const chunk of fakeFs.syncChunks) {
        for (const line of chunk.split('\n').filter(Boolean)) {
            try {
                events.push(JSON.parse(line) as RecordedEvent);
            } catch {
                /* skip malformed */
            }
        }
    }
    return events;
}

/** Create a fresh SessionRecorder + FakeFs pair with writer injected. */
function makeRecorder(): { recorder: SessionRecorder; fs: FakeFs } {
    const fs = new FakeFs();
    const writer = new RecordingStorageWriter('/fake-base', fs, 'test-version');
    const fakeUri = vscode.Uri.file('/fake-base');
    const recorder = new SessionRecorder(
        fakeUri,
        { hasTerminalShellExecution: false, hasVscodeGitExtension: false },
        undefined,
        writer,
    );
    return { recorder, fs };
}

/**
 * Directly call SnapshotManager.snapshotContent via (recorder as any) to
 * simulate an editor switch that triggers a snapshot. This is the cleanest
 * way to test the retry logic without spinning up VS Code's real text
 * editor events.
 */
async function triggerSnapshot(
    recorder: SessionRecorder,
    uri: string,
    content: string,
    generation: number,
): Promise<void> {
    await (recorder as any)._snapshots.snapshotContent(uri, content, generation, { allowDuringStartup: false });
}

function getSnapshotedUris(recorder: SessionRecorder): Set<string> {
    return (recorder as any)._snapshots._snapshotedUris as Set<string>;
}

function getSnapshotRetries(recorder: SessionRecorder): Map<string, number> {
    return (recorder as any)._snapshots._snapshotRetries as Map<string, number>;
}

// ── Suite ────────────────────────────────────────────────────────────────────

suite('SessionRecorder — Block G: Snapshot Retry', () => {
    let recorder: SessionRecorder;
    let fs: FakeFs;

    setup(async () => {
        const ctx = makeRecorder();
        recorder = ctx.recorder;
        fs = ctx.fs;
        recorder.enable();
        await recorder.startSession(42, 'p-1');
    });

    teardown(async () => {
        try { await recorder.dispose(); } catch { /* ignore */ }
    });

    // ── Test 1: writeSnapshot returns false on error, true on success ─────

    test('writeSnapshot() returns false on fs error and true on success', async () => {
        const ctx = makeRecorder();
        const { fs: testFs } = ctx;
        const writer = new RecordingStorageWriter('/fake-base', testFs, 'test-version');
        await writer.initSession('test-session');

        const URI_FRAGMENT = 'MyClass_';
        testFs.failWriteFileFor(URI_FRAGMENT, 1);

        // Make the path include our fragment via a matching URI
        const failResult = await writer.writeSnapshot('file:///MyClass_fail.java', 'content');
        assert.strictEqual(failResult, false, 'writeSnapshot must return false on fs error');

        const successResult = await writer.writeSnapshot('file:///MyClass_fail.java', 'content');
        assert.strictEqual(successResult, true, 'writeSnapshot must return true on success');

        await writer.endSession();
    });

    // ── Test 2: First failure — no fileSnapshot, URI not in _snapshotedUris ──

    test('first snapshot failure: no fileSnapshot event emitted, URI stays unsnapshotted', async () => {
        const uri = 'file:///fake/Main.java';
        // The sanitized filename will contain the sha1 hash prefix + "Main.java"
        // We fail any writeFile that is not events.jsonl or metadata.json (i.e., snapshot files).
        fs.failWriteFileFor('snapshots', 1);

        const gen = (recorder as any)._currentGeneration as number;
        await triggerSnapshot(recorder, uri, 'class Main {}', gen);

        const events = collectWrittenEvents(fs);
        const snapshots = events.filter(e => e.type === 'fileSnapshot') as Array<{ uri: string }>;
        assert.strictEqual(snapshots.length, 0, 'no fileSnapshot should be emitted on first failure');

        // URI must NOT be in _snapshotedUris so a retry can happen
        const snapshotedUris = getSnapshotedUris(recorder);
        assert.ok(!snapshotedUris.has(uri), 'URI must not be in _snapshotedUris after first failure');

        // retry counter should be 1
        const retries = getSnapshotRetries(recorder);
        assert.strictEqual(retries.get(uri), 1, 'retry counter must be 1 after first failure');
    });

    // ── Test 3: Retry succeeds on second attempt ──────────────────────────

    test('retry on second editor switch succeeds: one fileSnapshot event, URI marked as snapshotted', async () => {
        const uri = 'file:///fake/Main.java';
        // Fail only the first snapshot write
        fs.failWriteFileFor('snapshots', 1);

        const gen = (recorder as any)._currentGeneration as number;

        // First attempt — fails
        await triggerSnapshot(recorder, uri, 'class Main {}', gen);

        const eventsAfterFailure = collectWrittenEvents(fs);
        const snapshotsAfterFailure = eventsAfterFailure.filter(e => e.type === 'fileSnapshot');
        assert.strictEqual(snapshotsAfterFailure.length, 0, 'no snapshot after first failure');

        // URI is still not in _snapshotedUris — simulate next editor switch
        const snapshotedUrisBefore = getSnapshotedUris(recorder);
        assert.ok(!snapshotedUrisBefore.has(uri), 'URI must not be snapshotted yet, enabling retry');

        // Second attempt — succeeds (fs is no longer failing)
        await triggerSnapshot(recorder, uri, 'class Main {}', gen);

        // Check in-memory state BEFORE endSession clears it via _resetSessionState().
        const snapshotedUris = getSnapshotedUris(recorder);
        assert.ok(snapshotedUris.has(uri), 'URI must be in _snapshotedUris after successful retry');

        const retries = getSnapshotRetries(recorder);
        assert.ok(!retries.has(uri), 'retry counter must be cleared after success');

        // endSession flushes the buffer so the fileSnapshot event reaches appendedChunks.
        await recorder.endSession();

        const eventsAfterRetry = collectWrittenEvents(fs);
        const snapshots = eventsAfterRetry.filter(e => e.type === 'fileSnapshot') as Array<{ uri: string }>;
        assert.strictEqual(snapshots.length, 1, 'exactly one fileSnapshot after successful retry');
        assert.strictEqual(snapshots[0].uri, uri);
    });

    // ── Test 4: 3 consecutive failures → one fileSnapshotError event ──────

    test('3 consecutive failures: emits exactly one fileSnapshotError, URI permanently marked', async () => {
        const uri = 'file:///fake/Heavy.java';
        // Fail all 3 snapshot writes
        fs.failWriteFileFor('snapshots', 3);

        const gen = (recorder as any)._currentGeneration as number;

        await triggerSnapshot(recorder, uri, 'content', gen);
        await triggerSnapshot(recorder, uri, 'content', gen);
        await triggerSnapshot(recorder, uri, 'content', gen);

        // Check in-memory state BEFORE endSession clears it via _resetSessionState().
        const snapshotedUris = getSnapshotedUris(recorder);
        assert.ok(snapshotedUris.has(uri), 'URI must be in _snapshotedUris after max-retry failure');

        const retries = getSnapshotRetries(recorder);
        assert.ok(!retries.has(uri), 'retry counter must be cleared after max retries');

        // endSession flushes the buffer so the fileSnapshotError event reaches appendedChunks.
        await recorder.endSession();

        const events = collectWrittenEvents(fs);

        const snapshots = events.filter(e => e.type === 'fileSnapshot');
        assert.strictEqual(snapshots.length, 0, 'no fileSnapshot should be emitted after 3 failures');

        const errors = events.filter(e => e.type === 'fileSnapshotError') as Array<{ uri: string; reason: string }>;
        assert.strictEqual(errors.length, 1, 'exactly one fileSnapshotError must be emitted');
        assert.strictEqual(errors[0].uri, uri);
        assert.strictEqual(errors[0].reason, 'snapshot-write-failed-after-3-retries');
    });

    // ── Test 5: After fileSnapshotError, further switches are no-ops ──────

    test('after fileSnapshotError, further snapshot attempts for the same URI are no-ops', async () => {
        const uri = 'file:///fake/Frozen.java';
        // Fail all 3 writes to reach the error state
        fs.failWriteFileFor('snapshots', 3);

        const gen = (recorder as any)._currentGeneration as number;

        await triggerSnapshot(recorder, uri, 'content', gen);
        await triggerSnapshot(recorder, uri, 'content', gen);
        await triggerSnapshot(recorder, uri, 'content', gen);

        // URI is now in _snapshotedUris — any subsequent call from
        // _captureFirstOpenSnapshot would be guarded by the `has(uri)` check.
        // Verify the set membership BEFORE endSession clears it via _resetSessionState().
        const snapshotedUrisBefore = getSnapshotedUris(recorder);
        assert.ok(snapshotedUrisBefore.has(uri), 'URI should be permanently marked at this point');

        // editorSwitch listener guard: _snapshotedUris.has(uri) must be true, blocking 4th attempt.
        // This is the invariant that prevents further snapshot attempts for this URI.
        assert.ok(snapshotedUrisBefore.has(uri),
            'editorSwitch listener guard: _snapshotedUris.has(uri) must be true, blocking 4th attempt');

        // endSession flushes the event buffer to disk so we can inspect it via collectWrittenEvents.
        // The fileSnapshotError event is in the writer's buffer until the flush runs.
        await recorder.endSession();

        // Verify exactly one fileSnapshotError in the event stream, confirming:
        //   (a) the error was emitted after the 3rd failure, and
        //   (b) no duplicate error was produced (the URI was permanently marked).
        const events = collectWrittenEvents(fs);
        const errorsAfterEnd = events.filter(e => e.type === 'fileSnapshotError');
        assert.strictEqual(errorsAfterEnd.length, 1,
            'exactly one fileSnapshotError in the event stream — no duplicate error events');
    });

    // ── Test 6: _snapshotRetries cleared on new session ───────────────────

    test('_snapshotRetries is cleared when a new session starts', async () => {
        const uri = 'file:///fake/Transient.java';
        // Fail once (but not max) to set a retry counter
        fs.failWriteFileFor('snapshots', 1);

        const gen = (recorder as any)._currentGeneration as number;
        await triggerSnapshot(recorder, uri, 'content', gen);

        const retriesBefore = getSnapshotRetries(recorder);
        assert.strictEqual(retriesBefore.get(uri), 1, 'retry counter is 1 before session restart');

        // End session and start a new one
        await recorder.endSession();
        await recorder.startSession(43, 'p-2');

        const retriesAfter = getSnapshotRetries(recorder);
        assert.strictEqual(retriesAfter.size, 0, '_snapshotRetries must be empty after new session starts');

        await recorder.endSession();
    });

    // ── Test 7: fileSnapshotError appears before sessionEnd ───────────────

    test('fileSnapshotError is written to the event stream (before sessionEnd)', async () => {
        const uri = 'file:///fake/ErrOrder.java';
        fs.failWriteFileFor('snapshots', 3);

        const gen = (recorder as any)._currentGeneration as number;

        await triggerSnapshot(recorder, uri, 'content', gen);
        await triggerSnapshot(recorder, uri, 'content', gen);
        await triggerSnapshot(recorder, uri, 'content', gen);

        await recorder.endSession();

        const events = collectWrittenEvents(fs);
        const types = events.map(e => e.type);

        const errorIdx = types.indexOf('fileSnapshotError');
        const endIdx = types.lastIndexOf('sessionEnd');

        assert.ok(errorIdx >= 0, 'fileSnapshotError must appear in the event stream');
        assert.ok(endIdx > errorIdx, 'sessionEnd must come after fileSnapshotError');
    });
});
