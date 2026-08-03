import * as vscode from 'vscode';
import * as assert from 'assert';
import * as sinon from 'sinon';

import { ChatWebviewProvider } from '@extension/provider/chatWebviewProvider';
import { ContextStore } from '@extension/services/iris/context/contextStore';
import * as detectionModule from '@extension/services/workspace/workspaceDetectionService';
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

    test('registerWorkspaceExercise registers the exercise and re-posts the snapshot', () => {
        const internals = provider as unknown as {
            _contextStore: { registerExercise: sinon.SinonStub };
            _viewStatePresenter: { postSnapshot: sinon.SinonStub };
        };
        const register = sandbox.stub(internals._contextStore, 'registerExercise');
        const post = sandbox.stub(internals._viewStatePresenter, 'postSnapshot');
        const input = { id: 1, title: 'X', source: 'workspace-detected' as const, isWorkspace: true as const };

        provider.registerWorkspaceExercise(input);

        assert.ok(register.calledOnceWith(input));
        assert.ok(post.calledOnce, 'postSnapshot should fire');
        assert.ok(register.calledBefore(post), 'the store must be updated before the snapshot is posted');
    });

    test('clearWorkspaceExercise calls clearWorkspaceFlag then postSnapshot', () => {
        const internals = provider as unknown as {
            _contextStore: { clearWorkspaceFlag: sinon.SinonStub };
            _viewStatePresenter: { postSnapshot: sinon.SinonStub };
        };
        const b = sandbox.stub(internals._contextStore, 'clearWorkspaceFlag');
        const c = sandbox.stub(internals._viewStatePresenter, 'postSnapshot');

        provider.clearWorkspaceExercise();

        assert.ok(b.calledOnce, 'clearWorkspaceFlag should fire');
        assert.ok(c.calledOnce, 'postSnapshot should fire');
        assert.ok(b.calledBefore(c), 'clearFlag must run before postSnapshot');
    });
});

suite('ChatWebviewProvider stops detecting workspace', () => {
    let sandbox: sinon.SinonSandbox;
    let detectStub: sinon.SinonStub;
    let onDidChangeFoldersStub: sinon.SinonStub;
    let provider: ChatWebviewProvider;

    setup(() => {
        const built = buildProvider();
        provider = built.provider;
        sandbox = built.sandbox;
        detectStub = sandbox.stub(detectionModule, 'detectAndRegisterWorkspaceExercise').resolves();
        onDidChangeFoldersStub = sandbox.stub(vscode.workspace, 'onDidChangeWorkspaceFolders').returns({ dispose: () => undefined });
    });

    teardown(() => {
        provider.dispose();
        sandbox.restore();
    });

    function makeWebviewStub(): vscode.WebviewView {
        const webview = {
            options: {} as vscode.WebviewOptions,
            html: '',
            onDidReceiveMessage: () => ({ dispose: () => undefined }),
            asWebviewUri: (u: vscode.Uri) => u,
            cspSource: 'https://example',
        } as unknown as vscode.Webview;
        return {
            webview,
            onDidDispose: () => ({ dispose: () => undefined }),
            onDidChangeVisibility: () => ({ dispose: () => undefined }),
            visible: false,
            show: () => undefined,
            title: '',
            description: '',
            badge: undefined,
            viewType: 'irisChat',
        } as unknown as vscode.WebviewView;
    }

    test('resolveWebviewView does NOT register onDidChangeWorkspaceFolders', () => {
        provider.resolveWebviewView(makeWebviewStub(), {} as never, {} as never);
        assert.ok(!onDidChangeFoldersStub.called, 'resolveWebviewView must not subscribe to workspace folder changes');
    });

    test('the provider never calls detectAndRegisterWorkspaceExercise (resolveWebviewView path)', async () => {
        provider.resolveWebviewView(makeWebviewStub(), {} as never, {} as never);
        await Promise.resolve();
        await Promise.resolve();
        assert.strictEqual(detectStub.callCount, 0, 'resolveWebviewView path must not detect workspace');
    });

    test('_sendInitData does not invoke workspace detection', async () => {
        // _sendInitData is private but is the path that previously called detection.
        // Cast through unknown to invoke it directly — this is a regression guard,
        // documenting that the detection call has been deleted from that codepath.
        await (provider as unknown as { _sendInitData: () => Promise<void> })._sendInitData();
        assert.strictEqual(detectStub.callCount, 0, '_sendInitData must not detect workspace');
    });
});
