// extension/test/unit/services/sensing/sensorHub.test.ts
import * as vscode from 'vscode';
import * as assert from 'assert';
import * as sinon from 'sinon';

import { DiagnosticsSettleCollector } from '@extension/services/sensing/collectors/diagnosticsSettle';
import { VsCodeSensorHub } from '@extension/services/sensing/sensorHub';
import type { DiagnosticsSettledSignal, TextChangeSignal } from '@extension/services/sensing/types';

suite('VsCodeSensorHub', () => {
    test('relays text changes with an arrival timestamp', async () => {
        const hub = new VsCodeSensorHub();

        // Subscribe AFTER openTextDocument: VS Code fires onDidChangeTextDocument for the
        // initial content fill, which would cause the listener to see 2 events instead of 1.
        const doc = await vscode.workspace.openTextDocument({ content: 'abc', language: 'plaintext' });
        const received: TextChangeSignal[] = [];
        const sub = hub.onDidChangeTextDocument(signal => received.push(signal));
        const edit = new vscode.WorkspaceEdit();
        edit.insert(doc.uri, new vscode.Position(0, 0), 'x');
        const before = Date.now();
        await vscode.workspace.applyEdit(edit);
        // onDidChangeTextDocument fires synchronously during applyEdit.
        assert.strictEqual(received.length, 1);
        assert.strictEqual(received[0].event.document.uri.toString(), doc.uri.toString());
        assert.ok(received[0].ts >= before && received[0].ts <= Date.now());

        sub.dispose();
        hub.dispose();
    });

    test('dispose() stops relaying', async () => {
        const hub = new VsCodeSensorHub();
        let count = 0;
        hub.onDidChangeTextDocument(() => count++);
        hub.dispose();

        const doc = await vscode.workspace.openTextDocument({ content: 'abc' });
        const edit = new vscode.WorkspaceEdit();
        edit.insert(doc.uri, new vscode.Position(0, 0), 'y');
        await vscode.workspace.applyEdit(edit);
        assert.strictEqual(count, 0);
    });

    test('underlying VS Code subscription attaches lazily and detaches with the last listener', () => {
        const original = vscode.window.onDidOpenTerminal;
        let active = 0;
        (vscode.window as { onDidOpenTerminal: typeof vscode.window.onDidOpenTerminal }).onDidOpenTerminal =
            ((_listener: (t: vscode.Terminal) => void) => {
                active++;
                return new vscode.Disposable(() => { active--; });
            }) as typeof vscode.window.onDidOpenTerminal;
        try {
            const hub = new VsCodeSensorHub();
            assert.strictEqual(active, 0, 'no listener before a consumer attaches');
            const s1 = hub.onDidOpenTerminal(() => { /* consumer 1 */ });
            const s2 = hub.onDidOpenTerminal(() => { /* consumer 2 */ });
            assert.strictEqual(active, 1, 'one shared listener for many consumers');
            s1.dispose();
            assert.strictEqual(active, 1, 'listener stays while a consumer remains');
            s2.dispose();
            assert.strictEqual(active, 0, 'last consumer detaches the listener');
            hub.dispose();
        } finally {
            (vscode.window as { onDidOpenTerminal: typeof vscode.window.onDidOpenTerminal }).onDidOpenTerminal = original;
        }
    });

    test('fan-out isolates listener errors and supports duplicate listeners', () => {
        const original = vscode.window.onDidOpenTerminal;
        let handler: ((t: vscode.Terminal) => void) | undefined;
        let active = 0;
        (vscode.window as { onDidOpenTerminal: typeof vscode.window.onDidOpenTerminal }).onDidOpenTerminal =
            ((listener: (t: vscode.Terminal) => void) => {
                active++;
                handler = listener;
                return new vscode.Disposable(() => { active--; handler = undefined; });
            }) as typeof vscode.window.onDidOpenTerminal;
        try {
            const hub = new VsCodeSensorHub();
            let calls = 0;
            const counting = (): void => { calls++; };
            const throwing = (): void => { throw new Error('consumer bug'); };

            const s1 = hub.onDidOpenTerminal(throwing);
            const s2 = hub.onDidOpenTerminal(counting);
            const s3 = hub.onDidOpenTerminal(counting); // same fn twice = two subscriptions
            handler?.({} as vscode.Terminal);
            assert.strictEqual(calls, 2, 'error in one listener must not suppress others; duplicates deliver twice');

            s2.dispose();
            handler?.({} as vscode.Terminal);
            assert.strictEqual(calls, 3, 'remaining duplicate subscription still delivers');
            assert.strictEqual(active, 1, 'source stays while subscriptions remain');

            s1.dispose();
            s3.dispose();
            assert.strictEqual(active, 0, 'last subscription detaches the source');
            hub.dispose();
        } finally {
            (vscode.window as { onDidOpenTerminal: typeof vscode.window.onDidOpenTerminal }).onDidOpenTerminal = original;
        }
    });

    test('hub.dispose() detaches sources and post-dispose attach stays inert', () => {
        const original = vscode.window.onDidOpenTerminal;
        let active = 0;
        (vscode.window as { onDidOpenTerminal: typeof vscode.window.onDidOpenTerminal }).onDidOpenTerminal =
            ((_listener: (t: vscode.Terminal) => void) => {
                active++;
                return new vscode.Disposable(() => { active--; });
            }) as typeof vscode.window.onDidOpenTerminal;
        try {
            const hub = new VsCodeSensorHub();
            hub.onDidOpenTerminal(() => { /* consumer */ });
            assert.strictEqual(active, 1);
            hub.dispose();
            assert.strictEqual(active, 0, 'dispose() must detach the underlying source');
            const sub = hub.onDidOpenTerminal(() => { /* late consumer */ });
            assert.strictEqual(active, 0, 'post-dispose attach must not resurrect the source');
            sub.dispose();
        } finally {
            (vscode.window as { onDidOpenTerminal: typeof vscode.window.onDidOpenTerminal }).onDidOpenTerminal = original;
        }
    });

    test('state reads delegate to the live VS Code namespace', () => {
        const hub = new VsCodeSensorHub();
        assert.deepStrictEqual(hub.readAllDiagnostics(), vscode.languages.getDiagnostics());
        assert.strictEqual(hub.readWindowFocused(), vscode.window.state.focused);
        assert.strictEqual(hub.readActiveTextEditor(), vscode.window.activeTextEditor);
        assert.strictEqual(hub.readVisibleTextEditors().length, vscode.window.visibleTextEditors.length);
        assert.strictEqual(hub.readTerminals().length, vscode.window.terminals.length);
        assert.strictEqual(hub.readBreakpoints().length, vscode.debug.breakpoints.length);
        hub.dispose();
    });

    test('settle channel: one underlying save listener for N consumers, torn down with the last', () => {
        const original = vscode.workspace.onDidSaveTextDocument;
        let saveListeners = 0;
        let fireSave: ((doc: vscode.TextDocument) => void) | undefined;
        (vscode.workspace as { onDidSaveTextDocument: typeof vscode.workspace.onDidSaveTextDocument }).onDidSaveTextDocument =
            ((listener: (doc: vscode.TextDocument) => void) => {
                saveListeners++;
                fireSave = listener;
                return new vscode.Disposable(() => { saveListeners--; fireSave = undefined; });
            }) as typeof vscode.workspace.onDidSaveTextDocument;
        const clock = sinon.useFakeTimers();
        try {
            const hub = new VsCodeSensorHub();
            const received: DiagnosticsSettledSignal[] = [];
            const s1 = hub.onDiagnosticsSettled(signal => received.push(signal));
            const s2 = hub.onDiagnosticsSettled(signal => received.push(signal));
            assert.strictEqual(saveListeners, 1, 'N settle consumers share one save listener');

            fireSave?.({ uri: vscode.Uri.file('/w/A.java') } as vscode.TextDocument);
            clock.tick(DiagnosticsSettleCollector.DIAGNOSTICS_SETTLE_MS + 1);
            assert.strictEqual(received.length, 2, 'both consumers receive the settled dump');

            s1.dispose();
            assert.strictEqual(saveListeners, 1, 'collector stays while a consumer remains');

            fireSave?.({ uri: vscode.Uri.file('/w/B.java') } as vscode.TextDocument);
            s2.dispose();
            assert.strictEqual(saveListeners, 0, 'last consumer tears down collector and save listener');
            clock.tick(DiagnosticsSettleCollector.DIAGNOSTICS_SETTLE_MS + 1);
            assert.strictEqual(received.length, 2, 'pending settle cancelled on teardown, no late emission');
            hub.dispose();
        } finally {
            clock.restore();
            (vscode.workspace as { onDidSaveTextDocument: typeof vscode.workspace.onDidSaveTextDocument }).onDidSaveTextDocument = original;
        }
    });
});

suite('VsCodeSensorHub paste relay (clipboard-confirmed)', () => {
    const PASTED = 'first();\nsecond();';

    /** Raw vscode change event shaped like a real multi-line paste (pure insert). */
    function pasteShapedEvent(): vscode.TextDocumentChangeEvent {
        return {
            document: { uri: vscode.Uri.file('/w/Main.java') },
            reason: undefined,
            contentChanges: [{
                text: PASTED,
                rangeLength: 0,
                range: { isEmpty: true, isSingleLine: false },
            }],
        } as unknown as vscode.TextDocumentChangeEvent;
    }

    /**
     * Patch onDidChangeTextDocument (capture the hub's handler) and override the hub's
     * clipboard seam with a deferred promise (`vscode.env.clipboard` is a frozen namespace
     * and cannot be monkeypatched).
     */
    function patchSources(hub: VsCodeSensorHub): {
        fire: (e: vscode.TextDocumentChangeEvent) => void;
        resolveClipboard: (text: string) => void;
        flush: () => Promise<void>;
        restore: () => void;
    } {
        const originalOnChange = vscode.workspace.onDidChangeTextDocument;
        let handler: ((e: vscode.TextDocumentChangeEvent) => void) | undefined;
        let resolver: ((text: string) => void) | undefined;
        (vscode.workspace as { onDidChangeTextDocument: typeof vscode.workspace.onDidChangeTextDocument }).onDidChangeTextDocument =
            ((listener: (e: vscode.TextDocumentChangeEvent) => void) => {
                handler = listener;
                return new vscode.Disposable(() => { handler = undefined; });
            }) as typeof vscode.workspace.onDidChangeTextDocument;
        (hub as unknown as { _readClipboardText: () => Thenable<string> })._readClipboardText =
            () => new Promise<string>(resolve => { resolver = resolve; });
        return {
            fire: e => handler?.(e),
            resolveClipboard: text => resolver?.(text),
            // Three microtask hops: Promise.resolve wrap + promise resolution + the .then callback.
            flush: async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); },
            restore: () => {
                (vscode.workspace as { onDidChangeTextDocument: typeof vscode.workspace.onDidChangeTextDocument }).onDidChangeTextDocument = originalOnChange;
            },
        };
    }

    test('emits a clipboard-confirmed multi-line paste with the event-time ts', async () => {
        const hub = new VsCodeSensorHub();
        const patch = patchSources(hub);
        try {
            const received: Array<{ ts: number; chars: number; lines: number }> = [];
            const sub = hub.onPasteDetected(p => received.push(p));

            const before = Date.now();
            patch.fire(pasteShapedEvent());
            assert.strictEqual(received.length, 0, 'nothing emitted before the clipboard resolves');
            patch.resolveClipboard(PASTED);
            await patch.flush();

            assert.strictEqual(received.length, 1);
            assert.strictEqual(received[0].chars, PASTED.length);
            assert.strictEqual(received[0].lines, 2);
            assert.ok(received[0].ts >= before && received[0].ts <= Date.now(), 'ts stamped at event time');

            sub.dispose();
            hub.dispose();
        } finally {
            patch.restore();
        }
    });

    test('does not emit when the clipboard differs (Copilot-shaped multi-line insert)', async () => {
        const hub = new VsCodeSensorHub();
        const patch = patchSources(hub);
        try {
            let count = 0;
            const sub = hub.onPasteDetected(() => count++);

            patch.fire(pasteShapedEvent());
            patch.resolveClipboard('something completely different');
            await patch.flush();

            assert.strictEqual(count, 0);
            sub.dispose();
            hub.dispose();
        } finally {
            patch.restore();
        }
    });

    test('a clipboard promise resolving after detach emits to NEITHER the old NOR a re-attached subscriber', async () => {
        const hub = new VsCodeSensorHub();
        const patch = patchSources(hub);
        try {
            let aCount = 0;
            let bCount = 0;

            const subA = hub.onPasteDetected(() => aCount++);
            patch.fire(pasteShapedEvent());     // clipboard read pending in A's relay closure
            subA.dispose();                      // detach while the read is in flight

            const subB = hub.onPasteDetected(() => bCount++);
            patch.resolveClipboard(PASTED);      // old promise resolves AFTER re-attach
            await patch.flush();

            assert.strictEqual(aCount, 0, 'disposed subscriber must not receive the stale paste');
            assert.strictEqual(bCount, 0, 'stale paste must not leak into the re-attached subscriber set');

            subB.dispose();
            hub.dispose();
        } finally {
            patch.restore();
        }
    });
});
