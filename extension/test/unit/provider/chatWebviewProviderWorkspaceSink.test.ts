import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';

import { ChatWebviewProvider } from '@extension/provider/chatWebviewProvider';
import { ContextStore } from '@extension/services/iris/context/contextStore';
import { MockExtensionContext } from '@test/unit/mocks/vscodeMocks';

function buildProvider(): { provider: ChatWebviewProvider; sandbox: sinon.SinonSandbox; mockContext: MockExtensionContext } {
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
        undefined,
        contextStore,
    );
    return { provider, sandbox, mockContext };
}

suite('ChatWebviewProvider workspace sink', () => {
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

    test('registerWorkspaceExercise delegates to chatContextManager.registerExerciseAndAutoSelect', () => {
        const ccm = (provider as unknown as { _chatContextManager: { registerExerciseAndAutoSelect: sinon.SinonStub } })._chatContextManager;
        const spy = sandbox.stub(ccm, 'registerExerciseAndAutoSelect');
        const input = { id: 1, title: 'X', source: 'workspace-detected' as const, isWorkspace: true as const };
        provider.registerWorkspaceExercise(input);
        assert.ok(spy.calledOnceWith(input));
    });

    test('clearWorkspaceExercise calls clearStaleWorkspaceContext, clearWorkspaceFlag, postSnapshot in order', () => {
        const internals = provider as unknown as {
            _chatContextManager: { clearStaleWorkspaceContext: sinon.SinonStub };
            _contextStore: { clearWorkspaceFlag: sinon.SinonStub };
            _viewStatePresenter: { postSnapshot: sinon.SinonStub };
        };
        const a = sandbox.stub(internals._chatContextManager, 'clearStaleWorkspaceContext');
        const b = sandbox.stub(internals._contextStore, 'clearWorkspaceFlag');
        const c = sandbox.stub(internals._viewStatePresenter, 'postSnapshot');

        provider.clearWorkspaceExercise();

        assert.ok(a.calledOnce, 'clearStaleWorkspaceContext should fire');
        assert.ok(b.calledOnce, 'clearWorkspaceFlag should fire');
        assert.ok(c.calledOnce, 'postSnapshot should fire');
        assert.ok(a.calledBefore(b), 'clearStale must run before clearFlag');
        assert.ok(b.calledBefore(c), 'clearFlag must run before postSnapshot');
    });
});
