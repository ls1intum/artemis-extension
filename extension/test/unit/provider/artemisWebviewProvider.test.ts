import * as vscode from 'vscode';
import * as assert from 'assert';
import * as sinon from 'sinon';

import { ExtensionMsg, WebviewCmd, WebviewMsgType } from '@shared/messageContracts';

import { ArtemisApiService } from '@extension/api';
import { ArtemisWebviewProvider } from '@extension/provider/artemisWebviewProvider';
import type { BuildErrorCodeLensProvider } from '@extension/provider/buildErrorCodeLensProvider';
import { AuthManager } from '@extension/services/auth';
import { AuthCancellationService } from '@extension/services/auth/authCancellationService';
import { HandoverFailureStore } from '@extension/services/auth/handoverFailureStore';
import { OidcLoginService } from '@extension/services/auth/oidcLoginService';
import { CourseAccessStorageService } from '@extension/services/courseAccessStorageService';
import { VsCodeSensorHub } from '@extension/services/sensing';
import { StruggleCoordinator } from '@extension/services/struggle/struggleCoordinator';
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
        // Stub command registration so the services constructed in this suite do not
        // collide on the global command registry across test-scoped instances.
        suiteSandbox = sinon.createSandbox();
        suiteSandbox.stub(vscode.commands, 'registerCommand').returns(new vscode.Disposable(() => { /* noop */ }));

        mockContext = new MockExtensionContext();
        mockAuthManager = new MockAuthManager(mockContext);
        mockApiService = new MockArtemisApiService(mockAuthManager);

        const mockWebsocket = new MockArtemisWebsocketService(mockAuthManager);
        const mockCodeLens = {} as unknown as BuildErrorCodeLensProvider;
        const mockCoordinator = new StruggleCoordinator({ hub: new VsCodeSensorHub(), alertSink: { deliver: () => { /* noop */ } }, detectionConsent: { isGranted: () => true, onDidChange: new vscode.EventEmitter<void>().event } });
        const mockUpdateAuth = async (_isAuthenticated: boolean) => {};
        const fakeNoAi = { onNoAiStatusChanged: () => ({ dispose() {} }), dispose() {} } as any;

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
            noAiDetectionService: fakeNoAi,
            buildErrorCodeLensProvider: mockCodeLens,
            struggleCoordinator: mockCoordinator,
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
    let noAiCb: (v: boolean) => void = () => {};

    setup(async () => {
        sandbox = sinon.createSandbox();
        sandbox.stub(vscode.commands, 'registerCommand').returns(new vscode.Disposable(() => { /* noop */ }));

        mockContext = new MockExtensionContext();
        mockAuthManager = new MockAuthManager(mockContext);
        mockApiService = new MockArtemisApiService(mockAuthManager);

        sandbox.stub(mockAuthManager, 'hasAuthToken').resolves(true);

        const mockWebsocket = new MockArtemisWebsocketService(mockAuthManager);
        const mockCodeLens = {} as unknown as BuildErrorCodeLensProvider;
        const mockCoordinator = new StruggleCoordinator({ hub: new VsCodeSensorHub(), alertSink: { deliver: () => { /* noop */ } }, detectionConsent: { isGranted: () => true, onDidChange: new vscode.EventEmitter<void>().event } });
        const mockUpdateAuth = async (_isAuthenticated: boolean) => {};
        const fakeNoAi = {
            onNoAiStatusChanged: (cb: (value: boolean) => void) => { noAiCb = cb; return { dispose() {} }; },
            dispose() {},
        } as any;

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
            noAiDetectionService: fakeNoAi,
            buildErrorCodeLensProvider: mockCodeLens,
            struggleCoordinator: mockCoordinator,
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

    test('a proactiveCodeEgress change posts updateProactiveConsent to the webview (both directions)', async () => {
        const cfg = () => vscode.workspace.getConfiguration('artemis.iris');
        const prev = cfg().get('proactiveCodeEgress');
        const awaitConsentMsg = async () => {
            // Poll: the config event is async in the extension host.
            const deadline = Date.now() + 2000;
            while (Date.now() < deadline) {
                if (spyWebview.sentMessages.some(m => m.type === 'updateProactiveConsent')) { return true; }
                await new Promise(r => setTimeout(r, 50));
            }
            return false;
        };
        try {
            // Normalize first (no assertion): a leaked 'enabled' from another test would make the
            // grant-flip below a config no-op that fires no event.
            await cfg().update('proactiveCodeEgress', 'ask', vscode.ConfigurationTarget.Global);

            spyWebview.sentMessages.length = 0;
            await cfg().update('proactiveCodeEgress', 'enabled', vscode.ConfigurationTarget.Global);
            assert.ok(await awaitConsentMsg(), 'expected updateProactiveConsent after granting the consent');

            spyWebview.sentMessages.length = 0;
            await cfg().update('proactiveCodeEgress', 'disabled', vscode.ConfigurationTarget.Global);
            assert.ok(await awaitConsentMsg(), 'expected updateProactiveConsent after revoking the consent');
        } finally {
            await cfg().update('proactiveCodeEgress', prev, vscode.ConfigurationTarget.Global);
        }
    });

    test('a .noai status change posts updateNoAiStatus to the webview (both directions)', async () => {
        spyWebview.sentMessages.length = 0;
        noAiCb(true);
        assert.ok(spyWebview.sentMessages.some(m => m.type === 'updateNoAiStatus'), 'expected updateNoAiStatus after .noai appears');
        spyWebview.sentMessages.length = 0;
        noAiCb(false);
        assert.ok(spyWebview.sentMessages.some(m => m.type === 'updateNoAiStatus'), 'expected updateNoAiStatus after .noai disappears');
    });
});

suite('The view header names the Artemis server', () => {
    let provider: ArtemisWebviewProvider;
    let mockContext: MockExtensionContext;
    let view: ControllableWebviewView;
    let sandbox: sinon.SinonSandbox;
    let fireConfigChange: ((event: vscode.ConfigurationChangeEvent) => void) | undefined;

    setup(async () => {
        sandbox = sinon.createSandbox();
        sandbox.stub(vscode.commands, 'registerCommand').returns(new vscode.Disposable(() => { /* noop */ }));

        // Captured before the provider is built, because it subscribes in its constructor.
        // Several listeners register; a fired event is handed to every one of them.
        const listeners: Array<(event: vscode.ConfigurationChangeEvent) => void> = [];
        sandbox.stub(vscode.workspace, 'onDidChangeConfiguration').callsFake(((cb: any) => {
            listeners.push(cb);
            return new vscode.Disposable(() => { /* noop */ });
        }) as any);
        fireConfigChange = (event) => { for (const cb of [...listeners]) { cb(event); } };

        mockContext = new MockExtensionContext();
        const mockAuthManager = new MockAuthManager(mockContext);
        const mockApiService = new MockArtemisApiService(mockAuthManager);
        const mockWebsocket = new MockArtemisWebsocketService(mockAuthManager);
        const mockCoordinator = new StruggleCoordinator({ hub: new VsCodeSensorHub(), alertSink: { deliver: () => { /* noop */ } }, detectionConsent: { isGranted: () => true, onDidChange: new vscode.EventEmitter<void>().event } });
        const fakeNoAi = { onNoAiStatusChanged: () => ({ dispose() {} }), dispose() {} } as any;
        const oidc = new OidcLoginService(mockContext, mockAuthManager, mockApiService);

        provider = new ArtemisWebviewProvider({
            extensionUri: vscode.Uri.file('/'),
            extensionContext: mockContext,
            authManager: mockAuthManager,
            oidcLoginService: oidc,
            authCancellation: new AuthCancellationService(oidc),
            handoverFailures: new HandoverFailureStore(),
            courseAccessStorage: new CourseAccessStorageService(mockContext.globalState, () => null, () => 0),
            artemisApi: mockApiService,
            providerRegistry: createProviderRegistry(),
            websocketService: mockWebsocket,
            noAiDetectionService: fakeNoAi,
            buildErrorCodeLensProvider: {} as unknown as BuildErrorCodeLensProvider,
            struggleCoordinator: mockCoordinator,
            updateAuthContext: async (_isAuthenticated: boolean) => {},
        });

        view = new ControllableWebviewView();
        await provider.resolveWebviewView(view, {} as any, {} as any);
    });

    teardown(() => {
        sandbox.restore();
    });

    test('the host is written as the view description when the view is resolved', () => {
        // The default when nothing is configured, reduced to what the header can show.
        assert.strictEqual(view.description, 'artemis.tum.de');
    });

    test('changing artemis.serverUrl rewrites it without waiting for a new view', () => {
        sandbox.stub(vscode.workspace, 'getConfiguration').returns({
            get: (key: string) => (key === 'serverUrl' ? 'https://artemis-test2.artemis.cit.tum.de/' : undefined),
        } as unknown as vscode.WorkspaceConfiguration);

        fireConfigChange?.({ affectsConfiguration: (section: string) => section === 'artemis.serverUrl' } as vscode.ConfigurationChangeEvent);

        assert.strictEqual(view.description, 'artemis-test2.artemis.cit.tum.de', 'trailing slash dropped, host only');
    });

    test('the login view is told the server as part of its init data', () => {
        // The proof that the login screen can name it at all: the view asks for init on
        // ready, and the answer for the login route carries the server URL.
        const spy = new SpyWebview();
        const readyView = new ControllableWebviewView(spy);
        return provider.resolveWebviewView(readyView, {} as any, {} as any).then(() => {
            spy.simulateMessage({ type: 'ready' });

            const sent = spy.sentMessages.filter(m => m?.type === 'setServerUrl');
            assert.strictEqual(sent.length, 1, 'exactly one setServerUrl on ready');
            assert.ok(typeof sent[0].serverUrl === 'string' && sent[0].serverUrl.length > 0);
        });
    });

    test('a server change reaches the open login page, not just the header', async () => {
        // The picker writes the setting and nothing re-renders the login page, so without this
        // the page went on naming the server the user just switched away from.
        const spy = new SpyWebview();
        const openView = new ControllableWebviewView(spy);
        await provider.resolveWebviewView(openView, {} as any, {} as any);
        spy.simulateMessage({ type: 'ready' });
        const before = spy.sentMessages.filter(m => m?.type === 'setServerUrl').length;

        sandbox.stub(vscode.workspace, 'getConfiguration').returns({
            get: (key: string) => (key === 'serverUrl' ? 'https://artemis-test2.artemis.cit.tum.de' : undefined),
        } as unknown as vscode.WorkspaceConfiguration);
        fireConfigChange?.({ affectsConfiguration: (section: string) => section === 'artemis.serverUrl' } as vscode.ConfigurationChangeEvent);

        const sent = spy.sentMessages.filter(m => m?.type === 'setServerUrl');
        assert.strictEqual(sent.length, before + 1, 'one more, sent by the setting change itself');
        assert.strictEqual(sent[sent.length - 1].serverUrl, 'https://artemis-test2.artemis.cit.tum.de');
    });

    test('an unrelated setting is not mistaken for it', () => {
        sandbox.stub(vscode.workspace, 'getConfiguration').returns({
            get: () => 'https://somewhere.else',
        } as unknown as vscode.WorkspaceConfiguration);

        fireConfigChange?.({ affectsConfiguration: (section: string) => section === 'artemis.developerMode' } as vscode.ConfigurationChangeEvent);

        assert.strictEqual(view.description, 'artemis.tum.de', 'untouched');
    });
});

suite('Nudge banner replay and cache-clear', () => {
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
        const mockCoordinator = new StruggleCoordinator({ hub: new VsCodeSensorHub(), alertSink: { deliver: () => { /* noop */ } }, detectionConsent: { isGranted: () => true, onDidChange: new vscode.EventEmitter<void>().event } });
        const mockUpdateAuth = async (_isAuthenticated: boolean) => {};
        const fakeNoAi = { onNoAiStatusChanged: () => ({ dispose() {} }), dispose() {} } as any;

        const oidc = new OidcLoginService(mockContext, mockAuthManager, mockApiService);
        provider = new ArtemisWebviewProvider({
            extensionUri: vscode.Uri.file('/'),
            extensionContext: mockContext,
            authManager: mockAuthManager,
            oidcLoginService: oidc,
            authCancellation: new AuthCancellationService(oidc),
            handoverFailures: new HandoverFailureStore(),
            courseAccessStorage: new CourseAccessStorageService(mockContext.globalState, () => null, () => 0),
            artemisApi: mockApiService,
            providerRegistry: createProviderRegistry(),
            websocketService: mockWebsocket,
            noAiDetectionService: fakeNoAi,
            buildErrorCodeLensProvider: mockCodeLens,
            struggleCoordinator: mockCoordinator,
            updateAuthContext: mockUpdateAuth,
        });

        spyWebview = new SpyWebview();
        controllableView = new ControllableWebviewView(spyWebview);
        await provider.resolveWebviewView(controllableView, {} as any, {} as any);
    });

    teardown(() => {
        sandbox.restore();
    });

    const showBannerMessages = () => spyWebview.sentMessages.filter((m: any) => m.type === ExtensionMsg.ShowNudgeBanner);

    test('a fresh resolve replays the cached banner exactly once on ready, and a later requestInit does not replay it again', async () => {
        // showNudgeBanner can be called while the sidebar reveal is still resolving the view
        // (see extension.ts's hidden-reveal branch), i.e. before the fresh webview is ready.
        provider.showNudgeBanner({ title: 'Stuck?', sub: 'Want a hint?' }, 'ep-1', 10_000);
        assert.strictEqual(showBannerMessages().length, 0, 'no post before the webview is ready');

        spyWebview.simulateMessage({ type: WebviewMsgType.Ready });
        await Promise.resolve();

        const afterReady = showBannerMessages();
        assert.strictEqual(afterReady.length, 1, 'the fresh ready should replay the cached banner exactly once');
        assert.strictEqual((afterReady[0] as any).episodeId, 'ep-1');

        // A RequestInit retry on the now-live view must not restart the 10s countdown.
        spyWebview.sentMessages = [];
        spyWebview.simulateMessage({ type: WebviewMsgType.RequestInit });
        await Promise.resolve();

        assert.strictEqual(showBannerMessages().length, 0, 'requestInit on an already-replayed banner must not post again');
    });

    test('a nudgeBannerAction command clears the cached banner so a later resolve+ready does not replay it', async () => {
        provider.showNudgeBanner({ title: 'Stuck?', sub: 'Want a hint?' }, 'ep-2', 10_000);
        spyWebview.simulateMessage({ type: WebviewMsgType.Ready });
        await Promise.resolve();
        assert.strictEqual(showBannerMessages().length, 1, 'sanity check: banner replayed on first ready');

        spyWebview.simulateMessage({ type: 'command', command: WebviewCmd.NudgeBannerAction, payload: { action: 'dismiss', episodeId: 'ep-2' } });
        await Promise.resolve();

        // Simulate a webview reload: a fresh resolve followed by ready.
        spyWebview.sentMessages = [];
        await provider.resolveWebviewView(controllableView, {} as any, {} as any);
        spyWebview.simulateMessage({ type: WebviewMsgType.Ready });
        await Promise.resolve();

        assert.strictEqual(showBannerMessages().length, 0, 'a dismissed banner must not be replayed after a later resolve+ready');
    });
});
