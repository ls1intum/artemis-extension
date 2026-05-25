/**
 * Characterization tests for the terminal-shell-execution capture path
 * inside ObservationRegistry / SessionRecorder.
 *
 * These tests pin the pre-extraction behavior so that the Stage 2
 * TerminalCollector extraction can be verified as behavior-preserving.
 * They are whitebox: they seed internal state directly and call private
 * helpers via unsafe casts.
 *
 * The two whitebox helper functions at the top are the SINGLE point that
 * will change after Stage 2's refactor: their bodies will be updated to
 * reach through _terminalCollector instead of directly into _observation.
 * The 5 test cases themselves remain byte-identical.
 */

import * as vscode from 'vscode';
import * as assert from 'assert';

import { SessionRecorder } from '@extension/services/telemetry/recording/sessionRecorder';
import type { RecordingFs } from '@extension/services/telemetry/recording/storageWriter';
import { RecordingStorageWriter } from '@extension/services/telemetry/recording/storageWriter';
import type { RecordedEvent } from '@extension/services/telemetry/recording/types';

// ── Whitebox helpers (bodies change after Stage 2 extraction) ──────────────

function pendingExecutions(
    recorder: SessionRecorder,
): Map<vscode.TerminalShellExecution, any> {
    return (recorder as unknown as {
        _observation: { _terminalCollector: { _pendingExecutions: Map<vscode.TerminalShellExecution, any> } };
    })._observation._terminalCollector._pendingExecutions;
}

function emitTerminalCommand(recorder: SessionRecorder, entry: any): void {
    (recorder as unknown as {
        _observation: { _terminalCollector: { _emitTerminalCommand: (e: any) => void } };
    })._observation._terminalCollector._emitTerminalCommand(entry);
}

// ── Fake FS ────────────────────────────────────────────────────────────────

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

// ── Helpers ────────────────────────────────────────────────────────────────

function collectWrittenEvents(fakeFs: FakeFs): RecordedEvent[] {
    const events: RecordedEvent[] = [];
    for (const chunk of fakeFs.appendedChunks) {
        for (const line of chunk.split('\n').filter(Boolean)) {
            try { events.push(JSON.parse(line) as RecordedEvent); } catch { /* skip */ }
        }
    }
    for (const chunk of fakeFs.syncChunks) {
        for (const line of chunk.split('\n').filter(Boolean)) {
            try { events.push(JSON.parse(line) as RecordedEvent); } catch { /* skip */ }
        }
    }
    return events;
}

/**
 * Create a SessionRecorder with hasTerminalShellExecution: true so the
 * terminal listeners actually subscribe (unlike the default test factory
 * in sessionRecorder.test.ts which sets it to false).
 */
function makeRecorder(): { recorder: SessionRecorder; fs: FakeFs } {
    const fs = new FakeFs();
    const writer = new RecordingStorageWriter('/fake-base', fs, 'test-version');
    const fakeUri = vscode.Uri.file('/fake-base');
    const recorder = new SessionRecorder(
        fakeUri,
        { hasTerminalShellExecution: true, hasVscodeGitExtension: false },
        undefined,
        writer,
    );
    return { recorder, fs };
}

/** Build a minimal PendingExecution entry with sensible defaults. */
function makeEntry(overrides: Partial<{
    output: string;
    startTime: number;
    truncated: boolean;
    readerDone: boolean;
    endInfo: { exitCode: number | undefined; terminalName: string; command: string; cwd: string | undefined } | undefined;
    aborted: boolean;
    generation: number;
}> = {}): any {
    return {
        output: '',
        startTime: Date.now() - 1000,
        truncated: false,
        readerDone: false,
        endInfo: undefined,
        aborted: false,
        generation: 0,
        ...overrides,
    };
}

// ── Suite ──────────────────────────────────────────────────────────────────

suite('TerminalCollector characterization tests', () => {
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

    // ── Test 1: abortAllPending via disable() ─────────────────────────────

    test('disable() aborts all pending executions and clears the map without emitting terminalCommand', async () => {
        recorder.enable();
        await recorder.startSession(1);

        const fakeExecA = {} as vscode.TerminalShellExecution;
        const fakeExecB = {} as vscode.TerminalShellExecution;

        const entryA = makeEntry({ generation: 1 });
        const entryB = makeEntry({ generation: 1 });

        pendingExecutions(recorder).set(fakeExecA, entryA);
        pendingExecutions(recorder).set(fakeExecB, entryB);

        recorder.disable();
        await new Promise(resolve => setTimeout(resolve, 30));

        // Both entries must have aborted set to true (still reachable via our
        // references even though the map was cleared).
        assert.strictEqual(entryA.aborted, true, 'entryA must be aborted');
        assert.strictEqual(entryB.aborted, true, 'entryB must be aborted');

        // The map must be empty after disable.
        assert.strictEqual(pendingExecutions(recorder).size, 0,
            '_pendingExecutions must be cleared after disable()');

        // No terminalCommand event must appear in the JSONL stream.
        const events = collectWrittenEvents(fs);
        const termEvents = events.filter(e => e.type === 'terminalCommand');
        assert.strictEqual(termEvents.length, 0,
            'disable() must not emit any terminalCommand events');
    });

    // ── Test 2: abortAllPending via endSession() ──────────────────────────

    test('endSession() aborts all pending executions and clears the map without emitting terminalCommand', async () => {
        recorder.enable();
        await recorder.startSession(1);

        const fakeExec = {} as vscode.TerminalShellExecution;
        const entry = makeEntry({ generation: 1 });

        pendingExecutions(recorder).set(fakeExec, entry);

        await recorder.endSession();

        // Entry must be aborted (still reachable via our reference).
        assert.strictEqual(entry.aborted, true, 'entry must be aborted after endSession()');

        // The map must be empty.
        assert.strictEqual(pendingExecutions(recorder).size, 0,
            '_pendingExecutions must be cleared after endSession()');

        // No terminalCommand event in JSONL.
        const events = collectWrittenEvents(fs);
        const termEvents = events.filter(e => e.type === 'terminalCommand');
        assert.strictEqual(termEvents.length, 0,
            'endSession() without completed executions must not emit terminalCommand events');
    });

    // ── Test 3: _emitTerminalCommand happy path ───────────────────────────

    test('_emitTerminalCommand emits a correct terminalCommand event when all conditions are met', async () => {
        recorder.enable();
        await recorder.startSession(1);

        // Capture the live generation before seeding the entry so it matches.
        const liveGeneration: number = (recorder as unknown as { _currentGeneration: number })._currentGeneration;

        const entry = makeEntry({
            output: 'Hello world\n',
            startTime: Date.now() - 500,
            truncated: false,
            readerDone: true,
            generation: liveGeneration,
            endInfo: {
                exitCode: 0,
                terminalName: 'bash',
                command: 'echo Hello world',
                cwd: '/home/student',
            },
        });

        emitTerminalCommand(recorder, entry);

        // End the session to drain the storage writer buffer before asserting.
        await recorder.endSession();

        const events = collectWrittenEvents(fs);
        const termEvents = events.filter(e => e.type === 'terminalCommand') as Array<{
            type: string;
            timestamp: number;
            command: string;
            exitCode: number | undefined;
            output: string;
            outputTruncated: boolean;
            cwd: string | undefined;
            terminalName: string;
            durationMs: number;
        }>;

        assert.strictEqual(termEvents.length, 1, 'exactly one terminalCommand event must be emitted');
        const ev = termEvents[0]!;
        assert.strictEqual(ev.command, 'echo Hello world', 'command field');
        assert.strictEqual(ev.exitCode, 0, 'exitCode field');
        assert.strictEqual(ev.output, 'Hello world\n', 'output field');
        assert.strictEqual(ev.outputTruncated, false, 'outputTruncated field');
        assert.strictEqual(ev.cwd, '/home/student', 'cwd field');
        assert.strictEqual(ev.terminalName, 'bash', 'terminalName field');
        assert.ok(typeof ev.durationMs === 'number' && ev.durationMs >= 0, 'durationMs must be a non-negative number');
        assert.ok(typeof ev.timestamp === 'number' && ev.timestamp > 0, 'timestamp must be a positive number');
    });

    // ── Test 4: _emitTerminalCommand phase guard ──────────────────────────

    test('_emitTerminalCommand does NOT emit when the recorder is not in recording phase', async () => {
        recorder.enable();
        await recorder.startSession(1);

        const liveGeneration: number = (recorder as unknown as { _currentGeneration: number })._currentGeneration;

        const entry = makeEntry({
            output: 'output',
            readerDone: true,
            generation: liveGeneration,
            endInfo: {
                exitCode: 1,
                terminalName: 'zsh',
                command: 'failing-cmd',
                cwd: undefined,
            },
        });

        // End the session: phase transitions out of 'recording'.
        await recorder.endSession();

        // Capture the event count before attempting the emission.
        const countBefore = collectWrittenEvents(fs).length;

        emitTerminalCommand(recorder, entry);

        await new Promise(resolve => setTimeout(resolve, 10));

        const countAfter = collectWrittenEvents(fs).length;

        assert.strictEqual(countAfter, countBefore,
            '_emitTerminalCommand must not write any event when phase != recording');

        const termEvents = collectWrittenEvents(fs).filter(e => e.type === 'terminalCommand');
        assert.strictEqual(termEvents.length, 0, 'no terminalCommand event must be emitted after session ends');
    });

    // ── Test 5: _emitTerminalCommand generation gate via stale generation ─

    test('stale-generation entry does not emit terminalCommand into a newer session', async () => {
        recorder.enable();

        // Start first session and capture its generation.
        await recorder.startSession(10);
        const gen1: number = (recorder as unknown as { _currentGeneration: number })._currentGeneration;

        // End the first session and begin a second one.
        await recorder.endSession();
        await recorder.startSession(11);

        // Build an entry stamped with the stale first-session generation.
        const staleEntry = makeEntry({
            output: 'stale output',
            readerDone: true,
            generation: gen1,
            endInfo: {
                exitCode: 0,
                terminalName: 'fish',
                command: 'stale-cmd',
                cwd: '/tmp',
            },
        });

        emitTerminalCommand(recorder, staleEntry);

        await new Promise(resolve => setTimeout(resolve, 10));

        // Only look at events written during the second session. We check that
        // no terminalCommand with command='stale-cmd' appears.
        const events = collectWrittenEvents(fs);
        const staleTermEvents = events.filter(e =>
            e.type === 'terminalCommand' &&
            (e as { command?: string }).command === 'stale-cmd',
        );
        assert.strictEqual(staleTermEvents.length, 0,
            'a stale-generation entry must not produce a terminalCommand event in the current session');

        await recorder.endSession();
    });

    // ── Test 6: full integration via captured listeners + fake execution.read()

    test('full lifecycle: shellExecStart, async read, shellExecEnd emits terminalCommand with captured output, end fields, and start-time generation', async () => {
        // Monkey-patch vscode.window so we can capture the listener bodies that
        // TerminalCollector.register() registers, then trigger them by hand.
        // This exercises the registration path, the async read consumer, the
        // end-listener emission gate, and the generation flow end-to-end. The
        // earlier whitebox tests cover the abort and emission predicates;
        // this test covers the path that actually wires the recorder up to
        // VS Code's terminal events.
        let startListener: ((event: { execution: vscode.TerminalShellExecution }) => void) | undefined;
        let endListener: ((event: {
            execution: vscode.TerminalShellExecution;
            exitCode: number | undefined;
            terminal: vscode.Terminal;
        }) => void) | undefined;

        const originalOnDidStart = vscode.window.onDidStartTerminalShellExecution;
        const originalOnDidEnd = vscode.window.onDidEndTerminalShellExecution;

        (vscode.window as unknown as {
            onDidStartTerminalShellExecution: (listener: typeof startListener) => vscode.Disposable;
        }).onDidStartTerminalShellExecution = (listener) => {
            startListener = listener;
            return { dispose: () => { startListener = undefined; } };
        };
        (vscode.window as unknown as {
            onDidEndTerminalShellExecution: (listener: typeof endListener) => vscode.Disposable;
        }).onDidEndTerminalShellExecution = (listener) => {
            endListener = listener;
            return { dispose: () => { endListener = undefined; } };
        };

        try {
            recorder.enable();
            await recorder.startSession(42);

            const startGen = (recorder as unknown as { _currentGeneration: number })._currentGeneration;

            assert.ok(startListener, 'shellExecStart listener must be registered after enable()');
            assert.ok(endListener, 'shellExecEnd listener must be registered after enable()');

            // Fake execution that yields two output chunks then completes.
            const fakeExecution = {
                commandLine: { value: 'npm test', confidence: 2, isTrusted: true },
                cwd: vscode.Uri.file('/tmp/proj'),
                read: async function* () {
                    yield 'first chunk\n';
                    yield 'second chunk\n';
                },
            } as unknown as vscode.TerminalShellExecution;

            const fakeTerminal = { name: 'zsh' } as vscode.Terminal;

            startListener!({ execution: fakeExecution });

            const pending = pendingExecutions(recorder);
            assert.strictEqual(pending.size, 1, 'exactly one pending execution after shellExecStart');
            const entry = pending.get(fakeExecution);
            assert.ok(entry, 'pending execution entry must be present');
            assert.strictEqual(entry.generation, startGen, 'entry generation captured at start time matches the current session');
            assert.strictEqual(entry.aborted, false, 'fresh entry must not be aborted');

            // Drain microtasks so the async generator iterator runs to completion.
            for (let i = 0; i < 20; i++) { await Promise.resolve(); }

            assert.strictEqual(entry.readerDone, true, 'reader must complete after the iterator drains');
            assert.strictEqual(entry.output, 'first chunk\nsecond chunk\n', 'output must accumulate both chunks in order');
            assert.strictEqual(entry.truncated, false, 'short output must not be truncated');

            // No terminalCommand event yet because endInfo is still unset.
            const termBeforeEnd = collectWrittenEvents(fs).filter(e => e.type === 'terminalCommand');
            assert.strictEqual(termBeforeEnd.length, 0, 'no terminalCommand before shellExecEnd fires');

            endListener!({
                execution: fakeExecution,
                exitCode: 0,
                terminal: fakeTerminal,
            });

            assert.strictEqual(pending.has(fakeExecution), false, 'execution must be removed from pending map after end');

            await recorder.endSession();

            const termEvents = collectWrittenEvents(fs).filter(e => e.type === 'terminalCommand') as Array<{
                type: 'terminalCommand';
                command: string;
                exitCode: number | undefined;
                output: string;
                outputTruncated: boolean;
                cwd: string | undefined;
                terminalName: string;
                durationMs: number;
                timestamp: number;
            }>;
            assert.strictEqual(termEvents.length, 1, 'exactly one terminalCommand event must be emitted');
            const tc = termEvents[0];
            assert.strictEqual(tc.command, 'npm test', 'command preserved');
            assert.strictEqual(tc.exitCode, 0, 'exitCode preserved');
            assert.strictEqual(tc.output, 'first chunk\nsecond chunk\n', 'output preserved');
            assert.strictEqual(tc.outputTruncated, false);
            assert.strictEqual(tc.terminalName, 'zsh');
            assert.strictEqual(tc.cwd, vscode.Uri.file('/tmp/proj').toString(), 'cwd preserved as the fake URI');
            assert.ok(tc.durationMs >= 0, 'durationMs must be non-negative');
        } finally {
            // Restore the real vscode.window APIs so other tests in the run
            // are not affected by the monkey-patch.
            (vscode.window as unknown as {
                onDidStartTerminalShellExecution: typeof originalOnDidStart;
            }).onDidStartTerminalShellExecution = originalOnDidStart;
            (vscode.window as unknown as {
                onDidEndTerminalShellExecution: typeof originalOnDidEnd;
            }).onDidEndTerminalShellExecution = originalOnDidEnd;
        }
    });
});
