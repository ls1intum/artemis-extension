/**
 * Live-episode state frame (SetLiveEpisode): the ChatWebviewProvider caches the last
 * value and re-sends it on webview init, so a freshly created webview learns which
 * proactive episode is still live (instead of auto-folding it as an earlier hint).
 * Also: postOptimisticBubble threads the episodeId into the AddMessage payload.
 */
import * as vscode from 'vscode';
import * as assert from 'assert';
import * as sinon from 'sinon';

import { ChatWebviewProvider } from '@extension/provider/chatWebviewProvider';
import { ContextStore } from '@extension/services/iris/context/contextStore';
import { MockExtensionContext } from '@test/unit/mocks/vscodeMocks';

function buildProvider(): { provider: ChatWebviewProvider; sandbox: sinon.SinonSandbox } {
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
    return { provider, sandbox };
}

/** Messages queued for the not-yet-resolved webview (the observable side of _postMessageSafe). */
function pending(provider: ChatWebviewProvider): Array<{ type: string } & Record<string, unknown>> {
    return (provider as unknown as { _pendingMessages: Array<{ type: string } & Record<string, unknown>> })._pendingMessages;
}

suite('ChatWebviewProvider live-episode frame', () => {
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

    test('postLiveEpisode posts a setLiveEpisode frame', () => {
        provider.postLiveEpisode('ep-1');
        const frames = pending(provider).filter(m => m.type === 'setLiveEpisode');
        assert.strictEqual(frames.length, 1);
        assert.strictEqual(frames[0].episodeId, 'ep-1');
    });

    test('setLiveEpisode is a state frame: the pending queue keeps only the latest value', () => {
        provider.postLiveEpisode('ep-1');
        provider.postLiveEpisode(null);
        const frames = pending(provider).filter(m => m.type === 'setLiveEpisode');
        assert.strictEqual(frames.length, 1);
        assert.strictEqual(frames[0].episodeId, null);
    });

    test('resendLiveEpisode re-posts the cached value (webview re-created after delivery)', () => {
        provider.postLiveEpisode('ep-live');
        // Simulate the old webview instance having consumed the queue
        pending(provider).length = 0;

        provider.resendLiveEpisode();

        const frames = pending(provider).filter(m => m.type === 'setLiveEpisode');
        assert.strictEqual(frames.length, 1);
        assert.strictEqual(frames[0].episodeId, 'ep-live');
    });

    test('resendLiveEpisode with nothing delivered yet posts an explicit null frame', () => {
        provider.resendLiveEpisode();
        const frames = pending(provider).filter(m => m.type === 'setLiveEpisode');
        assert.strictEqual(frames.length, 1);
        assert.strictEqual(frames[0].episodeId, null);
    });

    test('postOptimisticBubble threads the episodeId into the AddMessage payload', () => {
        provider.postOptimisticBubble('a hint', 202, 'ep-1');
        const adds = pending(provider).filter(m => m.type === 'addMessage');
        assert.strictEqual(adds.length, 1);
        const message = adds[0].message as Record<string, unknown>;
        assert.strictEqual(message.id, 202);
        assert.strictEqual(message.proactiveEpisodeId, 'ep-1');
    });

    test('postOptimisticBubble without an episodeId stays episode-less (reveal path)', () => {
        provider.postOptimisticBubble('a hint', null);
        const adds = pending(provider).filter(m => m.type === 'addMessage');
        assert.strictEqual(adds.length, 1);
        const message = adds[0].message as Record<string, unknown>;
        assert.strictEqual('proactiveEpisodeId' in message, false);
        assert.strictEqual('id' in message, false);
    });
});
