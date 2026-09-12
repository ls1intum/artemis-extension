// extension/test/unit/services/sensing/internalSources.test.ts
import * as vscode from 'vscode';
import * as assert from 'assert';

import { VsCodeSensorHub } from '@extension/services/sensing';
import type { BuildResultSignal, PasteSignal, TaskFeedbackViewSignal } from '@extension/services/sensing/types';
import type { ResultDTO } from '@extension/types';

suite('SensorHub internal sources', () => {
    test('emitBuildResult fans out a stamped signal', () => {
        const hub = new VsCodeSensorHub();
        const seen: BuildResultSignal[] = [];
        const sub = hub.onBuildResult(s => seen.push(s));
        const result = { id: 1 } as ResultDTO;
        const before = Date.now();
        hub.emitBuildResult(result);
        assert.strictEqual(seen.length, 1);
        assert.strictEqual(seen[0].result, result);
        assert.ok(seen[0].ts >= before && seen[0].ts <= Date.now());
        sub.dispose();
        hub.dispose();
    });

    test('emitTaskFeedbackView carries action and viewId', () => {
        const hub = new VsCodeSensorHub();
        const seen: TaskFeedbackViewSignal[] = [];
        const sub = hub.onTaskFeedbackView(s => seen.push(s));
        hub.emitTaskFeedbackView('opened', 'view-1');
        hub.emitTaskFeedbackView('closed', 'view-1');
        assert.deepStrictEqual(seen.map(s => [s.action, s.viewId]), [['opened', 'view-1'], ['closed', 'view-1']]);
        sub.dispose();
        hub.dispose();
    });

    test('emit after dispose is inert (no throw, no delivery)', () => {
        const hub = new VsCodeSensorHub();
        const seen: BuildResultSignal[] = [];
        hub.onBuildResult(s => seen.push(s));
        hub.dispose();
        hub.emitBuildResult({ id: 2 } as ResultDTO);
        assert.strictEqual(seen.length, 0);
    });

    test('onPasteDetected confirms a multi-line edit against the real clipboard', async () => {
        // Not an OS paste gesture: the edit is programmatic, but with the clipboard seeded
        // to the same text it exercises the full clipboard-confirmed relay end-to-end.
        const pasted = 'this is a pasted block\nsecond line';
        await vscode.env.clipboard.writeText(pasted);
        const hub = new VsCodeSensorHub();
        const seen: PasteSignal[] = [];
        const sub = hub.onPasteDetected(s => seen.push(s));
        const doc = await vscode.workspace.openTextDocument({ content: '' });
        const editor = await vscode.window.showTextDocument(doc);
        await editor.edit(b => b.insert(new vscode.Position(0, 0), pasted));
        // The clipboard confirmation resolves asynchronously after the edit.
        await new Promise(resolve => setTimeout(resolve, 50));
        assert.strictEqual(seen.length, 1);
        assert.strictEqual(seen[0].lines, 2);
        sub.dispose();
        hub.dispose();
    });

    test('onPasteDetected stays silent when the clipboard does not match (completion-shaped edit)', async () => {
        await vscode.env.clipboard.writeText('something completely different');
        const hub = new VsCodeSensorHub();
        const seen: PasteSignal[] = [];
        const sub = hub.onPasteDetected(s => seen.push(s));
        const doc = await vscode.workspace.openTextDocument({ content: '' });
        const editor = await vscode.window.showTextDocument(doc);
        await editor.edit(b => b.insert(new vscode.Position(0, 0), 'generated();\nnotFromClipboard();'));
        await new Promise(resolve => setTimeout(resolve, 50));
        assert.strictEqual(seen.length, 0);
        sub.dispose();
        hub.dispose();
    });
});
