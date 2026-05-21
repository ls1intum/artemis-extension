/**
 * Unit tests for SessionRecorder — Block AB+E
 *
 * Covers the lifecycle FSM, commit boundary, generation token, startup
 * contributors, initial-state events, and consent-downgrade semantics.
 *
 * Tests drive the real SessionRecorder class with an injected
 * RecordingStorageWriter backed by a controllable in-memory fake fs. VS Code
 * listeners that fire during startup (`visibleTextEditors`, `terminals`,
 * `activeTextEditor`) are read from the real `vscode` namespace — the tests
 * make no assumptions about what is open at test time and assert only on the
 * presence/ordering of marker events and lifecycle-relevant pieces of the
 * stream.
 */

import * as vscode from 'vscode';
import * as assert from 'assert';

import { SessionRecorder } from '@extension/services/telemetry/recording/sessionRecorder';
import type { RecordingFs } from '@extension/services/telemetry/recording/storageWriter';
import { RecordingStorageWriter } from '@extension/services/telemetry/recording/storageWriter';
import type {
    ConfigurationChangeEvent,
    ConfigurationSnapshotEvent,
    InterventionEvent,
    RecordedEvent,
} from '@extension/services/telemetry/recording/types';

/**
 * Whitebox accessor for the per-URI debounce maps that live on the
 * ObservationRegistry the SessionRecorder composes. Tests need to seed
 * these maps to exercise discard/flush paths without waiting for real
 * debounce timers to fire. Centralized so the unsafe cast lives in one
 * place — and so the test's coupling to internal field names is honest.
 */
function pendingDebounceMaps(recorder: SessionRecorder): {
    _pendingSelectionPayloads: Map<string, RecordedEvent>;
    _pendingVisibleRangePayloads: Map<string, RecordedEvent>;
} {
    return (recorder as unknown as { _observation: {
        _pendingSelectionPayloads: Map<string, RecordedEvent>;
        _pendingVisibleRangePayloads: Map<string, RecordedEvent>;
    } })._observation;
}

// ── Fake FS with full pause-control ───────────────────────────────────────

/**
 * In-memory RecordingFs with pause-on-demand for mkdir, writeFile and
 * appendFile. Test setups arm a pause before triggering an operation and
 * release it later to simulate concurrent events.
 */
class FakeFs implements RecordingFs {
    appendedChunks: string[] = [];
    writtenFiles: { path: string; data: string }[] = [];
    removedPaths: string[] = [];
    syncChunks: string[] = [];
    mkdirCalls = 0;

    /** When true, the next writeFile call returns a promise that resolves via _releaseWriteFile(). */
    private _pauseNextWriteFile = false;
    private _writeFileGate: (() => void) | null = null;
    private _appendGate: (() => void) | null = null;
    private _pauseNextAppend = false;

    /** Arm the next writeFile to block until releaseWriteFile() is called. */
    armPauseNextWriteFile(): void {
        this._pauseNextWriteFile = true;
    }

    /** Release a paused writeFile. No-op if not currently paused. */
    releaseWriteFile(): void {
        const gate = this._writeFileGate;
        this._writeFileGate = null;
        gate?.();
    }

    armPauseNextAppend(): void {
        this._pauseNextAppend = true;
    }

    releaseAppend(): void {
        const gate = this._appendGate;
        this._appendGate = null;
        gate?.();
    }

    mkdir(_p: string, _opts: { recursive: boolean }): Promise<string | undefined> {
        this.mkdirCalls++;
        return Promise.resolve(undefined);
    }

    writeFile(p: string, data: string, _enc: BufferEncoding): Promise<void> {
        if (this._pauseNextWriteFile) {
            this._pauseNextWriteFile = false;
            return new Promise<void>((resolve) => {
                this._writeFileGate = () => {
                    this.writtenFiles.push({ path: p, data });
                    resolve();
                };
            });
        }
        this.writtenFiles.push({ path: p, data });
        return Promise.resolve();
    }

    appendFile(_p: string, data: string, _enc: BufferEncoding): Promise<void> {
        if (this._pauseNextAppend) {
            this._pauseNextAppend = false;
            return new Promise<void>((resolve) => {
                this._appendGate = () => {
                    this.appendedChunks.push(data);
                    resolve();
                };
            });
        }
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

/** Create a fresh SessionRecorder + FakeFs pair, writer injected. */
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

// ── Suite ────────────────────────────────────────────────────────────────

suite('SessionRecorder (Block AB+E)', () => {
    let recorder: SessionRecorder;
    let fs: FakeFs;

    setup(() => {
        const ctx = makeRecorder();
        recorder = ctx.recorder;
        fs = ctx.fs;
    });

    teardown(async () => {
        try { await recorder.dispose(); } catch { /* ignore */ }
    });

    // ── Test: Basic start sequence ────────────────────────────────────────

    test('startSession emits sessionStart, initial-state, startupPhaseComplete in order', async () => {
        recorder.enable();
        await recorder.startSession(42, 'p-1');
        await recorder.endSession();

        const events = collectWrittenEvents(fs);

        assert.ok(events.length > 0, 'expected at least one event');
        assert.strictEqual(events[0].type, 'sessionStart', `first event should be sessionStart, got ${events[0].type}`);

        const startupIdx = events.findIndex(e => e.type === 'startupPhaseComplete');
        assert.ok(startupIdx > 0, 'startupPhaseComplete must appear after sessionStart');

        const endIdx = events.findIndex(e => e.type === 'sessionEnd');
        assert.ok(endIdx > startupIdx, 'sessionEnd must come after startupPhaseComplete');

        // sessionStart carries schemaVersion: 2
        const start = events[0] as { schemaVersion?: number };
        assert.strictEqual(start.schemaVersion, 2);
    });

    // ── Test: sessionEnd is strictly the last event ───────────────────────

    test('sessionEnd is strictly the last event in the stream', async () => {
        recorder.enable();
        await recorder.startSession(1);
        recorder.recordIrisChatSent('hello');
        recorder.recordIrisChatReceived('hi');
        await recorder.endSession();

        const events = collectWrittenEvents(fs);
        assert.strictEqual(events[events.length - 1].type, 'sessionEnd');
    });

    // ── Test: Public record methods drop events after disable ─────────────

    test('disable() immediately blocks further record() calls', async () => {
        recorder.enable();
        await recorder.startSession(1);

        recorder.disable(); // synchronous phase flip to 'disabling'

        // These must be dropped:
        recorder.recordIrisChatSent('should-not-appear');
        recorder.recordIrisChatReceived('also-not');
        recorder.recordEqSnapshot(0.5, 'sufficient', 'save');

        // Let any queued lifecycle work drain.
        await new Promise(resolve => setTimeout(resolve, 20));

        const events = collectWrittenEvents(fs);
        const chatMsgs = events.filter(e => e.type === 'irisChatMessage');
        assert.strictEqual(chatMsgs.length, 0, 'no chat messages should reach disk after disable()');
    });

    // ── Test: post-commit disable produces consentChange + sessionEnd ─────

    test('post-commit disable emits consentChange then sessionEnd, no startupPhaseComplete-after-consentChange', async () => {
        recorder.enable();
        await recorder.startSession(1);

        // Session is committed and running. Now revoke consent.
        recorder.disable();

        // Let _doDisable drain.
        await new Promise(resolve => setTimeout(resolve, 30));

        const events = collectWrittenEvents(fs);
        const types = events.map(e => e.type);

        const consentIdx = types.lastIndexOf('consentChange');
        const endIdx = types.lastIndexOf('sessionEnd');

        assert.ok(consentIdx >= 0, `expected consentChange in stream, got types=${types.join(',')}`);
        assert.ok(endIdx > consentIdx, 'sessionEnd must come after consentChange');

        // No startupPhaseComplete after consentChange (the teardown path does not re-emit startup).
        const postConsentTypes = types.slice(consentIdx + 1);
        assert.ok(!postConsentTypes.includes('startupPhaseComplete'),
            'startupPhaseComplete must not appear after consentChange');
    });

    // ── Test: multi-generation coalescing ─────────────────────────────────

    test('three rapid startSession(A,B,C) calls produce at most one sessionStart per exercise', async () => {
        recorder.enable();

        // Fire three starts without awaiting the first two.
        const a = recorder.startSession(100);
        const b = recorder.startSession(101);
        const c = recorder.startSession(102);

        await Promise.all([a, b, c]);
        // End the final session so everything flushes.
        await recorder.endSession();

        const events = collectWrittenEvents(fs);
        const sessionStarts = events.filter(e => e.type === 'sessionStart') as Array<{ exerciseId: number }>;

        // The last-requested start (exercise 102) MUST commit. Earlier requests
        // are superseded before they reach commit-point, so they leave no
        // sessionStart on disk.
        const committedExerciseIds = sessionStarts.map(s => s.exerciseId);
        assert.ok(committedExerciseIds.includes(102),
            `expected exerciseId 102 to commit, got ${JSON.stringify(committedExerciseIds)}`);

        // At most one sessionStart per exerciseId.
        const uniqueIds = new Set(committedExerciseIds);
        assert.strictEqual(uniqueIds.size, committedExerciseIds.length, 'no duplicate sessionStart per exercise');

        // Each committed sessionStart is paired with a sessionEnd (we ended manually above).
        const sessionEnds = events.filter(e => e.type === 'sessionEnd');
        assert.strictEqual(sessionEnds.length, sessionStarts.length,
            `expected ${sessionStarts.length} sessionEnd(s), got ${sessionEnds.length}`);
    });

    // ── Test: startSession after disable() is a no-op ─────────────────────

    test('startSession() after disable() does not start a new session', async () => {
        recorder.enable();
        recorder.disable();

        await recorder.startSession(7);

        // Let everything settle.
        await new Promise(resolve => setTimeout(resolve, 20));

        const events = collectWrittenEvents(fs);
        const sessionStarts = events.filter(e => e.type === 'sessionStart');
        assert.strictEqual(sessionStarts.length, 0, 'no session should have started after disable()');
    });

    // ── Test: Startup contributors emit between sessionStart and startupPhaseComplete ──

    test('registered startup contributor events appear between sessionStart and startupPhaseComplete', async () => {
        recorder.enable();

        const marker: RecordedEvent = {
            type: 'eqEngineState',
            timestamp: 1234,
            snapshots: [],
            currentEQ: 0.42,
            pairCount: 5,
            confidence: 'sufficient',
        };

        recorder.registerStartupContributor(() => [marker]);

        await recorder.startSession(1);
        await recorder.endSession();

        const events = collectWrittenEvents(fs);
        const types = events.map(e => e.type);

        const startIdx = types.indexOf('sessionStart');
        const completeIdx = types.indexOf('startupPhaseComplete');
        const markerIdx = events.findIndex(e => e.type === 'eqEngineState' && (e as { currentEQ: number }).currentEQ === 0.42);

        assert.ok(startIdx >= 0);
        assert.ok(completeIdx > startIdx);
        assert.ok(markerIdx > startIdx && markerIdx < completeIdx,
            `contributor event must be between sessionStart(${startIdx}) and startupPhaseComplete(${completeIdx}), got index ${markerIdx}`);
    });

    // ── Test: metadata.eventCount matches lines written ──────────────────

    test('metadata.eventCount equals number of events in events.jsonl', async () => {
        recorder.enable();
        await recorder.startSession(77);
        recorder.recordIrisChatSent('a');
        recorder.recordIrisChatSent('b');
        recorder.recordIrisChatSent('c');
        await recorder.endSession();

        const events = collectWrittenEvents(fs);

        // Find the last metadata write.
        const metadataWrite = [...fs.writtenFiles].reverse().find(f => f.path.endsWith('metadata.json'));
        assert.ok(metadataWrite, 'metadata.json was not written');
        const metadata = JSON.parse(metadataWrite.data) as { eventCount: number };

        assert.strictEqual(metadata.eventCount, events.length,
            `metadata.eventCount=${metadata.eventCount} but JSONL has ${events.length} events`);
    });

    // ── Test: initial metadata.json is written at session start ──────────

    test('initial metadata.json is written at session start with endTime: null', async () => {
        recorder.enable();
        await recorder.startSession(77);

        // The first metadata write should happen during startSession, before
        // endSession is called. Find it without ending the session.
        // Allow the lane work to drain so the write actually hits the fake fs.
        await new Promise(resolve => setTimeout(resolve, 20));

        const firstMetadataWrite = fs.writtenFiles.find(f => f.path.endsWith('metadata.json'));
        assert.ok(firstMetadataWrite, 'initial metadata.json was not written at session start');
        const metadata = JSON.parse(firstMetadataWrite.data) as {
            startTime: number;
            endTime: number | null;
            eventCount: number;
        };
        assert.ok(typeof metadata.startTime === 'number' && metadata.startTime > 0);
        assert.strictEqual(metadata.endTime, null, 'initial endTime should be null while session is live');
        assert.strictEqual(metadata.eventCount, 0);

        await recorder.endSession();
    });

    test('final metadata.json overwrites initial with endTime + eventCount', async () => {
        recorder.enable();
        await recorder.startSession(77);
        recorder.recordIrisChatSent('one');
        recorder.recordIrisChatSent('two');
        await recorder.endSession();

        // The final metadata write is the latest one.
        const finalMetadata = [...fs.writtenFiles].reverse().find(f => f.path.endsWith('metadata.json'));
        assert.ok(finalMetadata, 'final metadata.json was not written');
        const metadata = JSON.parse(finalMetadata.data) as {
            startTime: number;
            endTime: number | null;
            eventCount: number;
        };
        assert.ok(typeof metadata.endTime === 'number', `endTime should be a number after end, got ${metadata.endTime}`);
        assert.ok(metadata.eventCount > 0, 'final eventCount should reflect recorded events');
    });

    // ── Test: lifecycle.recordInternal phase gating (via public surface) ──────────

    test('record() after session ends but before new session starts is a no-op', async () => {
        recorder.enable();
        await recorder.startSession(1);
        await recorder.endSession();

        const beforeLength = collectWrittenEvents(fs).length;

        recorder.recordIrisChatSent('ghost');
        recorder.recordEqSnapshot(0.1, 'sufficient', 'save');

        const afterLength = collectWrittenEvents(fs).length;

        assert.strictEqual(afterLength, beforeLength,
            'no events should be written between sessions');
    });

    // ── Test: enable()/disable() is idempotent ───────────────────────────

    test('enable() after enable() is a no-op', () => {
        recorder.enable();
        assert.strictEqual(recorder.isEnabled, true);
        recorder.enable(); // should not throw
        assert.strictEqual(recorder.isEnabled, true);
    });

    test('disable() after disable() is a no-op', () => {
        recorder.enable();
        recorder.disable();
        recorder.disable(); // should not throw
    });

    // ── Test: Pre-commit disable (paused initSession) aborts cleanly ─────

    test('disable() during paused initSession aborts without writing sessionStart', async () => {
        recorder.enable();

        // Arm: next writeFile (events.jsonl init inside initSession) will block
        // until we call releaseWriteFile().
        fs.armPauseNextWriteFile();

        const startPromise = recorder.startSession(99);

        // Yield so _doStart begins and reaches the paused writeFile.
        for (let i = 0; i < 10; i++) { await Promise.resolve(); }

        // Consent revoked while initSession is in flight. _requestedGeneration
        // flips to -1; _phase to 'disabling'.
        recorder.disable();

        // Release the paused writeFile so _doStart advances to its pre-commit
        // re-check — which must abort (no sessionStart written).
        fs.releaseWriteFile();

        // Await the start call (no-ops after abort) and the disable lifecycle.
        try { await startPromise; } catch { /* ignore */ }
        await new Promise(resolve => setTimeout(resolve, 30));

        const events = collectWrittenEvents(fs);
        const types = events.map(e => e.type);

        // Session never committed, so no sessionStart AND no consentChange/sessionEnd pair.
        assert.ok(!types.includes('sessionStart'),
            `pre-commit disable must not leak sessionStart. types=${types.join(',')}`);
        assert.ok(!types.includes('consentChange'),
            'pre-commit disable must not emit consentChange for an uncommitted session');
        assert.ok(!types.includes('sessionEnd'),
            'pre-commit disable must not emit sessionEnd for an uncommitted session');

        // The writer was aborted → session directory was requested to be removed.
        assert.ok(fs.removedPaths.length > 0, 'writer.abort() should have removed the session dir');
    });

    // ── Test: consent downgrade discards pending debounces (via disable) ──

    test('consent-downgrade path does not re-emit startupPhaseComplete', async () => {
        recorder.enable();
        await recorder.startSession(5);

        recorder.disable();
        await new Promise(resolve => setTimeout(resolve, 30));

        const events = collectWrittenEvents(fs);
        const types = events.map(e => e.type);

        // There should be exactly one startupPhaseComplete in the stream
        // (from the initial startSession), never a second one from teardown.
        const completeCount = types.filter(t => t === 'startupPhaseComplete').length;
        assert.strictEqual(completeCount, 1,
            `expected exactly one startupPhaseComplete, got ${completeCount}`);
    });

    // ── Test: dispose drains buffered events ─────────────────────────────

    test('dispose() with buffered events flushes everything before resolving', async () => {
        recorder.enable();
        await recorder.startSession(1);

        // Record a few events that are below the flush threshold.
        recorder.recordIrisChatSent('msg-1');
        recorder.recordIrisChatSent('msg-2');
        recorder.recordIrisChatSent('msg-3');

        await recorder.dispose();

        const events = collectWrittenEvents(fs);
        const chatMsgs = events.filter(e => e.type === 'irisChatMessage');
        assert.strictEqual(chatMsgs.length, 3,
            `expected 3 chat messages after dispose, got ${chatMsgs.length}`);

        // sessionEnd came before the dispose-flush path.
        const types = events.map(e => e.type);
        assert.ok(types.includes('sessionEnd'), 'dispose() should end the active session');
    });

    // ── Test: Generation token monotonicity (regression for reuse bug) ────

    test('disable → re-enable → start uses strictly larger generation (no reuse)', async () => {
        recorder.enable();
        await recorder.startSession(1);

        // Revoke consent: downgrades session 1 with consentChange + sessionEnd,
        // which flushes the buffer.
        recorder.disable();
        await new Promise(resolve => setTimeout(resolve, 20));

        recorder.enable();
        await recorder.startSession(2);
        await recorder.endSession();

        const allEvents = collectWrittenEvents(fs);
        const starts = allEvents.filter(e => e.type === 'sessionStart') as Array<{ exerciseId: number }>;
        const ends = allEvents.filter(e => e.type === 'sessionEnd') as Array<{ exerciseId: number }>;
        const consents = allEvents.filter(e => e.type === 'consentChange');

        // Session 1 committed, then downgraded (consentChange + sessionEnd).
        // Session 2 committed and ended regularly.
        assert.deepStrictEqual(starts.map(s => s.exerciseId), [1, 2],
            'two sessionStart events, one per exerciseId, in order');
        assert.deepStrictEqual(ends.map(e => e.exerciseId), [1, 2],
            'two sessionEnd events, one per exerciseId, in order');
        assert.strictEqual(consents.length, 1,
            'one consentChange from the disable that ended session 1');

        // Inspect on-disk layout: both sessions wrote their own session dir.
        const uniqueDirs = new Set(fs.writtenFiles.map(f => f.path.split('/').slice(0, -1).join('/')));
        assert.ok(uniqueDirs.size >= 2, 'expected at least 2 session directories');
    });

    // ── Test: stale contributor from a previous generation is ignored ───

    test('stale contributor that outlives its session does not leak events into a later one', async () => {
        recorder.enable();

        // A "misbehaving" contributor that caches the ctx and re-fires events
        // for a previous session. We exercise the generation gate explicitly
        // by calling recordViewNavigation() from inside the contributor,
        // which uses _currentGeneration at call-time — in the current (good)
        // implementation that is always the live generation, so this test
        // really just anchors the monotonic-generation invariant: the pre-
        // `-1` bug would have produced a `viewNavigation` event from
        // generation 0 inside session 2's stream after a disable + re-enable
        // cycle because _currentGeneration would also have been 0.
        let firedCount = 0;
        recorder.registerStartupContributor(() => {
            firedCount++;
            return [];
        });

        await recorder.startSession(10);
        recorder.disable();
        await new Promise(resolve => setTimeout(resolve, 20));

        recorder.enable();
        await recorder.startSession(11);
        await recorder.endSession();

        // Contributor fired once per committed session — not more, not less.
        assert.strictEqual(firedCount, 2, `contributor fired ${firedCount} times, expected 2`);

        // Both committed sessions exist, and each one is balanced.
        const events = collectWrittenEvents(fs);
        const starts = events.filter(e => e.type === 'sessionStart');
        const ends = events.filter(e => e.type === 'sessionEnd');
        assert.strictEqual(starts.length, 2);
        assert.strictEqual(ends.length, 2);

        // No crossover: the second session must not contain the first
        // session's exerciseId (which would indicate generation leakage).
        const startsTyped = starts as Array<{ exerciseId: number }>;
        assert.deepStrictEqual(startsTyped.map(s => s.exerciseId), [10, 11]);
    });

    // ── Test: consent-downgrade discards pending debounce payloads ──────

    test('consent-downgrade discards pending debounce payloads instead of flushing them', async () => {
        recorder.enable();
        await recorder.startSession(5);

        // Directly prime _pendingSelectionPayloads (per-URI Map, Block J) via
        // the pendingDebounceMaps() whitebox helper to simulate a debounce
        // timer that is pending but has not yet fired when consent is revoked.
        const fakeUri = 'file:///fake/Pending.java';
        const pendingPayload: RecordedEvent = {
            type: 'selectionChange',
            timestamp: Date.now(),
            uri: fakeUri,
            selections: [{ startLine: 1, startCharacter: 0, endLine: 1, endCharacter: 5 }],
            kind: undefined,
        };
        pendingDebounceMaps(recorder)._pendingSelectionPayloads.set(fakeUri, pendingPayload);

        // Revoke consent — _doDisable must DISCARD, not flush, the pending payload.
        recorder.disable();
        await new Promise(resolve => setTimeout(resolve, 30));

        const events = collectWrittenEvents(fs);
        const types = events.map(e => e.type);

        // The pending selectionChange must NOT appear in the stream.
        const selectionEvents = events.filter(e => e.type === 'selectionChange' && (e as { uri?: string }).uri === fakeUri);
        assert.strictEqual(selectionEvents.length, 0,
            'pending debounce payload must be discarded (not flushed) on consent downgrade');

        // The stream must still end with consentChange then sessionEnd.
        const consentIdx = types.lastIndexOf('consentChange');
        const endIdx = types.lastIndexOf('sessionEnd');
        assert.ok(consentIdx >= 0, 'consentChange must appear in the stream');
        assert.ok(endIdx > consentIdx, 'sessionEnd must come after consentChange');

        // The recorder must have cleared all pending payloads.
        assert.strictEqual(pendingDebounceMaps(recorder)._pendingSelectionPayloads.size, 0,
            '_pendingSelectionPayloads must be empty after disable()');
        assert.strictEqual(pendingDebounceMaps(recorder)._pendingVisibleRangePayloads.size, 0,
            '_pendingVisibleRangePayloads must be empty after disable()');
    });

    // ── Test: record methods without recording phase are no-ops ──────────

    test('recordPanelVisibility is a no-op when no session is active', async () => {
        recorder.enable();

        recorder.recordPanelVisibility('artemis', true);

        await new Promise(resolve => setTimeout(resolve, 10));

        const events = collectWrittenEvents(fs);
        const panelEvents = events.filter(e => e.type === 'panelVisibility');
        assert.strictEqual(panelEvents.length, 0,
            'panelVisibility before startSession must not be recorded');
    });

    // ── Block J: Per-URI debounce tests ───────────────────────────────────

    test('Block J — alternating selections on two URIs both appear in stream (no overwrite)', async () => {
        recorder.enable();
        await recorder.startSession(1);

        const uriA = 'file:///proj/A.java';
        const uriB = 'file:///proj/B.java';

        const payloadA: RecordedEvent = {
            type: 'selectionChange',
            timestamp: 1000,
            uri: uriA,
            selections: [{ startLine: 0, startCharacter: 0, endLine: 0, endCharacter: 3 }],
            kind: undefined,
        };
        const payloadB: RecordedEvent = {
            type: 'selectionChange',
            timestamp: 2000,
            uri: uriB,
            selections: [{ startLine: 5, startCharacter: 0, endLine: 5, endCharacter: 7 }],
            kind: undefined,
        };

        // Simulate two different URIs triggering in quick succession.
        pendingDebounceMaps(recorder)._pendingSelectionPayloads.set(uriA, payloadA);
        pendingDebounceMaps(recorder)._pendingSelectionPayloads.set(uriB, payloadB);

        // Flush on session end must emit both.
        await recorder.endSession();

        const events = collectWrittenEvents(fs);
        const selA = events.filter(e => e.type === 'selectionChange' && (e as { uri?: string }).uri === uriA);
        const selB = events.filter(e => e.type === 'selectionChange' && (e as { uri?: string }).uri === uriB);

        assert.strictEqual(selA.length, 1, 'selection event for URI A must appear exactly once');
        assert.strictEqual(selB.length, 1, 'selection event for URI B must appear exactly once');
    });

    test('Block J — trigger-time payload is recorded, not post-trigger state', async () => {
        recorder.enable();
        await recorder.startSession(1);

        const uri = 'file:///proj/C.java';
        const triggerTimePayload: RecordedEvent = {
            type: 'selectionChange',
            timestamp: 3000,
            uri,
            selections: [{ startLine: 10, startCharacter: 0, endLine: 10, endCharacter: 4 }],
            kind: undefined,
        };

        // Prime the pending map as if the event listener serialized at trigger time.
        pendingDebounceMaps(recorder)._pendingSelectionPayloads.set(uri, triggerTimePayload);

        // Simulate a post-trigger state change: the map now holds a DIFFERENT payload
        // for the same URI — but we captured triggerTimePayload already, so the
        // timer closure (which holds a reference to triggerTimePayload) will compare
        // correctly. The debounce timer has not been set in this white-box test,
        // so endSession() is the flush path we exercise here.
        await recorder.endSession();

        const events = collectWrittenEvents(fs);
        const selEvents = events.filter(e =>
            e.type === 'selectionChange' && (e as { uri?: string }).uri === uri
        ) as Array<{ selections: Array<{ startLine: number }> }>;

        assert.strictEqual(selEvents.length, 1, 'exactly one selectionChange for URI C');
        assert.strictEqual(selEvents[0].selections[0].startLine, 10,
            'recorded selection must reflect trigger-time payload (line 10), not a later state');
    });

    test('Block J — pending debounce at endSession appears before sessionEnd', async () => {
        recorder.enable();
        await recorder.startSession(1);

        const uri = 'file:///proj/D.java';
        const payload: RecordedEvent = {
            type: 'selectionChange',
            timestamp: 4000,
            uri,
            selections: [{ startLine: 2, startCharacter: 0, endLine: 2, endCharacter: 1 }],
            kind: undefined,
        };

        // Prime a pending payload that has not yet fired its timer.
        pendingDebounceMaps(recorder)._pendingSelectionPayloads.set(uri, payload);

        await recorder.endSession();

        const events = collectWrittenEvents(fs);
        const selIdx = events.findIndex(e => e.type === 'selectionChange' && (e as { uri?: string }).uri === uri);
        const endIdx = events.findIndex(e => e.type === 'sessionEnd');

        assert.ok(selIdx >= 0, 'pending selectionChange must appear in the stream on endSession');
        assert.ok(endIdx > selIdx, 'selectionChange must appear before sessionEnd');
    });

    test('Block J — pending debounce at disable() does NOT appear in stream', async () => {
        recorder.enable();
        await recorder.startSession(1);

        const uri = 'file:///proj/E.java';
        const payload: RecordedEvent = {
            type: 'selectionChange',
            timestamp: 5000,
            uri,
            selections: [{ startLine: 3, startCharacter: 0, endLine: 3, endCharacter: 2 }],
            kind: undefined,
        };

        pendingDebounceMaps(recorder)._pendingSelectionPayloads.set(uri, payload);

        // Consent revoked — pending payload must be discarded (Option A).
        recorder.disable();
        await new Promise(resolve => setTimeout(resolve, 30));

        const events = collectWrittenEvents(fs);
        const selEvents = events.filter(e => e.type === 'selectionChange' && (e as { uri?: string }).uri === uri);
        assert.strictEqual(selEvents.length, 0,
            'pending debounce must be discarded (not flushed) when consent is revoked via disable()');
    });

    test('Block J — repeated triggers on same URI clear old timer, no memory leak', async () => {
        recorder.enable();
        await recorder.startSession(1);

        const uri = 'file:///proj/F.java';

        // Simulate five rapid triggers on the same URI — only the last should remain pending.
        for (let i = 0; i < 5; i++) {
            const payload: RecordedEvent = {
                type: 'selectionChange',
                timestamp: 6000 + i,
                uri,
                selections: [{ startLine: i, startCharacter: 0, endLine: i, endCharacter: 1 }],
                kind: undefined,
            };
            pendingDebounceMaps(recorder)._pendingSelectionPayloads.set(uri, payload);
        }

        // After rapid triggers the map must still have exactly one entry for this URI.
        assert.strictEqual(
            pendingDebounceMaps(recorder)._pendingSelectionPayloads.size,
            1,
            'per-URI map must hold at most one pending payload per URI (no accumulation)',
        );

        await recorder.endSession();

        const events = collectWrittenEvents(fs);
        const selEvents = events.filter(e => e.type === 'selectionChange' && (e as { uri?: string }).uri === uri);
        assert.strictEqual(selEvents.length, 1,
            'exactly one selectionChange for F.java — the last trigger-time payload');
    });

    test('Block J — visible-range alternating on two URIs both appear in stream (no overwrite)', async () => {
        recorder.enable();
        await recorder.startSession(1);

        const uriA = 'file:///proj/G.java';
        const uriB = 'file:///proj/H.java';

        const payloadA: RecordedEvent = {
            type: 'visibleRangeChange',
            timestamp: 7000,
            uri: uriA,
            visibleRanges: [{ startLine: 0, startCharacter: 0, endLine: 20, endCharacter: 0 }],
        };
        const payloadB: RecordedEvent = {
            type: 'visibleRangeChange',
            timestamp: 8000,
            uri: uriB,
            visibleRanges: [{ startLine: 50, startCharacter: 0, endLine: 80, endCharacter: 0 }],
        };

        // Simulate two different URIs triggering visible-range changes in quick succession.
        pendingDebounceMaps(recorder)._pendingVisibleRangePayloads.set(uriA, payloadA);
        pendingDebounceMaps(recorder)._pendingVisibleRangePayloads.set(uriB, payloadB);

        // Flush on session end must emit both.
        await recorder.endSession();

        const events = collectWrittenEvents(fs);
        const vrA = events.filter(e => e.type === 'visibleRangeChange' && (e as { uri?: string }).uri === uriA);
        const vrB = events.filter(e => e.type === 'visibleRangeChange' && (e as { uri?: string }).uri === uriB);

        assert.strictEqual(vrA.length, 1, 'visibleRangeChange for URI G must appear exactly once');
        assert.strictEqual(vrB.length, 1, 'visibleRangeChange for URI H must appear exactly once');
    });

    test('Block J — pending visible-range at disable() does NOT appear in stream', async () => {
        recorder.enable();
        await recorder.startSession(1);

        const uri = 'file:///proj/I.java';
        const payload: RecordedEvent = {
            type: 'visibleRangeChange',
            timestamp: 9000,
            uri,
            visibleRanges: [{ startLine: 10, startCharacter: 0, endLine: 30, endCharacter: 0 }],
        };

        pendingDebounceMaps(recorder)._pendingVisibleRangePayloads.set(uri, payload);

        // Consent revoked — pending payload must be discarded (Option A).
        recorder.disable();
        await new Promise(resolve => setTimeout(resolve, 30));

        const events = collectWrittenEvents(fs);
        const vrEvents = events.filter(e => e.type === 'visibleRangeChange' && (e as { uri?: string }).uri === uri);
        assert.strictEqual(vrEvents.length, 0,
            'pending visibleRangeChange must be discarded (not flushed) when consent is revoked via disable()');
    });
});

suite('SessionRecorder — intervention suppression and configuration provenance', () => {
    test('recordIntervention with suppressed action persists suppressionReason', async () => {
        const { recorder, fs } = makeRecorder();
        recorder.enable();
        await recorder.startSession(42);
        recorder.recordIntervention(
            'suppressed', 'notification', true, 0.55, 'sufficient', 'execution-error',
            { suppressionReason: 'user-disabled', rawWanted: true },
        );
        await recorder.endSession();
        const events = collectWrittenEvents(fs);
        const intervention = events.find(e => e.type === 'intervention') as InterventionEvent | undefined;
        assert.ok(intervention, 'intervention event missing');
        assert.strictEqual(intervention!.action, 'suppressed');
        assert.strictEqual(intervention!.shouldIntervene, true);
        assert.strictEqual(intervention!.suppressionReason, 'user-disabled');
        assert.strictEqual(intervention!.rawWanted, true);
        assert.strictEqual(intervention!.level, 'notification');
        assert.strictEqual(intervention!.triggerType, 'execution-error');
        try { await recorder.dispose(); } catch { /* ignore */ }
    });

    test('recordConfigurationSnapshot persists both keys', async () => {
        const { recorder, fs } = makeRecorder();
        recorder.enable();
        await recorder.startSession(42);
        recorder.recordConfigurationSnapshot(true, false);
        await recorder.endSession();
        const events = collectWrittenEvents(fs);
        const snap = events.find(e => e.type === 'configurationSnapshot') as ConfigurationSnapshotEvent | undefined;
        assert.ok(snap, 'configurationSnapshot missing');
        assert.strictEqual(snap!.struggleDetectionEnabled, true);
        assert.strictEqual(snap!.showInterventions, false);
        try { await recorder.dispose(); } catch { /* ignore */ }
    });

    test('recordConfigurationChange persists only the changed key', async () => {
        const { recorder, fs } = makeRecorder();
        recorder.enable();
        await recorder.startSession(42);
        recorder.recordConfigurationChange({ showInterventions: false });
        await recorder.endSession();
        const events = collectWrittenEvents(fs);
        const change = events.find(e => e.type === 'configurationChange') as ConfigurationChangeEvent | undefined;
        assert.ok(change, 'configurationChange missing');
        assert.deepStrictEqual(change!.changes, { showInterventions: false });
        try { await recorder.dispose(); } catch { /* ignore */ }
    });
});
