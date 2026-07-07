import * as vscode from 'vscode';
import * as assert from 'assert';
import * as sinon from 'sinon';

import { InterventionService } from '@extension/services/intervention';

/** Minimal stand-in so a test can read the status-bar item's backgroundColor (the flash). */
function fakeStatusBarItem() {
    return {
        text: '', tooltip: '', color: undefined as unknown, command: undefined as unknown,
        backgroundColor: undefined as vscode.ThemeColor | undefined,
        show() { /* noop */ }, hide() { /* noop */ }, dispose() { /* noop */ },
    };
}

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
        assert.strictEqual(svc.isHintVisible, true, 'the jump lamp stays visible after a click');
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

    test('a missing anchor file is swallowed (best-effort), no throw; the jump lamp stays', async () => {
        sandbox.stub(vscode.workspace, 'openTextDocument').rejects(new Error('cannot open file'));
        svc = new InterventionService();
        svc.showJump(vscode.Uri.file('/ex/Gone.java'), 3);
        await svc.handleClick(); // must not reject
        assert.strictEqual(svc.isHintVisible, true, 'jump lamp persists even when the open fails');
    });

    // Real timers only: sinon fake timers hijack the global setTimeout the VS Code extension host
    // itself uses and break it. A tiny injected flash duration keeps these deterministic.
    const settle = () => new Promise(resolve => setTimeout(resolve, 40));

    const offScreen = () => false;   // injected visibility predicate: the flagged line is NOT on screen
    const onScreen = () => true;     // the flagged line is already visible

    test('an off-screen jump lamp flashes the warning background, then settles back', async () => {
        const item = fakeStatusBarItem();
        sandbox.stub(vscode.window, 'createStatusBarItem').returns(item as unknown as vscode.StatusBarItem);
        svc = new InterventionService(5, offScreen); // 5ms flash, cue off screen
        svc.showJump(vscode.Uri.file('/ex/A.java'), 1);
        assert.strictEqual(item.backgroundColor?.id, 'statusBarItem.warningBackground', 'flashes amber on appearance');
        await settle();
        assert.strictEqual(item.backgroundColor, undefined, 'settles back to the ambient blue-text look');
    });

    test('re-rendering the same jump after it settled does not re-flash', async () => {
        const item = fakeStatusBarItem();
        sandbox.stub(vscode.window, 'createStatusBarItem').returns(item as unknown as vscode.StatusBarItem);
        svc = new InterventionService(5, offScreen);
        svc.showJump(vscode.Uri.file('/ex/A.java'), 1);
        await settle();
        assert.strictEqual(item.backgroundColor, undefined);
        svc.showJump(vscode.Uri.file('/ex/A.java'), 1); // same jump, re-render -> no re-flash
        assert.strictEqual(item.backgroundColor, undefined, 'no re-flash on re-render of the same jump');
    });

    test('when the flagged line is already on screen, the lamp shows blue directly (no flash)', () => {
        const item = fakeStatusBarItem();
        sandbox.stub(vscode.window, 'createStatusBarItem').returns(item as unknown as vscode.StatusBarItem);
        svc = new InterventionService(5, onScreen);
        svc.showJump(vscode.Uri.file('/ex/A.java'), 5);
        assert.strictEqual(item.backgroundColor, undefined, 'no amber flash when the cue is already visible');
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

    test('clearEpisodeLamp clears a parked or jump lamp', () => {
        svc = new InterventionService();
        svc.showLamp();
        svc.clearEpisodeLamp();
        assert.strictEqual(svc.isHintVisible, false, 'parked lamp cleared');
        svc.showJump(vscode.Uri.file('/ex/A.java'), 1);
        svc.clearEpisodeLamp();
        assert.strictEqual(svc.isHintVisible, false, 'jump lamp cleared');
    });
});
