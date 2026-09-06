import * as vscode from 'vscode';
import * as assert from 'assert';
import * as sinon from 'sinon';

import { WebviewMsgType } from '@shared/messageContracts';

import { FullscreenPanelManager } from '@extension/services/ui/fullscreenPanelManager';
import { WebviewBroadcaster } from '@extension/services/ui/webviewBroadcaster';

suite('FullscreenPanelManager.openStruggleFullscreen', () => {
    let sandbox: sinon.SinonSandbox;
    let postMessage: sinon.SinonStub;
    let messageHandler: (m: unknown) => void;
    let disposeHandler: () => void;

    setup(() => {
        sandbox = sinon.createSandbox();
        postMessage = sandbox.stub();
        const panel = {
            webview: {
                html: '',
                cspSource: 'vscode-resource:',
                asWebviewUri: (u: vscode.Uri) => u,
                postMessage,
                onDidReceiveMessage: (cb: (m: unknown) => void) => { messageHandler = cb; return { dispose() { /* noop */ } }; },
            },
            onDidDispose: (cb: () => void) => { disposeHandler = cb; return { dispose() { /* noop */ } }; },
            dispose() { /* noop */ },
        };
        sandbox.stub(vscode.window, 'createWebviewPanel').returns(panel as unknown as vscode.WebviewPanel);
    });
    teardown(() => sandbox.restore());

    function makeManager(): FullscreenPanelManager {
        const ctx = { subscriptions: [] } as unknown as vscode.ExtensionContext;
        return new FullscreenPanelManager(
            vscode.Uri.parse('file:///ext'),
            ctx,
            () => ({} as never),
            () => ({} as never),
            new WebviewBroadcaster(),
        );
    }

    test('Ready posts the init and subscribes once; RequestInit re-sends WITHOUT re-subscribing; dispose tears down', () => {
        const buildInit = sandbox.stub().returns({ type: 'struggleDetectionInit' });
        const refreshDispose = sandbox.stub();
        const subscribeRefresh = sandbox.stub().returns({ dispose: refreshDispose });

        makeManager().openStruggleFullscreen(buildInit as never, subscribeRefresh as never);

        // Ready → one init posted, subscribed exactly once.
        messageHandler({ type: WebviewMsgType.Ready });
        sinon.assert.calledOnce(buildInit);
        sinon.assert.calledOnce(postMessage);
        sinon.assert.calledOnce(subscribeRefresh);

        // RequestInit → re-sends the init, but does NOT subscribe again.
        messageHandler({ type: WebviewMsgType.RequestInit });
        sinon.assert.calledTwice(buildInit);
        sinon.assert.calledTwice(postMessage);
        sinon.assert.calledOnce(subscribeRefresh);

        // The refresh callback (tick / session edge) re-posts the latest snapshot.
        const refresh = subscribeRefresh.firstCall.args[0] as () => void;
        refresh();
        sinon.assert.calledThrice(postMessage);

        // Panel close disposes the refresh subscription.
        disposeHandler();
        sinon.assert.calledOnce(refreshDispose);
    });

    test('the refresh callback stops posting once the panel is disposed', () => {
        const buildInit = sandbox.stub().returns({ type: 'struggleDetectionInit' });
        const subscribeRefresh = sandbox.stub().returns({ dispose: () => { /* noop */ } });

        makeManager().openStruggleFullscreen(buildInit as never, subscribeRefresh as never);
        messageHandler({ type: WebviewMsgType.Ready });
        postMessage.resetHistory();

        const refresh = subscribeRefresh.firstCall.args[0] as () => void;
        disposeHandler();
        refresh();   // a late tick after disposal must not post to the dead webview

        sinon.assert.notCalled(postMessage);
    });
});

suite('FullscreenPanelManager.openExerciseFullscreen - shared builder + broadcast sink', () => {
    let sandbox: sinon.SinonSandbox;
    let postMessage: sinon.SinonStub;
    let messageHandler: (m: unknown) => void;
    let disposeHandler: () => void;
    let broadcaster: WebviewBroadcaster;
    let buildExerciseDetailInit: sinon.SinonStub;

    const flush = () => new Promise(r => setTimeout(r, 0));

    setup(() => {
        sandbox = sinon.createSandbox();
        postMessage = sandbox.stub();
        const panel = {
            webview: {
                html: '',
                cspSource: 'vscode-resource:',
                asWebviewUri: (u: vscode.Uri) => u,
                postMessage,
                onDidReceiveMessage: (cb: (m: unknown) => void) => { messageHandler = cb; return { dispose() { /* noop */ } }; },
            },
            onDidDispose: (cb: () => void) => { disposeHandler = cb; return { dispose() { /* noop */ } }; },
            dispose() { /* noop */ },
        };
        sandbox.stub(vscode.window, 'createWebviewPanel').returns(panel as unknown as vscode.WebviewPanel);
        broadcaster = new WebviewBroadcaster();
        buildExerciseDetailInit = sandbox.stub().resolves({ msg: { type: 'exerciseDetailInit' }, repoStatus: undefined });
    });
    teardown(() => sandbox.restore());

    function makeManager(): FullscreenPanelManager {
        const ctx = { subscriptions: [] } as unknown as vscode.ExtensionContext;
        return new FullscreenPanelManager(
            vscode.Uri.parse('file:///ext'),
            ctx,
            () => ({} as never),
            () => ({ buildExerciseDetailInit } as never),
            broadcaster,
        );
    }

    test('Ready builds the init via the shared builder and posts it', async () => {
        const exerciseData = { exercise: { id: 1, title: 'X', studentParticipations: [] } };
        makeManager().openExerciseFullscreen(exerciseData as never);
        messageHandler({ type: WebviewMsgType.Ready });
        await flush();

        sinon.assert.calledOnce(buildExerciseDetailInit);
        sinon.assert.calledWith(buildExerciseDetailInit, exerciseData);
        assert.ok(postMessage.getCalls().some(c => (c.args[0] as { type?: string })?.type === 'exerciseDetailInit'));
    });

    test('a broadcast reaches the open panel and stops after the panel is disposed', () => {
        const exerciseData = { exercise: { id: 1, title: 'X', studentParticipations: [] } };
        makeManager().openExerciseFullscreen(exerciseData as never);
        messageHandler({ type: WebviewMsgType.Ready });
        postMessage.resetHistory();

        // A global push (e.g. consent) fans out through the broadcaster to this panel.
        broadcaster.broadcast({ type: 'updateProactiveConsent' } as never);
        assert.ok(postMessage.getCalls().some(c => (c.args[0] as { type?: string })?.type === 'updateProactiveConsent'));

        // After the panel closes its sink is removed: a further broadcast must not reach it.
        disposeHandler();
        postMessage.resetHistory();
        broadcaster.broadcast({ type: 'updateNoAiStatus', isNoAiDetected: true } as never);
        sinon.assert.notCalled(postMessage);
    });

    test('a broadcast before Ready is buffered and delivered once the panel signals Ready', () => {
        const exerciseData = { exercise: { id: 1, title: 'X', studentParticipations: [] } };
        makeManager().openExerciseFullscreen(exerciseData as never);

        // Registered at creation → a push before Ready is buffered by postSafe, not dropped.
        broadcaster.broadcast({ type: 'updateProactiveConsent' } as never);
        sinon.assert.notCalled(postMessage);

        messageHandler({ type: WebviewMsgType.Ready });
        assert.ok(postMessage.getCalls().some(c => (c.args[0] as { type?: string })?.type === 'updateProactiveConsent'));
    });
});
