import * as vscode from 'vscode';
import * as assert from 'assert';

import { SessionRecorder } from '@extension/services/recording/sessionRecorder';
import type { RecordingFs } from '@extension/services/recording/storageWriter';
import { RecordingStorageWriter } from '@extension/services/recording/storageWriter';
import type { RecordedEvent } from '@extension/services/recording/types';
import type { SelectionSignal } from '@extension/services/sensing/types';
import { TestSensorHub } from '@test/__shared__/testSensorHub';

class MemFs implements RecordingFs {
    appendedChunks: string[] = [];
    syncChunks: string[] = [];
    mkdir(): Promise<string | undefined> { return Promise.resolve(undefined); }
    writeFile(): Promise<void> { return Promise.resolve(); }
    appendFile(_p: string, data: string, _enc: BufferEncoding): Promise<void> { this.appendedChunks.push(data); return Promise.resolve(); }
    rm(): Promise<void> { return Promise.resolve(); }
    appendFileSync(_p: string, data: string, _enc: BufferEncoding): void { this.syncChunks.push(data); }
}

function writtenEvents(fs: MemFs): RecordedEvent[] {
    return [...fs.appendedChunks, ...fs.syncChunks]
        .flatMap(chunk => chunk.split('\n').filter(Boolean))
        .map(line => JSON.parse(line) as RecordedEvent);
}

function selectionSignal(path: string): SelectionSignal {
    const uri = vscode.Uri.file(path);
    const editor = {
        document: { uri },
        selections: [new vscode.Selection(0, 0, 0, 1)],
    } as unknown as vscode.TextEditor;
    return {
        ts: Date.now(),
        event: {
            textEditor: editor,
            kind: vscode.TextEditorSelectionChangeKind.Keyboard,
            selections: editor.selections,
        } as vscode.TextEditorSelectionChangeEvent,
    };
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function makeRecorder(): { recorder: SessionRecorder; fs: MemFs; hub: TestSensorHub } {
    const fs = new MemFs();
    const writer = new RecordingStorageWriter('/fake-base', fs, 'test-version');
    const hub = new TestSensorHub();
    const recorder = new SessionRecorder(
        vscode.Uri.file('/fake-base'),
        { hasTerminalShellExecution: false, hasVscodeGitExtension: false },
        undefined,
        writer,
        hub,
    );
    return { recorder, fs, hub };
}

suite('Observation lifecycle via SensorHub (PR1 tier-b equivalence)', () => {
    test('selection bursts within the debounce window record exactly one event', async () => {
        const { recorder, fs, hub } = makeRecorder();
        recorder.enable();
        await recorder.startSession(1);

        hub.emit.selection.fire(selectionSignal('/w/F.java'));
        await sleep(50);
        hub.emit.selection.fire(selectionSignal('/w/F.java'));
        await sleep(300); // > 200ms debounce
        await recorder.endSession();

        const selections = writtenEvents(fs).filter(e => e.type === 'selectionChange');
        assert.strictEqual(selections.length, 1);
        await recorder.shutdown();
    });

    test('consent downgrade discards buffered debounce payloads', async () => {
        const { recorder, fs, hub } = makeRecorder();
        recorder.enable();
        await recorder.startSession(1);

        hub.emit.selection.fire(selectionSignal('/w/F.java'));
        recorder.disable(); // GDPR path: pending payload must never hit disk
        await sleep(300);
        await recorder.shutdown();

        const selections = writtenEvents(fs).filter(e => e.type === 'selectionChange');
        assert.strictEqual(selections.length, 0);
    });

    test('session end flushes the pending payload into the ending session', async () => {
        const { recorder, fs, hub } = makeRecorder();
        recorder.enable();
        await recorder.startSession(1);

        hub.emit.selection.fire(selectionSignal('/w/F.java'));
        await recorder.endSession(); // flushDebouncesForEnd, no 200ms wait

        const events = writtenEvents(fs);
        const selIdx = events.findIndex(e => e.type === 'selectionChange');
        const endIdx = events.findIndex(e => e.type === 'sessionEnd');
        assert.ok(selIdx !== -1, 'flushed selection must be recorded');
        assert.ok(endIdx > selIdx, 'sessionEnd must come after the flushed payload');
        await recorder.shutdown();
    });

    // Note on mechanism: the no-leak property here is enforced by
    // flushDebouncesForEnd() cancelling all pending debounce timers at
    // session end. The generation token (capturedGen in the registry's
    // debounce callbacks) is defense-in-depth for asynchronous producers
    // (snapshots, terminal output readers) and is not reachable through
    // the synchronous selection path this test drives.
    test('debounce payload from session A is flushed into A and never appears in session B', async () => {
        const { recorder, fs, hub } = makeRecorder();
        recorder.enable();
        await recorder.startSession(1);
        hub.emit.selection.fire(selectionSignal('/w/F.java'));
        await recorder.endSession();   // flushes into session A
        await recorder.startSession(2);
        await sleep(300);              // stale timer (if any) would fire here
        await recorder.endSession();
        await recorder.shutdown();

        const events = writtenEvents(fs);
        const secondStart = events.findIndex(
            e => e.type === 'sessionStart' && (e as { exerciseId?: number }).exerciseId === 2,
        );
        const beforeSecondStart = events.slice(0, secondStart).filter(e => e.type === 'selectionChange');
        assert.strictEqual(beforeSecondStart.length, 1, 'flushed payload must land in session A');
        const leaked = events.slice(secondStart).filter(e => e.type === 'selectionChange');
        assert.strictEqual(leaked.length, 0);
    });
});
