import * as assert from 'assert';
import * as vscode from 'vscode';
import { ArtemisWebviewProvider } from '../../src/provider/artemisWebviewProvider';
import { MockExtensionContext } from '../mocks/vscodeMocks';
import { AuthManager } from '../../src/auth';
import { ArtemisApiService } from '../../src/api';
import { ArtemisWebsocketService } from '../../src/services';

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
        const codeLens = {};
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
