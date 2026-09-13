import * as vscode from 'vscode';
import * as assert from 'assert';
import * as sinon from 'sinon';

import { ArtemisApiService } from '@extension/api';
import { ArtemisWebviewProvider } from '@extension/provider/artemisWebviewProvider';
import type { BuildErrorCodeLensProvider } from '@extension/provider/buildErrorCodeLensProvider';
import { AuthManager } from '@extension/services/auth';
import { AuthCancellationService } from '@extension/services/auth/authCancellationService';
import { HandoverFailureStore } from '@extension/services/auth/handoverFailureStore';
import { OidcLoginService } from '@extension/services/auth/oidcLoginService';
import { CourseAccessStorageService } from '@extension/services/courseAccessStorageService';
import { TelemetryManager } from '@extension/services/telemetry';
import { createProviderRegistry } from '@extension/services/ui/providerRegistry';
import { ArtemisWebsocketService } from '@extension/services/websocket';
import { MockExtensionContext } from '@test/unit/mocks/vscodeMocks';

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
    registerMessageHandler(_handler: any) { }
    isConnected() { return true; }
    connect() { return Promise.resolve(); }
}

class MockWebview implements vscode.Webview {
    options: vscode.WebviewOptions = {};
    html: string = '';
    onDidReceiveMessage: vscode.Event<any> = new vscode.EventEmitter<any>().event;
    postMessage(_message: any): Thenable<boolean> {
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
    show(_preserveFocus?: boolean): void { }
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

    show(_preserveFocus?: boolean): void {}

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
    let suiteSandbox: sinon.SinonSandbox;

    setup(() => {
        // Stub command registration so concurrent TelemetryManager
        // instances in this suite do not collide on the global registry.
        suiteSandbox = sinon.createSandbox();
        suiteSandbox.stub(vscode.commands, 'registerCommand').returns(new vscode.Disposable(() => { /* noop */ }));

        mockContext = new MockExtensionContext();
        mockAuthManager = new MockAuthManager(mockContext);
        mockApiService = new MockArtemisApiService(mockAuthManager);

        const mockWebsocket = new MockArtemisWebsocketService(mockAuthManager);
        const mockCodeLens = {} as unknown as BuildErrorCodeLensProvider;
        const mockTelemetry = new TelemetryManager();
        const mockUpdateAuth = async (_isAuthenticated: boolean) => {};

        const oidcLoginService = new OidcLoginService(mockContext, mockAuthManager, mockApiService);
        provider = new ArtemisWebviewProvider({
            extensionUri: vscode.Uri.file('/'),
            extensionContext: mockContext,
            authManager: mockAuthManager,
            handoverFailures: new HandoverFailureStore(),
            artemisApi: mockApiService,
            oidcLoginService,
            authCancellation: new AuthCancellationService(oidcLoginService),
            providerRegistry: createProviderRegistry(),
            websocketService: mockWebsocket,
            buildErrorCodeLensProvider: mockCodeLens,
            telemetryManager: mockTelemetry,
            updateAuthContext: mockUpdateAuth,
            courseAccessStorage: new CourseAccessStorageService(mockContext.globalState, () => null, () => 0),
        });
    });

    teardown(() => {
        suiteSandbox.restore();
    });

    test('should be instantiated', () => {
        assert.ok(provider);
    });

    test('should resolve webview view', async () => {
        const mockView = new MockWebviewView();
        const mockResolveContext = {} as vscode.WebviewViewResolveContext;
        const mockToken = {} as vscode.CancellationToken;

        await provider.resolveWebviewView(mockView, mockResolveContext, mockToken);

        assert.ok(mockView.webview.html);
        assert.ok(mockView.webview.options.enableScripts);
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
        sandbox.stub(vscode.commands, 'registerCommand').returns(new vscode.Disposable(() => { /* noop */ }));

        mockContext = new MockExtensionContext();
        mockAuthManager = new MockAuthManager(mockContext);
        mockApiService = new MockArtemisApiService(mockAuthManager);

        sandbox.stub(mockAuthManager, 'hasAuthToken').resolves(true);

        const mockWebsocket = new MockArtemisWebsocketService(mockAuthManager);
        const mockCodeLens = {} as unknown as BuildErrorCodeLensProvider;
        const mockTelemetry = new TelemetryManager();
        const mockUpdateAuth = async (_isAuthenticated: boolean) => {};

        const oidcLoginService = new OidcLoginService(mockContext, mockAuthManager, mockApiService);
        provider = new ArtemisWebviewProvider({
            extensionUri: vscode.Uri.file('/'),
            extensionContext: mockContext,
            authManager: mockAuthManager,
            handoverFailures: new HandoverFailureStore(),
            artemisApi: mockApiService,
            oidcLoginService,
            authCancellation: new AuthCancellationService(oidcLoginService),
            providerRegistry: createProviderRegistry(),
            websocketService: mockWebsocket,
            buildErrorCodeLensProvider: mockCodeLens,
            telemetryManager: mockTelemetry,
            updateAuthContext: mockUpdateAuth,
            courseAccessStorage: new CourseAccessStorageService(mockContext.globalState, () => null, () => 0),
        });

        spyWebview = new SpyWebview();
        controllableView = new ControllableWebviewView(spyWebview);

        await provider.resolveWebviewView(controllableView, {} as any, {} as any);

        // The React webview's 'ready' signal is what sets _webviewReady.
        spyWebview.simulateMessage({ type: 'ready' });
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
        assert.strictEqual((provider as any)._webviewReady, true, '_webviewReady should be true after ready signal');

        controllableView.simulateHide();
        await Promise.resolve();
        controllableView.simulateShow();
        await Promise.resolve();
        await Promise.resolve();

        assert.strictEqual((provider as any)._webviewReady, true, '_webviewReady should remain true after hide/show');
    });

    test('messages post directly to webview when _webviewReady is true after hide/show', async () => {
        // Clear messages captured during setup
        spyWebview.sentMessages = [];

        controllableView.simulateHide();
        await Promise.resolve();
        controllableView.simulateShow();
        await Promise.resolve();
        await Promise.resolve();

        // sendInitData does nothing in the default 'login' state, so the state
        // and a minimal courses payload have to be set first.
        (provider as any)._appStateManager._currentState = 'dashboard';
        (provider as any)._appStateManager._coursesData = { courses: [] };

        spyWebview.sentMessages = [];
        controllableView.simulateShow();
        await Promise.resolve();
        await Promise.resolve();

        const dashboardMsg = spyWebview.sentMessages.find((m: any) => m.type === 'dashboardInit');
        assert.ok(dashboardMsg, 'dashboardInit message should be sent directly to webview (not queued)');
        assert.strictEqual((provider as any)._pendingMessages.length, 0, 'no messages should be queued');
    });

    test('auth expiry while hidden routes to login on re-show', async () => {
        // Simulate being authenticated in dashboard state
        (provider as any)._appStateManager._currentState = 'dashboard';

        // Now stub hasAuthToken to return false (auth expired while hidden)
        (mockAuthManager.hasAuthToken as sinon.SinonStub).resolves(false);

        controllableView.simulateShow();
        await Promise.resolve();
        await Promise.resolve();

        // showLogin() transitions state to 'login' and calls render() which resets _webviewReady.
        // postServerUrl() message is queued (not posted directly) because render() resets readiness.
        assert.strictEqual(
            (provider as any)._appStateManager._currentState, 'login',
            'state should transition to login when auth has expired on re-show'
        );
    });
});
