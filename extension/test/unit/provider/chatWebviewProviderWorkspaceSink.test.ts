import * as vscode from 'vscode';
import * as assert from 'assert';
import * as sinon from 'sinon';

import { ChatWebviewProvider } from '@extension/provider/chatWebviewProvider';
import * as detectionModule from '@extension/services/workspace/workspaceDetectionService';
import { WorkspaceExerciseTracker } from '@extension/services/workspace/workspaceExerciseTracker';
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
    const courseCatalog = {
        onCoursesLoaded: new vscode.EventEmitter<unknown>().event,
        fetch: async () => undefined,
        projection: () => ({ courses: [], exercises: [] }),
        courseTitle: () => undefined,
        exerciseTitle: () => undefined,
    };
    const workspaceTracker = new WorkspaceExerciseTracker();
    const sessionIdentity = { state: { kind: 'anonymous', serverKey: 'https://artemis.test' }, epoch: 0 };
    const provider = new ChatWebviewProvider(
        vscode.Uri.file('/tmp'),
        mockContext as unknown as vscode.ExtensionContext,
        undefined,
        undefined,
        noAi as never,
        registry as never,
        courseCatalog as never,
        undefined,
        workspaceTracker,
        { getAccessTimestamp: () => undefined } as never,
        sessionIdentity as never,
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

    test('registerWorkspaceExercise sets the exercise on the workspace tracker', () => {
        const internals = provider as unknown as {
            _workspaceTracker: { set: sinon.SinonStub };
        };
        const set = sandbox.stub(internals._workspaceTracker, 'set');
        const input = { id: 1, title: 'X', courseId: 9 };

        provider.registerWorkspaceExercise(input);

        assert.ok(set.calledOnceWith(input));
    });

    test('the detected exercise reaches the wire, so the picker can badge it', () => {
        // The picker derives its "Workspace" badge from `workspaceExerciseId`
        // alone (`ContextPicker.tsx`). Between Tasks 7 and 9 the presenter
        // still read the persisted store, which no longer received workspace
        // writes, so the field was permanently undefined and the badge dark.
        const posted: Array<{ type?: string; state?: { workspaceExerciseId?: number } }> = [];
        sandbox.stub(
            provider as unknown as { _postMessageSafe: (m: unknown) => void },
            '_postMessageSafe',
        ).callsFake((m: unknown) => { posted.push(m as { type?: string }); });

        provider.registerWorkspaceExercise({ id: 77, title: 'BFS', courseId: 9 });
        (provider as unknown as { _viewStatePresenter: { postSnapshot(): void } })
            ._viewStatePresenter.postSnapshot();

        const state = posted.filter(m => m?.type === 'updateIrisState').at(-1)?.state;
        assert.strictEqual(state?.workspaceExerciseId, 77);
    });

    test('clearWorkspaceExercise calls the tracker clear then postSnapshot', () => {
        const internals = provider as unknown as {
            _workspaceTracker: { clear: sinon.SinonStub };
            _viewStatePresenter: { postSnapshot: sinon.SinonStub };
        };
        const b = sandbox.stub(internals._workspaceTracker, 'clear');
        const c = sandbox.stub(internals._viewStatePresenter, 'postSnapshot');

        provider.clearWorkspaceExercise();

        assert.ok(b.calledOnce, 'the tracker clear() should fire');
        assert.ok(c.calledOnce, 'postSnapshot should fire');
        assert.ok(b.calledBefore(c), 'clear must run before postSnapshot');
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
