import * as vscode from 'vscode';
import * as sinon from 'sinon';

import { WebviewMsgType } from '@shared/messageContracts';

import { FullscreenPanelManager } from '@extension/services/ui/fullscreenPanelManager';

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
        return new FullscreenPanelManager(vscode.Uri.parse('file:///ext'), ctx, () => ({} as never));
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
