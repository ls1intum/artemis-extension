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

    test('showJump shows the lamp in jump mode with the file:line label', () => {
        svc = new InterventionService();
        svc.showJump(vscode.Uri.file('/ex/src/de/tum/cit/aet/ProjectPlanner.java'), 114);
        assert.strictEqual(svc.isHintVisible, true);
        assert.strictEqual(svc.mode, 'jump');
    });

    test('clicking the jump lamp opens the anchored file at the line (no chat bounce)', async () => {
        const exec = sandbox.stub(vscode.commands, 'executeCommand').resolves(undefined);
        const openDoc = sandbox.stub(vscode.workspace, 'openTextDocument').resolves({ lineCount: 200 } as vscode.TextDocument);
        const showDoc = sandbox.stub(vscode.window, 'showTextDocument').resolves(undefined as unknown as vscode.TextEditor);
        svc = new InterventionService();
        const uri = vscode.Uri.file('/ex/ProjectPlanner.java');
        svc.showJump(uri, 114);
        await svc.handleClick();
        assert.ok(openDoc.calledOnce, 'opens a document');
        assert.strictEqual(openDoc.firstCall.args[0], uri, 'opens the snapshotted anchor Uri');
        assert.ok(showDoc.calledOnce, 'reveals the document');
        assert.ok(!exec.calledWith('iris.chatView.focus'), 'jump must not bounce to the chat');
    });

    test('past-EOF anchor line is clamped, click never throws', async () => {
        sandbox.stub(vscode.workspace, 'openTextDocument').resolves({ lineCount: 10 } as vscode.TextDocument);
        const showDoc = sandbox.stub(vscode.window, 'showTextDocument').resolves(undefined as unknown as vscode.TextEditor);
        svc = new InterventionService();
        svc.showJump(vscode.Uri.file('/ex/Short.java'), 999);
        await svc.handleClick();
        const opts = showDoc.firstCall.args[1] as vscode.TextDocumentShowOptions;
        assert.strictEqual((opts.selection as vscode.Range).start.line, 9, 'clamped to last line (0-based 9)');
    });

    test('a missing anchor file is swallowed (best-effort), no throw', async () => {
        sandbox.stub(vscode.workspace, 'openTextDocument').rejects(new Error('cannot open file'));
        svc = new InterventionService();
        svc.showJump(vscode.Uri.file('/ex/Gone.java'), 3);
        await svc.handleClick(); // must not reject
        assert.strictEqual(svc.isHintVisible, false);
    });

    test('mode dispatch after reset: jump -> reset -> parked click reveals, not jumps', async () => {
        const exec = sandbox.stub(vscode.commands, 'executeCommand').resolves(undefined);
        const openDoc = sandbox.stub(vscode.workspace, 'openTextDocument').resolves({ lineCount: 200 } as vscode.TextDocument);
        svc = new InterventionService();
        svc.showJump(vscode.Uri.file('/ex/ProjectPlanner.java'), 114);
        svc.reset();
        svc.showLamp();
        await svc.handleClick();
        assert.ok(exec.calledWith('iris.chatView.focus'), 'parked click reveals into chat');
        assert.ok(openDoc.notCalled, 'must NOT open a file (no stale jump command)');
    });

    test('mode dispatch after reset: jump -> reset -> fallback click shows the template', async () => {
        const exec = sandbox.stub(vscode.commands, 'executeCommand').resolves(undefined);
        const info = sandbox.stub(vscode.window, 'showInformationMessage').resolves(undefined);
        const openDoc = sandbox.stub(vscode.workspace, 'openTextDocument').resolves({ lineCount: 200 } as vscode.TextDocument);
        svc = new InterventionService();
        svc.showJump(vscode.Uri.file('/ex/ProjectPlanner.java'), 114);
        svc.reset();
        svc.showAmbient('local template hint', false);
        await svc.handleClick();
        assert.ok(info.calledWith('local template hint'), 'fallback click shows the template');
        assert.ok(openDoc.notCalled, 'must NOT open a file');
        assert.ok(!exec.calledWith('iris.chatView.focus'));
    });

    test('clearEpisodeLamp clears a parked or jump lamp', () => {
        svc = new InterventionService();
        svc.showLamp();
        svc.clearEpisodeLamp();
        assert.strictEqual(svc.isHintVisible, false, 'parked lamp cleared');
        svc.showJump(vscode.Uri.file('/ex/A.java'), 1);
        svc.clearEpisodeLamp();
        assert.strictEqual(svc.isHintVisible, false, 'jump lamp cleared');
    });

    test('clearEpisodeLamp does NOT clear a no-AI fallback lamp', () => {
        svc = new InterventionService();
        svc.showAmbient('local template hint', false);
        svc.clearEpisodeLamp();
        assert.strictEqual(svc.isHintVisible, true, 'fallback lamp survives episode teardown');
        assert.strictEqual(svc.mode, 'fallback');
    });
});
