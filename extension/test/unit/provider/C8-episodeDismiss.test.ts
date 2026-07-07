/**
 * C8: ChatWebviewProvider _handleProactiveOutcome routes to onEpisodeDismiss when
 * proactiveEpisodeId is present; legacy setProactiveOutcome persist for a missing id.
 * The dismiss backoff has been removed, so a dismiss records DISMISSED with no
 * memory that changes future behavior (no pause/rate event).
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

    test('legacy dismiss persists DISMISSED with the backoff removed (no dismiss event on the provider)', (done) => {
        // Regression guard for U4: the hidden dismiss backoff is gone. A dismiss on the legacy
        // (no episode id) path must STILL persist DISMISSED, and the provider must no longer expose
        // any backoff-dismiss event (dismissing carries no memory that changes future behavior).
        assert.strictEqual(
            (provider as unknown as { onDidDismissProactive?: unknown }).onDidDismissProactive,
            undefined,
            'the backoff dismiss event must be removed from the provider',
        );

        (provider as unknown as { _handleMessage(msg: unknown): void })._handleMessage({
            type: 'command',
            command: 'messageProactiveOutcome',
            payload: { sessionId: 5, messageId: 77, outcome: 'DISMISSED' },
        });

        setTimeout(() => {
            assert.ok(mockApi.setProactiveOutcome.calledOnce, 'legacy setProactiveOutcome should still persist DISMISSED');
            assert.strictEqual(mockApi.setProactiveOutcome.firstCall.args[2], 'DISMISSED');
            done();
        }, 10);
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
