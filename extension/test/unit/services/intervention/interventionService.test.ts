import * as vscode from 'vscode';
import * as assert from 'assert';
import * as sinon from 'sinon';

import { InterventionService } from '@extension/services/intervention';

suite('InterventionService (ambient lamp)', () => {
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

    test('showLamp shows the status-bar hint', () => {
        svc = new InterventionService();
        svc.showLamp();
        assert.strictEqual(svc.isHintVisible, true);
    });

    test('showAmbient shows the status-bar hint', () => {
        svc = new InterventionService();
        svc.showAmbient('check your loop bounds', true);
        assert.strictEqual(svc.isHintVisible, true);
    });

    test('reset clears the visible hint', () => {
        svc = new InterventionService();
        svc.showLamp();
        svc.reset();
        assert.strictEqual(svc.isHintVisible, false);
    });

    test('clicking the lamp opens the Iris chat view', async () => {
        const exec = sandbox.stub(vscode.commands, 'executeCommand').resolves(undefined);
        svc = new InterventionService();
        svc.showLamp();
        await svc.handleClick();
        assert.ok(exec.calledWith('iris.chatView.focus'));
    });

    test('a no-AI ambient hint shows the template on click and does NOT open the chat', async () => {
        const exec = sandbox.stub(vscode.commands, 'executeCommand').resolves(undefined);
        const info = sandbox.stub(vscode.window, 'showInformationMessage').resolves(undefined);
        svc = new InterventionService();
        svc.showAmbient('local template hint', false);
        await svc.handleClick();
        assert.ok(!exec.calledWith('iris.chatView.focus'), 'must not bounce to the AI chat');
        assert.ok(info.calledWith('local template hint'));
    });

    test('clicking fires onDidClick', () => {
        sandbox.stub(vscode.commands, 'executeCommand').resolves(undefined);
        svc = new InterventionService();
        let clicks = 0;
        svc.onDidClick(() => { clicks++; });
        svc.showLamp();
        void svc.handleClick();
        assert.strictEqual(clicks, 1);
    });
});
