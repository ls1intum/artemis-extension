/**
 * Unit tests for test-results and task-feedback view events.
 *
 * Covers:
 *   - recordTestResultsOverviewOpened: opened event with test counts
 *   - recordTestResultsOverviewClosed: closed event with durationMs and closeReason
 *   - recordTaskFeedbackOpened: opened event with taskName and testIds
 *   - recordTaskFeedbackClosed: closed event with durationMs and closeReason
 *   - Phase guard: all four methods no-op outside 'recording' phase
 */

import * as vscode from 'vscode';
import * as assert from 'assert';

import { SessionRecorder } from '@extension/services/telemetry/recording/sessionRecorder';
import type { RecordingFs } from '@extension/services/telemetry/recording/storageWriter';
import { RecordingStorageWriter } from '@extension/services/telemetry/recording/storageWriter';
import type {
    RecordedEvent,
    TaskFeedbackViewEvent,
    TestResultsOverviewViewEvent,
} from '@extension/services/telemetry/recording/types';

// ── Minimal fake FS ───────────────────────────────────────────────────────────

class FakeFs implements RecordingFs {
    appendedChunks: string[] = [];
    writtenFiles: { path: string; data: string }[] = [];
    removedPaths: string[] = [];
    syncChunks: string[] = [];

    mkdir(_p: string, _opts: { recursive: boolean }): Promise<string | undefined> {
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

// ── Helpers ───────────────────────────────────────────────────────────────────

function collectWrittenEvents(fakeFs: FakeFs): RecordedEvent[] {
    const events: RecordedEvent[] = [];
    for (const chunk of [...fakeFs.appendedChunks, ...fakeFs.syncChunks]) {
        for (const line of chunk.split('\n').filter(Boolean)) {
            try {
                events.push(JSON.parse(line) as RecordedEvent);
            } catch {
                /* skip malformed lines */
            }
        }
    }
    return events;
}

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

// ── Suite ─────────────────────────────────────────────────────────────────────

suite('SessionRecorder — view events', () => {
    let recorder: SessionRecorder;
    let fs: FakeFs;

    setup(async () => {
        const ctx = makeRecorder();
        recorder = ctx.recorder;
        fs = ctx.fs;
        recorder.enable();
        await recorder.startSession(42, 'participant-1');
    });

    teardown(async () => {
        try { await recorder.dispose(); } catch { /* ignore */ }
    });

    test('recordTestResultsOverviewOpened emits opened event with counts', async () => {
        recorder.recordTestResultsOverviewOpened({
            viewId: 'v1', exerciseId: 42,
            totalTests: 5, passedTests: 3, failedTests: 2,
        });
        await recorder.endSession();
        const overview = collectWrittenEvents(fs).filter(
            (e): e is TestResultsOverviewViewEvent => e.type === 'testResultsOverviewView',
        );
        assert.strictEqual(overview.length, 1);
        assert.strictEqual(overview[0].action, 'opened');
        assert.strictEqual(overview[0].viewId, 'v1');
        assert.strictEqual(overview[0].action === 'opened' && overview[0].totalTests, 5);
    });

    test('recordTestResultsOverviewClosed emits closed event with durationMs and closeReason', async () => {
        recorder.recordTestResultsOverviewClosed({
            viewId: 'v1', exerciseId: 42,
            durationMs: 1234, closeReason: 'button',
        });
        await recorder.endSession();
        const closed = collectWrittenEvents(fs).filter(
            (e): e is TestResultsOverviewViewEvent => e.type === 'testResultsOverviewView' && e.action === 'closed',
        );
        assert.strictEqual(closed.length, 1);
        assert.strictEqual(closed[0].action === 'closed' && closed[0].durationMs, 1234);
        assert.strictEqual(closed[0].action === 'closed' && closed[0].closeReason, 'button');
    });

    test('recordTaskFeedbackOpened emits with testIds and taskName', async () => {
        recorder.recordTaskFeedbackOpened({
            viewId: 'v2', exerciseId: 42, taskName: 'doOverlap',
            testIds: [101, 102, 103], totalTests: 3, passedTests: 0, failedTests: 3,
        });
        await recorder.endSession();
        const task = collectWrittenEvents(fs).filter(
            (e): e is TaskFeedbackViewEvent => e.type === 'taskFeedbackView',
        );
        assert.strictEqual(task.length, 1);
        assert.strictEqual(task[0].taskName, 'doOverlap');
        assert.deepStrictEqual(task[0].action === 'opened' ? task[0].testIds : undefined, [101, 102, 103]);
    });

    test('recordTaskFeedbackClosed emits with durationMs and closeReason', async () => {
        recorder.recordTaskFeedbackClosed({
            viewId: 'v2', exerciseId: 42, taskName: 'doOverlap',
            durationMs: 750, closeReason: 'escape',
        });
        await recorder.endSession();
        const closed = collectWrittenEvents(fs).filter(
            (e): e is TaskFeedbackViewEvent => e.type === 'taskFeedbackView' && e.action === 'closed',
        );
        assert.strictEqual(closed.length, 1);
        assert.strictEqual(closed[0].action === 'closed' && closed[0].durationMs, 750);
        assert.strictEqual(closed[0].action === 'closed' && closed[0].closeReason, 'escape');
        assert.strictEqual(closed[0].taskName, 'doOverlap');
    });

    test('all four methods are no-ops outside recording phase', async () => {
        const { recorder: idleRecorder, fs: idleFs } = makeRecorder();
        // No enable() / startSession() — phase stays 'idle'
        idleRecorder.recordTestResultsOverviewOpened({ viewId: 'x', exerciseId: 1, totalTests: 0, passedTests: 0, failedTests: 0 });
        idleRecorder.recordTestResultsOverviewClosed({ viewId: 'x', exerciseId: 1, durationMs: 0, closeReason: 'button' });
        idleRecorder.recordTaskFeedbackOpened({ viewId: 'y', exerciseId: 1, taskName: 't', testIds: [], totalTests: 0, passedTests: 0, failedTests: 0 });
        idleRecorder.recordTaskFeedbackClosed({ viewId: 'y', exerciseId: 1, taskName: 't', durationMs: 0, closeReason: 'button' });
        const events = collectWrittenEvents(idleFs).filter(
            e => e.type === 'testResultsOverviewView' || e.type === 'taskFeedbackView',
        );
        assert.strictEqual(events.length, 0);
    });
});
