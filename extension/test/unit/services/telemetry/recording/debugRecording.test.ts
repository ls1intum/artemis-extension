/**
 * Unit tests for debugger recording: pure collectors + white-box gating.
 *
 * The extension-host test environment cannot fire read-only `Event<T>` objects
 * (e.g. `vscode.debug.onDidChangeBreakpoints`), so the four listeners in
 * ObservationRegistry are not exercised directly. We unit-test the pure
 * collectors with real `vscode.SourceBreakpoint` objects, and verify the
 * phase/generation gating of the new event types via the same white-box
 * `injectEvent` approach used by workspaceEvents.test.ts.
 */

import * as vscode from 'vscode';
import * as assert from 'assert';

import {
    collectBreakpointChange,
    collectDebugSession,
    collectInitialBreakpointSnapshot,
    filterRecordableSourceBreakpoints,
} from '@extension/services/telemetry/recording/eventCollectors';
import { SessionRecorder } from '@extension/services/telemetry/recording/sessionRecorder';
import type { RecordingFs } from '@extension/services/telemetry/recording/storageWriter';
import { RecordingStorageWriter } from '@extension/services/telemetry/recording/storageWriter';
import type { RecordedEvent } from '@extension/services/telemetry/recording/types';

const ROOT_URI = vscode.Uri.file('/workspace/exercise1');
const ROOT = ROOT_URI.toString();

function sourceBp(
    file: string,
    line: number,
    opts: { enabled?: boolean; condition?: string; hitCondition?: string; logMessage?: string; char?: number } = {},
): vscode.SourceBreakpoint {
    return new vscode.SourceBreakpoint(
        new vscode.Location(vscode.Uri.file(file), new vscode.Position(line, opts.char ?? 0)),
        opts.enabled ?? true,
        opts.condition,
        opts.hitCondition,
        opts.logMessage,
    );
}

suite('Debugger recording — pure collectors', () => {
    // T3: debugSession collector copies session fields for started/terminated.
    test('T3. collectDebugSession copies sessionId/name/type/parentSession', () => {
        // Partial fake: collectDebugSession only reads id/name/type/parentSession,
        // so a minimal cast is sufficient (this tests extraction, not the API contract).
        const session = {
            id: 's1', name: 'Launch', type: 'java',
            parentSession: { id: 'p0' },
        } as unknown as vscode.DebugSession;

        const event = collectDebugSession('started', session);

        assert.strictEqual(event.type, 'debugSession');
        assert.strictEqual(event.action, 'started');
        assert.strictEqual(event.sessionId, 's1');
        assert.strictEqual(event.sessionName, 'Launch');
        assert.strictEqual(event.sessionType, 'java');
        assert.strictEqual(event.parentSessionId, 'p0');
    });

    // T4: activeChanged with no session leaves all session fields undefined.
    test('T4. collectDebugSession(activeChanged, undefined) omits session fields', () => {
        const event = collectDebugSession('activeChanged', undefined);

        assert.strictEqual(event.action, 'activeChanged');
        assert.strictEqual(event.sessionId, undefined);
        assert.strictEqual(event.sessionName, undefined);
        assert.strictEqual(event.sessionType, undefined);
        assert.strictEqual(event.parentSessionId, undefined);
    });

    // T6: collector maps fields, keeps 0-based line/column, copies inherited props.
    test('T6. collectBreakpointChange maps fields with 0-based line/column', () => {
        const bp = sourceBp('/workspace/exercise1/src/Main.java', 9, {
            char: 4, condition: 'x > 0', logMessage: 'hit',
        });
        const event = collectBreakpointChange('added', [bp]);

        assert.strictEqual(event.type, 'breakpointChange');
        assert.strictEqual(event.action, 'added');
        assert.strictEqual(event.breakpoints.length, 1);
        const out = event.breakpoints[0];
        assert.strictEqual(out.id, bp.id);
        assert.strictEqual(out.uri, vscode.Uri.file('/workspace/exercise1/src/Main.java').toString());
        assert.strictEqual(out.line, 9);
        assert.strictEqual(out.column, 4);
        assert.strictEqual(out.enabled, true);
        assert.strictEqual(out.condition, 'x > 0');
        assert.strictEqual(out.logMessage, 'hit');
    });

    // T7: filter keeps in-root source breakpoints, drops function + out-of-root.
    test('T7. filterRecordableSourceBreakpoints keeps in-root source breakpoints only', () => {
        const inRoot = sourceBp('/workspace/exercise1/src/Main.java', 1);
        const outOfRoot = sourceBp('/workspace/other/Lib.java', 1);
        const fn = new vscode.FunctionBreakpoint('main');

        const kept = filterRecordableSourceBreakpoints([inRoot, outOfRoot, fn], ROOT_URI);

        assert.strictEqual(kept.length, 1);
        assert.strictEqual(kept[0], inRoot);
    });

    // T8: snapshot emits in-root breakpoints with given timestamp, null when none.
    test('T8. collectInitialBreakpointSnapshot returns event with timestamp, or null', () => {
        const inRoot = sourceBp('/workspace/exercise1/src/Main.java', 2);
        const outOfRoot = sourceBp('/workspace/other/Lib.java', 2);

        const snap = collectInitialBreakpointSnapshot([inRoot, outOfRoot], ROOT_URI, 12345);
        assert.ok(snap);
        assert.strictEqual(snap.action, 'added');
        assert.strictEqual(snap.timestamp, 12345);
        assert.strictEqual(snap.breakpoints.length, 1);
        assert.strictEqual(snap.breakpoints[0].id, inRoot.id);

        const none = collectInitialBreakpointSnapshot([outOfRoot], ROOT_URI, 12345);
        assert.strictEqual(none, null);
    });

    // T9: a bulk array maps to ONE event with one entry per breakpoint.
    test('T9. collectBreakpointChange maps a multi-breakpoint array to one event', () => {
        const bps = [
            sourceBp('/workspace/exercise1/src/A.java', 1),
            sourceBp('/workspace/exercise1/src/B.java', 2),
            sourceBp('/workspace/exercise1/src/C.java', 3),
        ];

        const event = collectBreakpointChange('changed', bps);

        assert.strictEqual(event.action, 'changed');
        assert.strictEqual(event.breakpoints.length, 3);
    });
});

// ── White-box harness (mirrors workspaceEvents.test.ts) ───────────────

class FakeFs implements RecordingFs {
    appendedChunks: string[] = [];
    writtenFiles: { path: string; data: string }[] = [];
    removedPaths: string[] = [];
    syncChunks: string[] = [];
    mkdirCalls = 0;
    mkdir(_p: string, _opts: { recursive: boolean }): Promise<string | undefined> { this.mkdirCalls++; return Promise.resolve(undefined); }
    writeFile(p: string, data: string, _enc: BufferEncoding): Promise<void> { this.writtenFiles.push({ path: p, data }); return Promise.resolve(); }
    appendFile(_p: string, data: string, _enc: BufferEncoding): Promise<void> { this.appendedChunks.push(data); return Promise.resolve(); }
    rm(p: string, _opts: { recursive: boolean; force: boolean }): Promise<void> { this.removedPaths.push(p); return Promise.resolve(); }
    appendFileSync(_p: string, data: string, _enc: BufferEncoding): void { this.syncChunks.push(data); }
}

function collectWrittenEvents(fakeFs: FakeFs): RecordedEvent[] {
    const events: RecordedEvent[] = [];
    for (const chunk of [...fakeFs.appendedChunks, ...fakeFs.syncChunks]) {
        for (const line of chunk.split('\n').filter(Boolean)) {
            try { events.push(JSON.parse(line) as RecordedEvent); } catch { /* skip malformed */ }
        }
    }
    return events;
}

function makeRecorder(): { recorder: SessionRecorder; fs: FakeFs } {
    const fakeFs = new FakeFs();
    const writer = new RecordingStorageWriter('/fake-base', fakeFs, 'test-version');
    const recorder = new SessionRecorder(
        vscode.Uri.file('/fake-base'),
        { hasTerminalShellExecution: false, hasVscodeGitExtension: false },
        undefined,
        writer,
    );
    return { recorder, fs: fakeFs };
}

function injectEvent(recorder: SessionRecorder, event: RecordedEvent): void {
    const internal = recorder as unknown as {
        _lifecycle: { recordInternal(e: RecordedEvent, opts: object, gen: number): void };
        _currentGeneration: number;
    };
    internal._lifecycle.recordInternal(event, {}, internal._currentGeneration);
}

const DEBUG_SESSION_STARTED: RecordedEvent = {
    type: 'debugSession', timestamp: 1, action: 'started',
    sessionId: 's1', sessionName: 'Launch', sessionType: 'java',
};
const BREAKPOINT_ADDED: RecordedEvent = {
    type: 'breakpointChange', timestamp: 1, action: 'added',
    breakpoints: [{ id: 'b1', uri: vscode.Uri.file('/workspace/exercise1/src/Main.java').toString(), line: 9, column: 4, enabled: true }],
};

suite('Debugger recording — phase gating (white-box)', () => {
    let recorder: SessionRecorder;
    let fakeFs: FakeFs;

    setup(() => {
        const ctx = makeRecorder();
        recorder = ctx.recorder;
        fakeFs = ctx.fs;
    });

    teardown(async () => {
        try { await recorder.shutdown(); } catch { /* ignore */ }
    });

    // T5: events recorded while recording carry their structure into the stream.
    test('T5. debugSession + breakpointChange land in the stream while recording', async () => {
        recorder.enable();
        await recorder.startSession(1, 'p1', ROOT);

        injectEvent(recorder, DEBUG_SESSION_STARTED);
        injectEvent(recorder, BREAKPOINT_ADDED);

        await recorder.endSession(); // flush the buffered writer to fakeFs

        const events = collectWrittenEvents(fakeFs);
        const session = events.find(e => e.type === 'debugSession');
        const bp = events.find(e => e.type === 'breakpointChange');
        assert.ok(session && session.type === 'debugSession' && session.sessionId === 's1');
        assert.ok(bp && bp.type === 'breakpointChange' && bp.breakpoints[0].line === 9);
    });

    // T2: an event recorded with a stale generation token is dropped.
    test('T2. stale-generation event is dropped', async () => {
        recorder.enable();
        await recorder.startSession(1, 'p1', ROOT);

        const internal = recorder as unknown as {
            _lifecycle: { recordInternal(e: RecordedEvent, opts: object, gen: number): void };
            _currentGeneration: number;
        };
        const staleGen = internal._currentGeneration - 1;
        internal._lifecycle.recordInternal(DEBUG_SESSION_STARTED, {}, staleGen);

        const events = collectWrittenEvents(fakeFs);
        assert.strictEqual(events.filter(e => e.type === 'debugSession').length, 0);
    });

    // T1: idle phase (before startSession) drops the events.
    test('T1. events injected before startSession are dropped', () => {
        recorder.enable();
        injectEvent(recorder, DEBUG_SESSION_STARTED);
        injectEvent(recorder, BREAKPOINT_ADDED);

        const events = collectWrittenEvents(fakeFs);
        assert.strictEqual(events.filter(e => e.type === 'debugSession' || e.type === 'breakpointChange').length, 0);
    });

    // T1 (cont.): after disable, events are dropped.
    test('T1. events injected after disable are dropped', async () => {
        recorder.enable();
        await recorder.startSession(1, 'p1', ROOT);
        recorder.disable();

        injectEvent(recorder, DEBUG_SESSION_STARTED);
        injectEvent(recorder, BREAKPOINT_ADDED);

        const events = collectWrittenEvents(fakeFs);
        const afterDisable = events.filter(e => e.type === 'debugSession' && e.action === 'started');
        assert.strictEqual(afterDisable.length, 0);
    });
});
