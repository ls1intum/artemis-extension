/**
 * C8: ChatWebviewProvider _handleProactiveOutcome routes to onEpisodeDismiss when
 * proactiveEpisodeId is present; backoff still fires; legacy path for missing id.
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
    mockApi: { setProactiveOutcome: sinon.SinonStub };
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

    const mockApi = { setProactiveOutcome: sinon.stub().resolves() };

    const provider = new ChatWebviewProvider(
        vscode.Uri.file('/tmp'),
        mockContext as unknown as vscode.ExtensionContext,
        mockApi as never,
        undefined,
        noAi as never,
        registry as never,
        courseDataCache as never,
        contextStore,
    );
    return { provider, sandbox, mockApi };
}

suite('C8: ChatWebviewProvider proactive outcome routing', () => {
    let provider: ChatWebviewProvider;
    let sandbox: sinon.SinonSandbox;
    let mockApi: { setProactiveOutcome: sinon.SinonStub };

    setup(() => {
        const built = buildProvider();
        provider = built.provider;
        sandbox = built.sandbox;
        mockApi = built.mockApi;
    });

    teardown(() => {
        provider.dispose();
        sandbox.restore();
    });

    test('with proactiveEpisodeId: routes to onEpisodeDismiss callback, NOT legacy setProactiveOutcome', (done) => {
        const onEpisodeDismiss = sinon.stub();
        provider.setStruggleCallbacks({ onEpisodeDismiss });

        (provider as unknown as { _handleMessage(msg: unknown): void })._handleMessage({
            type: 'command',
            command: 'messageProactiveOutcome',
            payload: { sessionId: 1, messageId: 10, outcome: 'DISMISSED', proactiveEpisodeId: 'ep-abc' },
        });

        // Give microtasks a tick
        setTimeout(() => {
            assert.ok(onEpisodeDismiss.calledOnce, 'onEpisodeDismiss should be called');
            assert.strictEqual(onEpisodeDismiss.firstCall.args[0], 'ep-abc');
            assert.ok(!mockApi.setProactiveOutcome.called, 'legacy setProactiveOutcome must NOT be called');
            done();
        }, 0);
    });

    test('with proactiveEpisodeId: _onDidDismissProactive backoff event still fires', (done) => {
        const dismissFired = sinon.stub();
        provider.onDidDismissProactive(dismissFired);
        provider.setStruggleCallbacks({ onEpisodeDismiss: sinon.stub() });

        (provider as unknown as { _handleMessage(msg: unknown): void })._handleMessage({
            type: 'command',
            command: 'messageProactiveOutcome',
            payload: { sessionId: 1, messageId: 10, outcome: 'DISMISSED', proactiveEpisodeId: 'ep-xyz' },
        });

        setTimeout(() => {
            assert.ok(dismissFired.calledOnce, '_onDidDismissProactive should fire');
            done();
        }, 0);
    });

    test('without proactiveEpisodeId: falls back to legacy setProactiveOutcome (no crash)', (done) => {
        const onEpisodeDismiss = sinon.stub();
        provider.setStruggleCallbacks({ onEpisodeDismiss });

        (provider as unknown as { _handleMessage(msg: unknown): void })._handleMessage({
            type: 'command',
            command: 'messageProactiveOutcome',
            payload: { sessionId: 5, messageId: 77, outcome: 'DISMISSED' }, // no proactiveEpisodeId
        });

        setTimeout(() => {
            assert.ok(!onEpisodeDismiss.called, 'onEpisodeDismiss must NOT be called for legacy path');
            assert.ok(mockApi.setProactiveOutcome.calledOnce, 'legacy setProactiveOutcome should be called');
            assert.strictEqual(mockApi.setProactiveOutcome.firstCall.args[0], 5);
            assert.strictEqual(mockApi.setProactiveOutcome.firstCall.args[1], 77);
            done();
        }, 10);
    });

    test('without proactiveEpisodeId: _onDidDismissProactive backoff event still fires (legacy path)', (done) => {
        const dismissFired = sinon.stub();
        provider.onDidDismissProactive(dismissFired);

        (provider as unknown as { _handleMessage(msg: unknown): void })._handleMessage({
            type: 'command',
            command: 'messageProactiveOutcome',
            payload: { sessionId: 5, messageId: 77, outcome: 'DISMISSED' },
        });

        setTimeout(() => {
            assert.ok(dismissFired.calledOnce, '_onDidDismissProactive should fire on legacy path');
            done();
        }, 0);
    });

    test('no onEpisodeDismiss callback wired: is a safe no-op (no crash)', () => {
        // No setStruggleCallbacks called for onEpisodeDismiss
        assert.doesNotThrow(() => {
            (provider as unknown as { _handleMessage(msg: unknown): void })._handleMessage({
                type: 'command',
                command: 'messageProactiveOutcome',
                payload: { sessionId: 1, messageId: 99, outcome: 'DISMISSED', proactiveEpisodeId: 'ep-noop' },
            });
        });
    });
});
