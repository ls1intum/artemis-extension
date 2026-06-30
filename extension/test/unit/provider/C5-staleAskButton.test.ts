/**
 * C5: ChatWebviewProvider routes StaleAskButton webview commands to onStaleAskButton.
 */
import * as vscode from 'vscode';
import * as assert from 'assert';
import * as sinon from 'sinon';

import { ChatWebviewProvider } from '@extension/provider/chatWebviewProvider';
import { ContextStore } from '@extension/services/iris/context/contextStore';
import { MockExtensionContext } from '@test/unit/mocks/vscodeMocks';

function buildProvider(): {
    provider: ChatWebviewProvider;
    sandbox: sinon.SinonSandbox;
} {
    const sandbox = sinon.createSandbox();
    sandbox.stub(vscode.commands, 'registerCommand').returns({ dispose: () => undefined });
    const mockContext = new MockExtensionContext();
    const noAi = {
        isNoAiEnabled: false,
        onNoAiStatusChanged: new vscode.EventEmitter<boolean>().event,
    };
    const registry = { getAllExercises: () => [] };
    const courseDataCache = {
        onCoursesLoaded: new vscode.EventEmitter<unknown>().event,
        fetch: async () => undefined,
    };
    const contextStore = new ContextStore(mockContext);
    const provider = new ChatWebviewProvider(
        vscode.Uri.file('/tmp'),
        mockContext as unknown as vscode.ExtensionContext,
        undefined,
        undefined,
        noAi as never,
        registry as never,
        courseDataCache as never,
        contextStore,
    );
    return { provider, sandbox };
}

suite('C5: ChatWebviewProvider StaleAskButton routing', () => {
    let provider: ChatWebviewProvider;
    let sandbox: sinon.SinonSandbox;

    setup(() => {
        const built = buildProvider();
        provider = built.provider;
        sandbox = built.sandbox;
    });

    teardown(() => {
        provider.dispose();
        sandbox.restore();
    });

    test('StaleAskButton command routes to onStaleAskButton callback (solved)', () => {
        const onStaleAskButton = sinon.stub();
        provider.setStruggleCallbacks({ onStaleAskButton });

        // Simulate the webview sending a staleAskButton command
        (provider as unknown as { _handleMessage(msg: unknown): void })._handleMessage({
            type: 'command',
            command: 'staleAskButton',
            payload: { askId: 'ask-42', button: 'solved' },
        });

        assert.ok(onStaleAskButton.calledOnce, 'onStaleAskButton should be called once');
        assert.strictEqual(onStaleAskButton.firstCall.args[0], 'ask-42');
        assert.strictEqual(onStaleAskButton.firstCall.args[1], 'solved');
    });

    test('StaleAskButton command routes to onStaleAskButton callback (still-on-it)', () => {
        const onStaleAskButton = sinon.stub();
        provider.setStruggleCallbacks({ onStaleAskButton });

        (provider as unknown as { _handleMessage(msg: unknown): void })._handleMessage({
            type: 'command',
            command: 'staleAskButton',
            payload: { askId: 'ask-7', button: 'still-on-it' },
        });

        assert.ok(onStaleAskButton.calledOnce);
        assert.strictEqual(onStaleAskButton.firstCall.args[1], 'still-on-it');
    });

    test('StaleAskButton command routes to onStaleAskButton callback (something-else)', () => {
        const onStaleAskButton = sinon.stub();
        provider.setStruggleCallbacks({ onStaleAskButton });

        (provider as unknown as { _handleMessage(msg: unknown): void })._handleMessage({
            type: 'command',
            command: 'staleAskButton',
            payload: { askId: 'ask-9', button: 'something-else' },
        });

        assert.ok(onStaleAskButton.calledOnce);
        assert.strictEqual(onStaleAskButton.firstCall.args[1], 'something-else');
    });

    test('StaleAskButton is a no-op when no callback is wired (no crash)', () => {
        // No setStruggleCallbacks called -- _onStaleAskButton is undefined
        assert.doesNotThrow(() => {
            (provider as unknown as { _handleMessage(msg: unknown): void })._handleMessage({
                type: 'command',
                command: 'staleAskButton',
                payload: { askId: 'ask-1', button: 'solved' },
            });
        });
    });
});
