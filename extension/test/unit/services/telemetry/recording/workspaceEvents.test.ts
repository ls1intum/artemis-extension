/**
 * Unit tests for Block K — workspace file events and document open/close
 *
 * The VS Code extension-host test environment does not expose a way to fire
 * read-only `Event<T>` objects (e.g. `vscode.workspace.onDidCreateFiles`)
 * programmatically from test code.  We therefore use the same white-box
 * approach established in Block J: drive `_lifecycle.recordInternal` directly to
 * verify the recorder correctly gates and writes events, and assert that the
 * event types land in the stream with the expected fields.
 *
 * Covers:
 *   1. fileCreate event lands in stream with correct uri
 *   2. fileDelete event lands in stream with correct uri
 *   3. fileRename event lands in stream with oldUri + newUri
 *   4. textDocumentOpen event lands in stream with correct uri
 *   5. textDocumentClose event lands in stream with correct uri
 *   6. Events outside exerciseRoot are rejected by shouldRecordUri (unit-tested in uriFilter.test.ts;
 *      recorded here as a white-box integration check via the phase gate)
 *   7. All five new event types are gated by `_phase === 'recording'`: none reach disk when the
 *      recorder is idle (before startSession)
 *   8. All five new event types are gated by `_phase === 'recording'`: none reach disk after disable()
 */

import * as assert from 'assert';
import * as vscode from 'vscode';
import { SessionRecorder } from '../../../../../src/extension/services/telemetry/recording/sessionRecorder';
import type { RecordedEvent } from '../../../../../src/extension/services/telemetry/recording/types';
import { RecordingStorageWriter } from '../../../../../src/extension/services/telemetry/recording/storageWriter';
import type { RecordingFs } from '../../../../../src/extension/services/telemetry/recording/storageWriter';

// ── Minimal in-memory FS ──────────────────────────────────────────────────

class FakeFs implements RecordingFs {
    appendedChunks: string[] = [];
    writtenFiles: { path: string; data: string }[] = [];
    removedPaths: string[] = [];
    syncChunks: string[] = [];
    mkdirCalls = 0;

    mkdir(_p: string, _opts: { recursive: boolean }): Promise<string | undefined> {
        this.mkdirCalls++;
        return Promise.resolve(undefined);
    }

    writeFile(p: string, data: string, _enc: BufferEncoding): Promise<void> {
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

// ── Helpers ───────────────────────────────────────────────────────────────

function collectWrittenEvents(fakeFs: FakeFs): RecordedEvent[] {
    const events: RecordedEvent[] = [];
    for (const chunk of [...fakeFs.appendedChunks, ...fakeFs.syncChunks]) {
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

function makeRecorder(): { recorder: SessionRecorder; fs: FakeFs } {
    const fakeFs = new FakeFs();
    const writer = new RecordingStorageWriter('/fake-base', fakeFs, 'test-version');
    const fakeUri = vscode.Uri.file('/fake-base');
    const recorder = new SessionRecorder(
        fakeUri,
        { hasTerminalShellExecution: false, hasVscodeGitExtension: false },
        undefined,
        writer,
    );
    return { recorder, fs: fakeFs };
}

/** Inject a Block K event directly through the recorder's internal recording path. */
function injectEvent(recorder: SessionRecorder, event: RecordedEvent): void {
    const internal = recorder as unknown as {
        _lifecycle: { recordInternal(e: RecordedEvent, opts: object, gen: number): void };
        _currentGeneration: number;
    };
    internal._lifecycle.recordInternal(event, {}, internal._currentGeneration);
}

const ROOT = vscode.Uri.file('/workspace/exercise1').toString();

// ── Suite ────────────────────────────────────────────────────────────────

suite('Block K — workspace file events (white-box)', () => {
    let recorder: SessionRecorder;
    let fakeFs: FakeFs;

    setup(() => {
        const ctx = makeRecorder();
        recorder = ctx.recorder;
        fakeFs = ctx.fs;
    });

    teardown(async () => {
        try { await recorder.dispose(); } catch { /* ignore */ }
    });

    // ── Test 1: fileCreate ───────────────────────────────────────────────

    test('1. fileCreate event lands in stream with correct uri', async () => {
        recorder.enable();
        await recorder.startSession(1, 'p1', ROOT);

        const uri = vscode.Uri.file('/workspace/exercise1/src/NewFile.java').toString();
        injectEvent(recorder, { type: 'fileCreate', timestamp: Date.now(), uri });

        await recorder.endSession();

        const events = collectWrittenEvents(fakeFs);
        const creates = events.filter(e => e.type === 'fileCreate') as Array<{ uri: string }>;
        assert.ok(creates.length > 0, 'expected at least one fileCreate event');
        assert.ok(creates.some(e => e.uri === uri), `expected fileCreate with uri ${uri}`);
    });

    // ── Test 2: fileDelete ───────────────────────────────────────────────

    test('2. fileDelete event lands in stream with correct uri', async () => {
        recorder.enable();
        await recorder.startSession(1, 'p1', ROOT);

        const uri = vscode.Uri.file('/workspace/exercise1/src/OldFile.java').toString();
        injectEvent(recorder, { type: 'fileDelete', timestamp: Date.now(), uri });

        await recorder.endSession();

        const events = collectWrittenEvents(fakeFs);
        const deletes = events.filter(e => e.type === 'fileDelete') as Array<{ uri: string }>;
        assert.ok(deletes.length > 0, 'expected at least one fileDelete event');
        assert.ok(deletes.some(e => e.uri === uri), `expected fileDelete with uri ${uri}`);
    });

    // ── Test 3: fileRename ───────────────────────────────────────────────

    test('3. fileRename event lands in stream with oldUri and newUri', async () => {
        recorder.enable();
        await recorder.startSession(1, 'p1', ROOT);

        const oldUri = vscode.Uri.file('/workspace/exercise1/src/Foo.java').toString();
        const newUri = vscode.Uri.file('/workspace/exercise1/src/Bar.java').toString();
        injectEvent(recorder, { type: 'fileRename', timestamp: Date.now(), oldUri, newUri });

        await recorder.endSession();

        const events = collectWrittenEvents(fakeFs);
        const renames = events.filter(e => e.type === 'fileRename') as Array<{ oldUri: string; newUri: string }>;
        assert.ok(renames.length > 0, 'expected at least one fileRename event');
        const ev = renames.find(e => e.oldUri === oldUri && e.newUri === newUri);
        assert.ok(ev, `expected fileRename with oldUri=${oldUri} newUri=${newUri}`);
    });

    // ── Test 4: textDocumentOpen ─────────────────────────────────────────

    test('4. textDocumentOpen event lands in stream with correct uri', async () => {
        recorder.enable();
        await recorder.startSession(1, 'p1', ROOT);

        const uri = vscode.Uri.file('/workspace/exercise1/src/Main.java').toString();
        injectEvent(recorder, { type: 'textDocumentOpen', timestamp: Date.now(), uri });

        await recorder.endSession();

        const events = collectWrittenEvents(fakeFs);
        const opens = events.filter(e => e.type === 'textDocumentOpen') as Array<{ uri: string }>;
        assert.ok(opens.length > 0, 'expected at least one textDocumentOpen event');
        assert.ok(opens.some(e => e.uri === uri), `expected textDocumentOpen with uri ${uri}`);
    });

    // ── Test 5: textDocumentClose ────────────────────────────────────────

    test('5. textDocumentClose event lands in stream with correct uri', async () => {
        recorder.enable();
        await recorder.startSession(1, 'p1', ROOT);

        const uri = vscode.Uri.file('/workspace/exercise1/src/Main.java').toString();
        injectEvent(recorder, { type: 'textDocumentClose', timestamp: Date.now(), uri });

        await recorder.endSession();

        const events = collectWrittenEvents(fakeFs);
        const closes = events.filter(e => e.type === 'textDocumentClose') as Array<{ uri: string }>;
        assert.ok(closes.length > 0, 'expected at least one textDocumentClose event');
        assert.ok(closes.some(e => e.uri === uri), `expected textDocumentClose with uri ${uri}`);
    });

    // ── Test 6: Phase gate — all five types blocked before startSession ──

    test('6. all five Block K event types are rejected when not in recording phase (idle)', () => {
        recorder.enable();
        // Phase is 'idle' — no session started yet. Injecting through _lifecycle.recordInternal
        // should drop events because `_phase !== 'recording'`.
        const uri = vscode.Uri.file('/workspace/exercise1/src/Test.java').toString();
        const oldUri = uri;
        const newUri = vscode.Uri.file('/workspace/exercise1/src/Test2.java').toString();

        injectEvent(recorder, { type: 'fileCreate', timestamp: 1, uri });
        injectEvent(recorder, { type: 'fileDelete', timestamp: 2, uri });
        injectEvent(recorder, { type: 'fileRename', timestamp: 3, oldUri, newUri });
        injectEvent(recorder, { type: 'textDocumentOpen', timestamp: 4, uri });
        injectEvent(recorder, { type: 'textDocumentClose', timestamp: 5, uri });

        const events = collectWrittenEvents(fakeFs);
        const blockK = events.filter(e =>
            e.type === 'fileCreate' ||
            e.type === 'fileDelete' ||
            e.type === 'fileRename' ||
            e.type === 'textDocumentOpen' ||
            e.type === 'textDocumentClose',
        );
        assert.strictEqual(blockK.length, 0,
            `expected no Block K events before startSession, got: ${blockK.map(e => e.type).join(', ')}`);
    });

    // ── Test 7: Phase gate — all five types blocked after disable() ──────

    test('7. all five Block K event types are blocked after disable()', async () => {
        recorder.enable();
        await recorder.startSession(1, 'p1', ROOT);

        // Disable synchronously — phase flips to 'disabling' immediately.
        recorder.disable();

        // At this point phase is 'disabling', so _lifecycle.recordInternal must drop events.
        const uri = vscode.Uri.file('/workspace/exercise1/src/AfterDisable.java').toString();
        const newUri = vscode.Uri.file('/workspace/exercise1/src/AfterDisable2.java').toString();

        injectEvent(recorder, { type: 'fileCreate', timestamp: 10, uri });
        injectEvent(recorder, { type: 'fileDelete', timestamp: 11, uri });
        injectEvent(recorder, { type: 'fileRename', timestamp: 12, oldUri: uri, newUri });
        injectEvent(recorder, { type: 'textDocumentOpen', timestamp: 13, uri });
        injectEvent(recorder, { type: 'textDocumentClose', timestamp: 14, uri });

        // Let lifecycle drain.
        await new Promise(resolve => setTimeout(resolve, 30));

        const events = collectWrittenEvents(fakeFs);
        const blockK = events.filter(e =>
            e.type === 'fileCreate' ||
            e.type === 'fileDelete' ||
            e.type === 'fileRename' ||
            e.type === 'textDocumentOpen' ||
            e.type === 'textDocumentClose',
        );
        assert.strictEqual(blockK.length, 0,
            `expected no Block K events after disable(), got: ${blockK.map(e => e.type).join(', ')}`);
    });

    // ── Test 8: generation gate — stale callbacks from previous session ──

    test('8. Block K events from a stale generation are not written to the new session', async () => {
        recorder.enable();
        await recorder.startSession(1, 'p1', ROOT);

        // Capture the generation for session 1.
        const staleGen: number = (recorder as unknown as { _currentGeneration: number })._currentGeneration;

        // End session 1 and start session 2, so _currentGeneration advances.
        await recorder.startSession(2, 'p1', ROOT);

        // Inject events with the stale generation directly (mimics a late-firing async callback).
        const recorder_ = recorder as unknown as {
            _lifecycle: { recordInternal(e: RecordedEvent, opts: object, gen: number): void };
        };
        const uri = vscode.Uri.file('/workspace/exercise1/src/Stale.java').toString();
        recorder_._lifecycle.recordInternal({ type: 'fileCreate', timestamp: 99, uri }, {}, staleGen);

        await recorder.endSession();

        const events = collectWrittenEvents(fakeFs);
        // The stale fileCreate (timestamp: 99) must not appear.
        const staleCreates = events.filter(
            e => e.type === 'fileCreate' && (e as { uri: string }).uri === uri,
        );
        assert.strictEqual(staleCreates.length, 0,
            'stale fileCreate (wrong generation) must not appear in the new session');
    });
});
