// extension/test/unit/services/sensing/sensorHub.test.ts
import * as vscode from 'vscode';
import * as assert from 'assert';

import { VsCodeSensorHub } from '@extension/services/sensing/sensorHub';
import type { TextChangeSignal } from '@extension/services/sensing/types';

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
});
