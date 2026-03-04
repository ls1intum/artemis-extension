import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import { ArtemisWebviewProvider } from '../../../src/provider/artemisWebviewProvider';
import type { BuildErrorCodeLensProvider } from '../../../src/provider/buildErrorCodeLensProvider';
import { MockExtensionContext } from '../mocks/vscodeMocks';
import { AuthManager } from '../../../src/auth';
import { ArtemisApiService } from '../../../src/api';
import { ArtemisWebsocketService } from '../../../src/services';

class MockAuthManager extends AuthManager {
    constructor(context: vscode.ExtensionContext) {
        super(context);
    }
}

class MockArtemisApiService extends ArtemisApiService {
    constructor(authManager: AuthManager) {
        super(authManager);
    }

    async getExerciseDetails(exerciseId: number) {
        return { id: exerciseId, title: 'Test Exercise' };
    }
}

class MockArtemisWebsocketService extends ArtemisWebsocketService {
    constructor(authManager: AuthManager) {
        super(authManager);
    }
    registerMessageHandler(handler: any) { }
    isConnected() { return true; }
    connect() { return Promise.resolve(); }
}

class MockWebview implements vscode.Webview {
    options: vscode.WebviewOptions = {};
    html: string = '';
    onDidReceiveMessage: vscode.Event<any> = new vscode.EventEmitter<any>().event;
    postMessage(message: any): Thenable<boolean> {
        return Promise.resolve(true);
    }
    asWebviewUri(localResource: vscode.Uri): vscode.Uri {
        return localResource;
    }
    cspSource: string = '';
}

/**
 * A controllable webview that exposes an emitter for simulating incoming messages
 * and captures outgoing postMessage calls.
 */
class SpyWebview extends MockWebview {
    public sentMessages: any[] = [];
    private _receiveEmitter = new vscode.EventEmitter<any>();
    override onDidReceiveMessage: vscode.Event<any> = this._receiveEmitter.event;

    override postMessage(message: any): Thenable<boolean> {
        this.sentMessages.push(message);
        return Promise.resolve(true);
    }

    simulateMessage(message: any): void {
        this._receiveEmitter.fire(message);
    }
}

class MockWebviewView implements vscode.WebviewView {
    webview: vscode.Webview = new MockWebview();
    viewType: string = 'mock';
    title?: string;
    description?: string;
    badge?: vscode.ViewBadge;
    show(preserveFocus?: boolean): void { }
    onDidChangeVisibility: vscode.Event<void> = new vscode.EventEmitter<void>().event;
    onDidDispose: vscode.Event<void> = new vscode.EventEmitter<void>().event;
    visible: boolean = true;
}

/**
 * A controllable webview view that allows simulating panel hide/show transitions.
 */
class ControllableWebviewView implements vscode.WebviewView {
    webview: vscode.Webview;
    viewType: string = 'mock';
    title?: string;
    description?: string;
    badge?: vscode.ViewBadge;
    private _visibilityEmitter = new vscode.EventEmitter<void>();
    private _disposeEmitter = new vscode.EventEmitter<void>();
    onDidChangeVisibility: vscode.Event<void> = this._visibilityEmitter.event;
    onDidDispose: vscode.Event<void> = this._disposeEmitter.event;
    visible: boolean = true;

    constructor(spyWebview?: SpyWebview) {
        this.webview = spyWebview ?? new MockWebview();
    }

    show(preserveFocus?: boolean): void {}

    simulateHide(): void {
        this.visible = false;
        this._visibilityEmitter.fire();
    }

    simulateShow(): void {
        this.visible = true;
        this._visibilityEmitter.fire();
    }
}

suite('ArtemisWebviewProvider Test Suite', () => {
    let provider: ArtemisWebviewProvider;
    let mockContext: MockExtensionContext;
    let mockAuthManager: MockAuthManager;
    let mockApiService: MockArtemisApiService;

    setup(() => {
        mockContext = new MockExtensionContext();
        mockAuthManager = new MockAuthManager(mockContext);
        mockApiService = new MockArtemisApiService(mockAuthManager);

        provider = new ArtemisWebviewProvider(
            vscode.Uri.file('/'),
            mockContext,
            mockAuthManager,
            mockApiService
        );
    });

    test('should be instantiated', () => {
        assert.ok(provider);
    });

    test('should set websocket service', () => {
        const mockWebsocket = new MockArtemisWebsocketService(mockAuthManager);
        provider.setWebsocketService(mockWebsocket);
    });

    test('should register websocket handler and connect when opening exercise', async () => {
        const mockWebsocket = new MockArtemisWebsocketService(mockAuthManager);
        let handlerRegistered = false;
        let connectCalls = 0;
        mockWebsocket.registerMessageHandler = (handler: any) => {
            handlerRegistered = !!handler;
        };
        mockWebsocket.isConnected = () => false;
        mockWebsocket.connect = async () => {
            connectCalls++;
        };

        provider.setWebsocketService(mockWebsocket);

        const mockView = new MockWebviewView();
        provider.resolveWebviewView(mockView, {} as any, {} as any);
        await provider.openExerciseDetails(1);

        assert.ok(handlerRegistered, 'websocket handler should be registered');
        assert.strictEqual(connectCalls, 1, 'connect should be called when not connected');
    });

    test('should set auth context updater', () => {
        const updater = async (auth: boolean) => { };
        const originalHandler: any = (provider as any)._messageHandler;
        let forwarded: any;
        (provider as any)._messageHandler = {
            setAuthContextUpdater: (cb: any) => {
                forwarded = cb;
            },
            setWebsocketService: () => { }
        };

        provider.setAuthContextUpdater(updater);
        assert.strictEqual(forwarded, updater, 'auth updater should be passed to message handler');

        (provider as any)._messageHandler = originalHandler;
    });

    test('should set build diagnostics', () => {
        const codeLens = {} as unknown as BuildErrorCodeLensProvider;
        provider.setBuildDiagnostics(codeLens);
    });

    test('should resolve webview view', async () => {
        const mockView = new MockWebviewView();
        const mockResolveContext = {} as vscode.WebviewViewResolveContext;
        const mockToken = {} as vscode.CancellationToken;

        await provider.resolveWebviewView(mockView, mockResolveContext, mockToken);

        assert.ok(mockView.webview.html);
        assert.ok(mockView.webview.options.enableScripts);
    });

    test('should open exercise details', async () => {
        const mockView = new MockWebviewView();
        const mockResolveContext = {} as vscode.WebviewViewResolveContext;
        const mockToken = {} as vscode.CancellationToken;

        await provider.resolveWebviewView(mockView, mockResolveContext, mockToken);

        await provider.openExerciseDetails(1);

        assert.ok(mockView.webview.html);
    });

    test('should open json in editor', async () => {
        const data = { test: 'data' };
        await provider.openJsonInEditor(data);
    });

    test('should render', async () => {
        const mockView = new MockWebviewView();
        await provider.resolveWebviewView(mockView, {} as any, {} as any);
        await provider.render();
        assert.ok(mockView.webview.html);
    });
});

suite('Panel hide/show state persistence', () => {
    let provider: ArtemisWebviewProvider;
    let mockContext: MockExtensionContext;
    let mockAuthManager: MockAuthManager;
    let mockApiService: MockArtemisApiService;
    let controllableView: ControllableWebviewView;
    let spyWebview: SpyWebview;
    let sandbox: sinon.SinonSandbox;

    setup(async () => {
        sandbox = sinon.createSandbox();

        mockContext = new MockExtensionContext();
        mockAuthManager = new MockAuthManager(mockContext);
        mockApiService = new MockArtemisApiService(mockAuthManager);

        // Stub hasAuthCookie to return true (authenticated state) by default
        sandbox.stub(mockAuthManager, 'hasAuthCookie').resolves(true);

        provider = new ArtemisWebviewProvider(
            vscode.Uri.file('/'),
            mockContext,
            mockAuthManager,
            mockApiService
        );

        spyWebview = new SpyWebview();
        controllableView = new ControllableWebviewView(spyWebview);

        // Wire up the provider
        await provider.resolveWebviewView(controllableView, {} as any, {} as any);

        // Simulate the React webview sending the 'ready' signal so _webviewReady = true
        spyWebview.simulateMessage({ type: 'ready' });
        // Flush microtasks
        await Promise.resolve();
    });

    teardown(() => {
        sandbox.restore();
    });

    test('resolveWebviewView registers an onDidChangeVisibility listener', async () => {
        // If the listener is registered, simulateShow should trigger sendInitData.
        // We verify this indirectly by spying on sendInitData.
        const resendSpy = sandbox.spy(provider, 'sendInitData');
        controllableView.simulateShow();
        await Promise.resolve();
        await Promise.resolve(); // flush async body

        assert.ok(resendSpy.called, 'onDidChangeVisibility listener should be registered and trigger sendInitData');
    });

    test('sendInitData is called when panel becomes visible', async () => {
        const resendSpy = sandbox.spy(provider, 'sendInitData');

        // Hide first, then show
        controllableView.simulateHide();
        await Promise.resolve();
        controllableView.simulateShow();
        // Flush the async IIFE inside the visibility listener
        await Promise.resolve();
        await Promise.resolve();

        assert.ok(resendSpy.calledOnce, 'sendInitData should be called exactly once on show');
    });

    test('sendInitData is NOT called when panel becomes hidden', async () => {
        const resendSpy = sandbox.spy(provider, 'sendInitData');

        controllableView.simulateHide();
        await Promise.resolve();

        assert.strictEqual(resendSpy.callCount, 0, 'sendInitData should not be called when panel is hidden');
    });

    test('_webviewReady stays true across hide/show (retainContextWhenHidden behavior)', async () => {
        // After setup, _webviewReady should be true from the ready signal
        assert.strictEqual((provider as any)._webviewReady, true, '_webviewReady should be true after ready signal');

        // Hide and show the panel
        controllableView.simulateHide();
        await Promise.resolve();
        controllableView.simulateShow();
        await Promise.resolve();
        await Promise.resolve();

        // _webviewReady must NOT be reset during hide/show
        assert.strictEqual((provider as any)._webviewReady, true, '_webviewReady should remain true after hide/show');
    });

    test('messages post directly to webview when _webviewReady is true after hide/show', async () => {
        // Clear messages captured during setup
        spyWebview.sentMessages = [];

        // Hide and show panel
        controllableView.simulateHide();
        await Promise.resolve();
        controllableView.simulateShow();
        await Promise.resolve();
        await Promise.resolve();

        // The sendInitData call should post a message directly (not queue it)
        // In the default 'login' state sendInitData does nothing, so we need to
        // set state to dashboard first and provide minimal courses data
        (provider as any)._appStateManager._currentState = 'dashboard';
        (provider as any)._appStateManager._coursesData = { courses: [] };

        spyWebview.sentMessages = [];
        controllableView.simulateShow();
        await Promise.resolve();
        await Promise.resolve();

        // A dashboardInit message should be posted directly (not queued in _pendingMessages)
        const dashboardMsg = spyWebview.sentMessages.find((m: any) => m.type === 'dashboardInit');
        assert.ok(dashboardMsg, 'dashboardInit message should be sent directly to webview (not queued)');
        assert.strictEqual((provider as any)._pendingMessages.length, 0, 'no messages should be queued');
    });

    test('auth expiry while hidden routes to login on re-show', async () => {
        // Simulate being authenticated in dashboard state
        (provider as any)._appStateManager._currentState = 'dashboard';

        // Now stub hasAuthCookie to return false (auth expired while hidden)
        (mockAuthManager.hasAuthCookie as sinon.SinonStub).resolves(false);

        spyWebview.sentMessages = [];
        controllableView.simulateShow();
        await Promise.resolve();
        await Promise.resolve();

        // Should send hideLoading and setServerUrl to transition to login
        const hideLoadingMsg = spyWebview.sentMessages.find((m: any) => m.type === 'hideLoading');
        assert.ok(hideLoadingMsg, 'hideLoading should be sent when auth has expired on re-show');
    });
});
