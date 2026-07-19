import * as vscode from 'vscode';
import * as assert from 'assert';
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
        const fakeNoAi = { onNoAiStatusChanged: () => ({ dispose() {} }), dispose() {} } as any;
        return new FullscreenPanelManager(vscode.Uri.parse('file:///ext'), ctx, () => ({} as never), fakeNoAi);
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

suite('FullscreenPanelManager.openExerciseFullscreen - #342 consent flip', () => {
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
        const fakeNoAi = { onNoAiStatusChanged: () => ({ dispose() {} }), dispose() {} } as any;
        return new FullscreenPanelManager(vscode.Uri.parse('file:///ext'), ctx, () => ({} as never), fakeNoAi);
    }

    test('a real config flip repaints an open fullscreen exercise panel, and the listener is disposed on close', async () => {
        const cfg = () => vscode.workspace.getConfiguration('artemis.iris');
        const prev = cfg().get('proactiveCodeEgress');

        const awaitConsentMsg = async (deadlineMs: number): Promise<boolean> => {
            const deadline = Date.now() + deadlineMs;
            while (Date.now() < deadline) {
                if (postMessage.getCalls().some(c => (c.args[0] as { type?: string })?.type === 'updateProactiveConsent')) {
                    return true;
                }
                await new Promise(r => setTimeout(r, 50));
            }
            return false;
        };

        try {
            // Normalize first (no assertion): a leaked value from another test would make the
            // flip below a config no-op that fires no event.
            await cfg().update('proactiveCodeEgress', 'ask', vscode.ConfigurationTarget.Global);

            const exerciseData = { exercise: { title: 'Test Exercise', studentParticipations: [] } };
            makeManager().openExerciseFullscreen(exerciseData as never);
            messageHandler({ type: WebviewMsgType.Ready });

            postMessage.resetHistory();
            await cfg().update('proactiveCodeEgress', 'enabled', vscode.ConfigurationTarget.Global);
            assert.ok(await awaitConsentMsg(2000), 'expected updateProactiveConsent to be posted to the fullscreen panel after a consent flip');

            // Panel close disposes the config subscription: a further flip must not post again.
            disposeHandler();
            postMessage.resetHistory();
            await cfg().update('proactiveCodeEgress', 'disabled', vscode.ConfigurationTarget.Global);
            assert.ok(!(await awaitConsentMsg(300)), 'the disposed panel must not receive further consent updates');
        } finally {
            await cfg().update('proactiveCodeEgress', prev, vscode.ConfigurationTarget.Global);
        }
    });
});

suite('FullscreenPanelManager.openExerciseFullscreen - #334 .noai flip', () => {
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

    const exerciseData = { exercise: { id: 1, title: 'X', studentParticipations: [] } };
    let noAiCb: (v: boolean) => void = () => {};
    const disposeSpy = sinon.spy();

    function makeManager(): FullscreenPanelManager {
        const ctx = { subscriptions: [] } as unknown as vscode.ExtensionContext;
        const fakeNoAi = {
            onNoAiStatusChanged: (cb: (value: boolean) => void) => { noAiCb = cb; return { dispose: disposeSpy }; },
        } as any;
        return new FullscreenPanelManager(vscode.Uri.parse('file:///ext'), ctx, () => ({} as never), fakeNoAi);
    }

    const awaitNoAiMsg = async (deadlineMs: number): Promise<boolean> => {
        const start = Date.now();
        while (Date.now() - start < deadlineMs) {
            if (postMessage.getCalls().some(c => (c.args[0] as { type?: string })?.type === 'updateNoAiStatus')) { return true; }
            await new Promise(r => setTimeout(r, 20));
        }
        return false;
    };

    test('a .noai flip posts updateNoAiStatus (both directions), and the subscription is disposed once with the panel', async () => {
        makeManager().openExerciseFullscreen(exerciseData as never);
        messageHandler({ type: WebviewMsgType.Ready });

        postMessage.resetHistory();
        noAiCb(true);
        assert.ok(await awaitNoAiMsg(2000), 'expected updateNoAiStatus after .noai appears');
        postMessage.resetHistory();
        noAiCb(false);
        assert.ok(await awaitNoAiMsg(2000), 'expected updateNoAiStatus after .noai disappears');

        disposeHandler();
        assert.ok(disposeSpy.calledOnce, 'the .noai subscription must be disposed exactly once with the panel');
    });
});
