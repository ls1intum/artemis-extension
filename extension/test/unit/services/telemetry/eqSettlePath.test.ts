// extension/test/unit/services/telemetry/eqSettlePath.test.ts
import * as vscode from 'vscode';
import * as assert from 'assert';
import * as sinon from 'sinon';

import { nextSensorSeq } from '@extension/services/sensing/sequence';
import { TelemetryManager } from '@extension/services/telemetry/telemetryManager';
import { TestSensorHub } from '@test/__shared__/testSensorHub';

function errorEntry(path: string, message: string): [vscode.Uri, vscode.Diagnostic[]] {
    const diag = new vscode.Diagnostic(new vscode.Range(0, 0, 0, 1), message, vscode.DiagnosticSeverity.Error);
    diag.source = 'java';
    diag.code = 'E001';
    return [vscode.Uri.file(path), [diag]];
}

suite('EQ settle path via SensorHub', () => {
    let sandbox: sinon.SinonSandbox;

    setup(() => {
        sandbox = sinon.createSandbox();
        // TelemetryManager constructs an InterventionService, which registers
        // commands on the global registry — stub it so repeated construction
        // across tests does not collide (same pattern as the other
        // TelemetryManager suites).
        sandbox.stub(vscode.commands, 'registerCommand').returns(new vscode.Disposable(() => { /* noop */ }));
    });

    teardown(() => {
        sandbox.restore();
    });

    test('a settled diagnostics dump produces one EQ snapshot with source=save', () => {
        const hub = new TestSensorHub();
        const tm = new TelemetryManager(undefined, hub);
        const calculated: { source: string }[] = [];
        tm.onDidCalculateEQ(e => calculated.push(e));
        tm.startExerciseSession(1);

        hub.emit.diagnosticsSettled.fire({
            ts: Date.now(),
            savedSeq: nextSensorSeq(), // save AFTER session start: must be processed
            entries: [errorEntry('/w/A.java', 'boom')],
        });
        assert.strictEqual(calculated.length, 1);
        assert.strictEqual(calculated[0].source, 'save');

        // Identical dump inside the dedup window: no second snapshot.
        hub.emit.diagnosticsSettled.fire({
            ts: Date.now(),
            savedSeq: nextSensorSeq(),
            entries: [errorEntry('/w/A.java', 'boom')],
        });
        assert.strictEqual(calculated.length, 1);

        tm.dispose();
        hub.dispose();
    });

    test('a settle whose save predates the session start is dropped (cross-session guard)', () => {
        const hub = new TestSensorHub();
        const tm = new TelemetryManager(undefined, hub);
        const calculated: unknown[] = [];
        tm.onDidCalculateEQ(e => calculated.push(e));

        const staleSaveSeq = nextSensorSeq(); // save happened, THEN the session switched
        tm.startExerciseSession(1);           // draws a later token internally
        hub.emit.diagnosticsSettled.fire({
            ts: Date.now(),
            savedSeq: staleSaveSeq,
            entries: [errorEntry('/w/A.java', 'boom')],
        });
        assert.strictEqual(calculated.length, 0, 'stale settle must not leak into the new session');

        tm.dispose();
        hub.dispose();
    });

    test('a settle before any session start is processed (v1 parity)', () => {
        const hub = new TestSensorHub();
        const tm = new TelemetryManager(undefined, hub);
        const calculated: unknown[] = [];
        tm.onDidCalculateEQ(e => calculated.push(e));

        hub.emit.diagnosticsSettled.fire({
            ts: Date.now(),
            savedSeq: nextSensorSeq(),
            entries: [errorEntry('/w/A.java', 'boom')],
        });
        assert.strictEqual(calculated.length, 1, 'pre-session settles must flow like in v1');

        tm.dispose();
        hub.dispose();
    });
});
