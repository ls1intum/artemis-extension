/**
 * Unit tests for RecordingStorageWriter — Block D
 *
 * Tests cover:
 *   - Write-lane serialisation (no parallel appendFile calls)
 *   - Atomic batch removal (failed write retains events)
 *   - Event ordering across concurrent triggers
 *   - dispose() sync-fallback (idle lane)
 *   - dispose() async-drain (busy lane)
 *   - Consecutive-error counter disables writer
 *   - Threshold + timer flush debounce (no runaway queue)
 *   - abort() removes session directory
 *   - endSession() waits for in-flight flush and deferred flush (race fix)
 *   - writeMetadata enrichment (schemaVersion, recorderVersion)
 */

import * as assert from 'assert';
import * as path from 'path';
import { RecordingStorageWriter } from '../../../../../src/extension/services/telemetry/recording/storageWriter';
import type { RecordingFs } from '../../../../../src/extension/services/telemetry/recording/storageWriter';
import type { RecordedEvent } from '../../../../../src/extension/services/telemetry/recording/types';

// ── Fake FS ───────────────────────────────────────────────────────────────────

/**
 * A fully-controllable in-memory RecordingFs implementation.
 * appendFile writes to the `appendedChunks` list; writeFile goes to `writtenFiles`.
 */
class FakeFs implements RecordingFs {
    /** All chunks passed to appendFile(), in call order */
    appendedChunks: string[] = [];

    /** All args to rm() */
    removedPaths: { path: string; recursive: boolean; force: boolean }[] = [];

    /** All args to writeFile() */
    writtenFiles: { path: string; data: string }[] = [];

    /** Control: if set, the next N appendFile calls will reject with this error */
    private _rejectNextN = 0;
    private _rejectError: Error = new Error('fake io error');

    /** Control: if set, next appendFile returns a promise that won't resolve until released */
    private _pending: { resolve: () => void; reject: (e: Error) => void } | null = null;

    /** All chunks passed to appendFileSync() */
    syncChunks: string[] = [];

    // ── Control methods ─────────────────────────────────────────────────

    /** Make the next N appendFile calls reject */
    failNextN(n: number, err?: Error): void {
        this._rejectNextN = n;
        if (err) { this._rejectError = err; }
    }

    /**
     * Pause the next appendFile call. Returns a handle to release it.
     * The promise is only resolved when `releaseHandle.resolve()` is called.
     */
    pauseNext(): { resolve(): void; reject(e: Error): void } {
        const handle = { resolve: () => {}, reject: (_: Error) => {} };
        this._pending = handle;
        return handle;
    }

    // ── RecordingFs interface ────────────────────────────────────────────

    mkdir(_p: string, _opts: { recursive: boolean }): Promise<string | undefined> {
        return Promise.resolve(undefined);
    }

    writeFile(p: string, data: string, _enc: BufferEncoding): Promise<void> {
        this.writtenFiles.push({ path: p, data });
        return Promise.resolve();
    }

    appendFile(_p: string, data: string, _enc: BufferEncoding): Promise<void> {
        if (this._rejectNextN > 0) {
            this._rejectNextN--;
            return Promise.reject(this._rejectError);
        }
        if (this._pending) {
            const pending = this._pending;
            this._pending = null;
            return new Promise<void>((resolve, reject) => {
                pending.resolve = () => { this.appendedChunks.push(data); resolve(); };
                pending.reject = (e) => reject(e);
            });
        }
        this.appendedChunks.push(data);
        return Promise.resolve();
    }

    rm(p: string, opts: { recursive: boolean; force: boolean }): Promise<void> {
        this.removedPaths.push({ path: p, ...opts });
        return Promise.resolve();
    }

    appendFileSync(_p: string, data: string, _enc: BufferEncoding): void {
        this.syncChunks.push(data);
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeEvent(id: number): RecordedEvent {
    return {
        type: 'windowFocus',
        timestamp: id,
        focused: true,
    } satisfies RecordedEvent;
}

/** Collect all JSONL events from the fake FS appendedChunks list */
function collectWrittenEvents(fakeFs: FakeFs): RecordedEvent[] {
    const events: RecordedEvent[] = [];
    for (const chunk of fakeFs.appendedChunks) {
        for (const line of chunk.split('\n').filter(Boolean)) {
            events.push(JSON.parse(line) as RecordedEvent);
        }
    }
    return events;
}

// ── Suite ─────────────────────────────────────────────────────────────────────

suite('RecordingStorageWriter (Block D)', () => {
    let fakeFs: FakeFs;
    let writer: RecordingStorageWriter;

    const BASE_DIR = '/fake/base';
    const SESSION_ID = 'test-session-001';
    const SESSION_DIR = path.join(BASE_DIR, 'recordings', SESSION_ID);

    setup(async () => {
        fakeFs = new FakeFs();
        writer = new RecordingStorageWriter(BASE_DIR, fakeFs, '2.0');
        await writer.initSession(SESSION_ID);
    });

    teardown(async () => {
        // Always stop internal timer. Dispose is idempotent.
        try { await writer.dispose(); } catch { /* ignore */ }
    });

    // ── Test 1: Ordering under 100 parallel appendEvent calls ─────────────────

    suite('Ordering', () => {
        test('100 parallel appendEvent calls produce events in emit-order with no duplicates', async () => {
            // Pause the first appendFile so some events arrive mid-flush.
            // The handle's .resolve() is only wired up AFTER appendFile is called,
            // so we must yield to the event loop before calling handle.resolve().
            const handle = fakeFs.pauseNext();

            // Emit first 20 events to trigger threshold flush
            for (let i = 0; i < 20; i++) {
                writer.appendEvent(makeEvent(i));
            }

            // Yield so the lane's first flush actually calls appendFile (setting up handle.resolve)
            await Promise.resolve();

            // Emit 80 more while first flush is in flight
            for (let i = 20; i < 100; i++) {
                writer.appendEvent(makeEvent(i));
            }

            // Let first flush complete (now handle.resolve is wired up)
            handle.resolve();

            // Drain all pending lane work
            await writer.flush();

            const written = collectWrittenEvents(fakeFs);

            // All 100 events present
            assert.strictEqual(written.length, 100, `Expected 100 events, got ${written.length}`);

            // No duplicates
            const timestamps = written.map(e => e.timestamp);
            const unique = new Set(timestamps);
            assert.strictEqual(unique.size, 100, 'Duplicate events detected');

            // In emit order (timestamps 0..99 ascending)
            for (let i = 0; i < 100; i++) {
                assert.strictEqual(written[i].timestamp, i, `Event at index ${i} out of order`);
            }
        });
    });

    // ── Test 2: Failed write retains all events, ordering preserved on retry ───

    suite('Retry on failure', () => {
        test('failed appendFile retains batch; next flush writes old batch then new events in order', async () => {
            // Add 5 events, then fail the first appendFile
            for (let i = 0; i < 5; i++) {
                writer.appendEvent(makeEvent(i));
            }

            fakeFs.failNextN(1);

            // First flush — resolves (log-and-resolve contract); buffer is NOT cleared
            await writer.flush();

            // No data should have been written (appendFile rejected)
            assert.strictEqual(fakeFs.appendedChunks.length, 0, 'No chunks should be written on failed flush');

            // Add 3 more events after the failed flush
            for (let i = 5; i < 8; i++) {
                writer.appendEvent(makeEvent(i));
            }

            // Second flush — should write all 8 events (5 retained + 3 new)
            await writer.flush();

            const written = collectWrittenEvents(fakeFs);

            // 8 events total (0 on first call due to rejection, 8 on second)
            assert.strictEqual(written.length, 8, `Expected 8 events, got ${written.length}`);

            // Order: 0-7 ascending
            for (let i = 0; i < 8; i++) {
                assert.strictEqual(written[i].timestamp, i, `Event at index ${i} out of order after retry`);
            }
        });
    });

    // ── Test 3: Dispose with idle lane → sync fallback ────────────────────────

    suite('dispose() sync fallback (idle lane)', () => {
        test('5 buffered events on idle lane are written via sync fallback', async () => {
            // Drain any outstanding lane work from initSession
            await writer.flush();

            // Add 5 events (below threshold, no flush triggered)
            for (let i = 100; i < 105; i++) {
                writer.appendEvent(makeEvent(i));
            }

            // Clear prior appendedChunks so we only check what dispose writes
            fakeFs.appendedChunks = [];

            await writer.dispose();

            // Sync fallback should have been called
            assert.strictEqual(fakeFs.syncChunks.length, 1, 'appendFileSync should be called once');
            const syncEvents = fakeFs.syncChunks[0]
                .split('\n')
                .filter(Boolean)
                .map(l => JSON.parse(l) as RecordedEvent);
            assert.strictEqual(syncEvents.length, 5, 'Should have written 5 events via sync');
            assert.strictEqual(syncEvents[0].timestamp, 100);
            assert.strictEqual(syncEvents[4].timestamp, 104);
        });
    });

    // ── Test 4: Dispose with busy lane → async drain, no duplicates ───────────

    suite('dispose() async drain (busy lane)', () => {
        test('active lane work + 5 buffered events: awaits lane then final flush, no duplicates', async () => {
            // Pause the first appendFile to simulate a long-running flush
            const handle = fakeFs.pauseNext();

            // Trigger threshold flush with 20 events
            for (let i = 0; i < 20; i++) {
                writer.appendEvent(makeEvent(i));
            }

            // Yield so the lane's first flush actually calls appendFile (wiring up handle.resolve)
            await Promise.resolve();

            // While first flush is in flight (lane busy), add 5 more events
            for (let i = 20; i < 25; i++) {
                writer.appendEvent(makeEvent(i));
            }

            // Resolve the long write (now handle.resolve is wired up)
            handle.resolve();

            // dispose() should await the drain and then do a final flush
            await writer.dispose();

            // Sync fallback should NOT have been called (lane was busy)
            assert.strictEqual(fakeFs.syncChunks.length, 0, 'appendFileSync should NOT be called when lane is busy');

            // All 25 events must appear exactly once
            const written = collectWrittenEvents(fakeFs);
            assert.strictEqual(written.length, 25, `Expected 25 events, got ${written.length}`);

            const timestamps = written.map(e => e.timestamp);
            const unique = new Set(timestamps);
            assert.strictEqual(unique.size, 25, 'Duplicate events found');

            // First 20 in order, then next 5 in order
            for (let i = 0; i < 25; i++) {
                assert.strictEqual(written[i].timestamp, i, `Event at index ${i} out of order`);
            }
        });
    });

    // ── Test 5: Consecutive-error counter disables writer ────────────────────

    suite('Consecutive-error disable', () => {
        test('5 consecutive errors disable the writer and stop the timer', async () => {
            // Force 5 failures — flush always resolves (log-and-resolve contract)
            fakeFs.failNextN(5);

            for (let run = 0; run < 5; run++) {
                writer.appendEvent(makeEvent(run));
                await writer.flush(); // always resolves, error is logged internally
            }

            // Writer should now be disabled; clear chunks to check no new writes happen
            fakeFs.appendedChunks = [];

            writer.appendEvent(makeEvent(999));
            await writer.flush();

            assert.strictEqual(
                fakeFs.appendedChunks.length, 0,
                'appendFile should not be called after writer is disabled',
            );
        });
    });

    // ── Test 6: Threshold + timer debounce — no runaway queue ────────────────

    suite('Threshold flush debounce', () => {
        test('timer flush and threshold flush during active flush produce at most 3 total flushes', async () => {
            // Pause the first appendFile
            const handle = fakeFs.pauseNext();

            // Trigger first threshold flush (20 events)
            for (let i = 0; i < 20; i++) {
                writer.appendEvent(makeEvent(i));
            }

            // Yield so the lane's first flush calls appendFile (wiring up handle.resolve)
            await Promise.resolve();

            // While first flush is in flight, trigger a second threshold hit
            for (let i = 20; i < 40; i++) {
                writer.appendEvent(makeEvent(i));
            }

            // Also simulate a timer flush (same as manually calling flush)
            const timerFlushPromise = writer.flush();

            // Let first flush complete (now handle.resolve is wired up)
            handle.resolve();

            // Await everything
            await timerFlushPromise;
            await writer.flush(); // final drain

            // Both threshold and timer debounce to a single deferred flush,
            // so appendFile should be called exactly 2 times total:
            // once for the initial 20 events, once for the deferred 20 events.
            assert.strictEqual(
                fakeFs.appendedChunks.length,
                2,
                `Expected exactly 2 appendFile calls, got ${fakeFs.appendedChunks.length}`,
            );

            // All 40 events present, no duplicates
            const written = collectWrittenEvents(fakeFs);
            assert.strictEqual(written.length, 40, `Expected 40 events, got ${written.length}`);
            const unique = new Set(written.map(e => e.timestamp));
            assert.strictEqual(unique.size, 40, 'Duplicate events detected');
        });
    });

    // ── Test 7: abort() removes session directory ─────────────────────────────

    suite('abort()', () => {
        test('abort() removes session directory and stops timer', async () => {
            await writer.abort();

            assert.strictEqual(fakeFs.removedPaths.length, 1, 'fs.rm should be called once');
            assert.strictEqual(fakeFs.removedPaths[0].path, SESSION_DIR, 'Should remove the session directory');
            assert.strictEqual(fakeFs.removedPaths[0].recursive, true);
            assert.strictEqual(fakeFs.removedPaths[0].force, true);
        });

        test('abort() clears the buffer so subsequent flush is a no-op', async () => {
            for (let i = 0; i < 5; i++) {
                writer.appendEvent(makeEvent(i));
            }

            fakeFs.appendedChunks = [];

            await writer.abort();

            // After abort, flushing should be a no-op (no eventsPath)
            await writer.flush();
            assert.strictEqual(fakeFs.appendedChunks.length, 0, 'No appendFile after abort');
        });
    });

    // ── Test 8: Delayed append + new events during delay + retry ordering ─────

    suite('Ordering: delayed append with new events during delay', () => {
        test('old batch written before new events even after a delayed flush', async () => {
            // Emit 3 events
            for (let i = 0; i < 3; i++) {
                writer.appendEvent(makeEvent(i));
            }

            // Pause the flush so new events arrive while it's in flight
            const handle = fakeFs.pauseNext();

            // Start flush (goes into lane) - this enqueues, then yields to let it call appendFile
            const flushPromise = writer.flush();

            // Yield so the lane actually calls appendFile (wiring up handle.resolve)
            await Promise.resolve();

            // New events arrive while flush is in flight
            for (let i = 3; i < 6; i++) {
                writer.appendEvent(makeEvent(i));
            }

            // Complete the delayed flush (now handle.resolve is wired up)
            handle.resolve();
            await flushPromise;

            // Final flush for the new events
            await writer.flush();

            const written = collectWrittenEvents(fakeFs);
            assert.strictEqual(written.length, 6);

            // Events 0-2 first (old batch), then 3-5 (new batch)
            for (let i = 0; i < 6; i++) {
                assert.strictEqual(written[i].timestamp, i, `Event at index ${i} out of order`);
            }
        });
    });

    // ── Test 9: endSession() with in-flight flush ─────────────────────────────

    suite('endSession() with in-flight flush', () => {
        test('endSession waits for in-flight flush and deferred flush to complete', async () => {
            // Step 1: pause the first appendFile so a flush goes in-flight but does not finish.
            const handle = fakeFs.pauseNext();

            // Step 2: append 20 events to trigger a threshold flush.
            for (let i = 0; i < 20; i++) {
                writer.appendEvent(makeEvent(i));
            }

            // Step 3: yield once so the lane starts and calls appendFile (wiring up handle.resolve).
            await Promise.resolve();

            // Step 4: add 5 more events while the first flush is in flight.
            for (let i = 20; i < 25; i++) {
                writer.appendEvent(makeEvent(i));
            }

            // Step 5: call endSession() — must not return until all flushes complete.
            // We start endSession() before resolving the handle; it should block.
            const endSessionPromise = writer.endSession();

            // Step 6: resolve the paused appendFile handle so flush1 can finish.
            handle.resolve();

            // endSession() now drains, enqueues flush2 for the 5 buffered events,
            // and drains again. Await it to confirm everything settled.
            await endSessionPromise;

            // Step 7: assert all 25 events were written in order, no duplicates.
            const written = collectWrittenEvents(fakeFs);

            assert.strictEqual(written.length, 25, `Expected 25 events, got ${written.length}`);

            const timestamps = written.map(e => e.timestamp);
            const unique = new Set(timestamps);
            assert.strictEqual(unique.size, 25, 'Duplicate events detected');

            for (let i = 0; i < 25; i++) {
                assert.strictEqual(written[i].timestamp, i, `Event at index ${i} out of order`);
            }
        });
    });

    // ── Test 10: writeMetadata adds schemaVersion and recorderVersion ─────────

    suite('writeMetadata enrichment', () => {
        test('writes schemaVersion: 2 and recorderVersion: "2.0" into metadata', async () => {
            await writer.writeMetadata({
                sessionId: SESSION_ID,
                exerciseId: 42,
                participantId: undefined,
                startTime: 1000,
                endTime: 2000,
                eventCount: 5,
            });

            // Find the metadata write (not the events.jsonl init write)
            const metadataWrite = fakeFs.writtenFiles.find(
                f => f.path.endsWith('metadata.json'),
            );
            assert.ok(metadataWrite, 'No metadata.json write found');
            const written = JSON.parse(metadataWrite.data) as Record<string, unknown>;
            assert.strictEqual(written['schemaVersion'], 2);
            assert.strictEqual(written['recorderVersion'], '2.0');
        });
    });
});
