import * as vscode from 'vscode';
import * as assert from 'assert';
import * as sinon from 'sinon';

import { InterventionService } from '@extension/services/intervention';
import type { AlertRecord } from '@extension/services/struggle/types';

function alert(overrides: Partial<Extract<AlertRecord, { kind: 'edit' }>> = {}): AlertRecord {
    return {
        kind: 'edit', t: 490, ts: 1000, urgency: 0.7, v: 0.7, typesPreGate: ['STATE'], types: ['STATE'],
        primary: 'STATE', path: 'armed', inWarmup: false, inGrace: false, ...overrides,
    };
}

suite('InterventionService (AlertSink, single-level)', () => {
    let svc: InterventionService;
    let sandbox: sinon.SinonSandbox;

    setup(() => {
        // Self-contained: the status-bar command id (iris.intervention.acceptSubtle)
        // is registered once by the InterventionService during activation. Stub
        // registerCommand so test-scoped instances never collide on the global
        // registry, and so this suite has no dependency on any other suite.
        sandbox = sinon.createSandbox();
        sandbox.stub(vscode.commands, 'registerCommand').returns(new vscode.Disposable(() => { /* noop */ }));
    });
    teardown(() => { svc?.dispose(); sandbox.restore(); });

    test('deliver shows the status-bar hint', () => {
        svc = new InterventionService();
        svc.deliver(alert());
        // The hint is visible; exposed for testing via a getter.
        assert.strictEqual(svc.isHintVisible, true);
    });

    test('clicking the hint opens the Iris chat view', async () => {
        const exec = sandbox.stub(vscode.commands, 'executeCommand').resolves(undefined);
        svc = new InterventionService();
        svc.deliver(alert());
        await svc.handleClick();
        assert.ok(exec.calledWith('iris.chatView.focus'));
    });

    test('onSessionStart clears any visible hint', () => {
        svc = new InterventionService();
        svc.deliver(alert());
        svc.onSessionStart({ exerciseId: 1 });
        assert.strictEqual(svc.isHintVisible, false);
    });

    test('deliver fires onDidDeliver with the alert (for the recorder/debug)', () => {
        svc = new InterventionService();
        const seen: AlertRecord[] = [];
        svc.onDidDeliver(a => seen.push(a));
        const a = alert({ v: 0.85 });
        svc.deliver(a);
        assert.strictEqual(seen.length, 1);
        assert.strictEqual(seen[0].v, 0.85);
    });
});
