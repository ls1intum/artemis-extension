// extension/test/unit/services/sensing/diagnosticsSettle.test.ts
import * as vscode from 'vscode';
import * as assert from 'assert';
import * as sinon from 'sinon';

import { DiagnosticsSettleCollector } from '@extension/services/sensing/collectors/diagnosticsSettle';
import { nextSensorSeq } from '@extension/services/sensing/sequence';
import type { DiagnosticsSettledSignal, SaveSignal } from '@extension/services/sensing/types';

function fakeSaveSignal(path: string, scheme = 'file'): SaveSignal {
    const uri = scheme === 'file' ? vscode.Uri.file(path) : vscode.Uri.parse(`${scheme}:${path}`);
    return { ts: Date.now(), seq: nextSensorSeq(), document: { uri } as vscode.TextDocument };
}

suite('DiagnosticsSettleCollector', () => {
    let emitter: vscode.EventEmitter<SaveSignal>;
    let collector: DiagnosticsSettleCollector;
    let received: DiagnosticsSettledSignal[];
    let clock: sinon.SinonFakeTimers;
    const dump: Array<[vscode.Uri, vscode.Diagnostic[]]> = [
        [vscode.Uri.file('/w/A.java'), [new vscode.Diagnostic(new vscode.Range(0, 0, 0, 1), 'boom', vscode.DiagnosticSeverity.Error)]],
    ];

    setup(() => {
        clock = sinon.useFakeTimers({
            toFake: ['Date', 'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval'],
            shouldClearNativeTimers: true,
        });
        emitter = new vscode.EventEmitter<SaveSignal>();
        collector = new DiagnosticsSettleCollector(emitter.event, () => dump);
        received = [];
        collector.onDidSettle(signal => received.push(signal));
    });

    teardown(() => {
        collector.dispose();
        emitter.dispose();
        clock.restore();
    });

    test('emits one settled dump 500ms after a save, carrying the save ordering token', async () => {
        const save = fakeSaveSignal('/w/A.java');
        emitter.fire(save);
        assert.strictEqual(received.length, 0, 'must not emit before the settle window');
        clock.tick(DiagnosticsSettleCollector.DIAGNOSTICS_SETTLE_MS + 1);
        assert.strictEqual(received.length, 1);
        assert.strictEqual(received[0].entries, dump);
        assert.strictEqual(received[0].savedSeq, save.seq);
        assert.ok(received[0].ts >= save.ts);
    });

    test('coalesces rapid saves into a single emission with the LAST save token', async () => {
        emitter.fire(fakeSaveSignal('/w/A.java'));
        clock.tick(100);
        const second = fakeSaveSignal('/w/B.java');
        emitter.fire(second);
        clock.tick(DiagnosticsSettleCollector.DIAGNOSTICS_SETTLE_MS + 1);
        assert.strictEqual(received.length, 1);
        assert.strictEqual(received[0].savedSeq, second.seq);
    });

    test('ignores non-recordable URIs', async () => {
        emitter.fire(fakeSaveSignal('/x', 'untitled'));
        clock.tick(DiagnosticsSettleCollector.DIAGNOSTICS_SETTLE_MS + 1);
        assert.strictEqual(received.length, 0);
    });

    test('dispose cancels a pending settle', async () => {
        emitter.fire(fakeSaveSignal('/w/A.java'));
        collector.dispose();
        clock.tick(DiagnosticsSettleCollector.DIAGNOSTICS_SETTLE_MS + 1);
        assert.strictEqual(received.length, 0);
    });
});
