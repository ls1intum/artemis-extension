import * as vscode from 'vscode';
import * as assert from 'assert';
import * as sinon from 'sinon';

import type { ExtensionToWebviewMessage, ExtMsg } from '@shared/messageContracts';
import { WebviewCmd } from '@shared/messageContracts';

import { ArtemisApiService } from '@extension/api/artemisApi';
import { AuthCommandModule } from '@extension/controller/commands/authCommands';
import type { CommandContext } from '@extension/controller/commands/types';
import type { ArtemisUser, AuthenticationResult } from '@extension/domain';
import { AuthCancellationService } from '@extension/services/auth/authCancellationService';
import { AuthManager } from '@extension/services/auth/authManager';
import { OidcLoginService } from '@extension/services/auth/oidcLoginService';
import { initializeTheiaContext } from '@extension/theia/theiaEnvironment';
import { CONFIG } from '@extension/utils/constants';
import { MockExtensionContext } from '@test/unit/mocks/vscodeMocks';

suite('AuthCommandModule Test Suite', () => {
    let sandbox: sinon.SinonSandbox;
    let context: MockExtensionContext;
    let authManager: AuthManager;
    let api: sinon.SinonStubbedInstance<ArtemisApiService>;
    let module: AuthCommandModule;
    let sent: ExtensionToWebviewMessage[];
    let showErrorMessage: sinon.SinonStub;
    let navigateToStartPage: sinon.SinonStub;
    let configuredServerUrl: string;

    /** A promise plus the lever that settles it, for parking a call at the boundary under test. */
    function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
        let resolve!: (value: T) => void;
        const promise = new Promise<T>(r => { resolve = r; });
        return { promise, resolve };
    }

    setup(() => {
        sandbox = sinon.createSandbox();
        context = new MockExtensionContext();
        authManager = new AuthManager(context);
        api = sandbox.createStubInstance(ArtemisApiService);
        api.logoutFromServer.resolves();
        sent = [];
        showErrorMessage = sandbox.stub(vscode.window, 'showErrorMessage').resolves(undefined);
        sandbox.stub(vscode.window, 'showInformationMessage').resolves(undefined);
        navigateToStartPage = sandbox.stub().resolves();

        configuredServerUrl = 'https://artemis.tum.de';
        // Read on every call, which is what the server-change test drives.
        sandbox.stub(vscode.workspace, 'getConfiguration').returns({
            get: (_key: string, fallback?: unknown) => configuredServerUrl ?? fallback,
        } as unknown as vscode.WorkspaceConfiguration);

        const oidcLoginService = new OidcLoginService(context, authManager, api as unknown as ArtemisApiService);
        module = new AuthCommandModule({
            authManager,
            artemisApi: api,
            oidcLoginService,
            authCancellation: new AuthCancellationService(oidcLoginService),
            sendMessage: (message: ExtensionToWebviewMessage) => { sent.push(message); },
            updateAuthContext: async () => {},
            actionHandler: { navigateToStartPage, render: () => {} },
            appStateManager: { showLogin: () => {} },
        } as unknown as CommandContext);
    });

    teardown(() => sandbox.restore());

    function dispatch(command: string, payload?: unknown): Promise<void> {
        return module.getHandlers()[command]({ type: 'command', command, payload } as never);
    }

    function dispatchLogin(overrides: { attemptId?: number } = {}): Promise<void> {
        return dispatch(WebviewCmd.Login, {
            username: 'ab12cde',
            password: 'secret',
            rememberMe: true,
            attemptId: overrides.attemptId ?? 1,
        });
    }

    const dispatchCancel = (): Promise<void> => dispatch(WebviewCmd.CancelLogin);

    test('a successful login names both steps before it reports success', async () => {
        api.authenticate.resolves({ success: true, token: 'jwt=fresh' } as AuthenticationResult);
        api.getCurrentUserWithToken.resolves({ id: 1, login: 'student' } as ArtemisUser);

        await dispatchLogin({ attemptId: 7 });

        const kinds = sent.map(m => m.type);
        assert.deepStrictEqual(kinds, ['updateLoading', 'loginSuccess']);
        const updateLoading = sent[0] as ExtMsg<'updateLoading'>;
        const loginSuccess = sent[1] as ExtMsg<'loginSuccess'>;
        assert.strictEqual(updateLoading.message, 'Loading your profile');
        assert.strictEqual(updateLoading.subtext, 'Fetching your account details');
        assert.strictEqual(updateLoading.attemptId, 7);
        assert.strictEqual(loginSuccess.attemptId, 7);
    });

    test('cancelling while authenticate is in flight commits nothing and stays quiet', async () => {
        await authManager.storeArtemisCredentials('jwt=existing', true);
        const gate = deferred<AuthenticationResult>();
        api.authenticate.returns(gate.promise);

        const login = dispatchLogin({});
        await Promise.resolve();
        await dispatchCancel();
        gate.resolve({ success: true, token: 'jwt=fresh' } as AuthenticationResult);
        await login;

        assert.strictEqual(await context.secrets.get(CONFIG.SECRET_KEYS.ARTEMIS_TOKEN), 'jwt=existing');
        assert.deepStrictEqual(sent.map(m => m.type), [], 'the user pressed Cancel; they do not need to be told');
        assert.ok(showErrorMessage.notCalled);
    });

    test('cancelling after the account check but before the commit commits nothing', async () => {
        await authManager.storeArtemisCredentials('jwt=existing', true);
        api.authenticate.resolves({ success: true, token: 'jwt=fresh' } as AuthenticationResult);
        const gate = deferred<ArtemisUser>();
        api.getCurrentUserWithToken.returns(gate.promise);

        const login = dispatchLogin({});
        await Promise.resolve();
        await dispatchCancel();
        gate.resolve({ id: 1, login: 'student' } as ArtemisUser);
        await login;

        assert.strictEqual(await context.secrets.get(CONFIG.SECRET_KEYS.ARTEMIS_TOKEN), 'jwt=existing');
    });

    test('a server change during the login stops the commit', async () => {
        api.authenticate.resolves({ success: true, token: 'jwt=fresh' } as AuthenticationResult);
        api.getCurrentUserWithToken.callsFake(async () => {
            configuredServerUrl = 'https://artemis.example.org';
            return { id: 1, login: 'student' } as ArtemisUser;
        });

        await dispatchLogin({});

        assert.strictEqual(await context.secrets.get(CONFIG.SECRET_KEYS.ARTEMIS_TOKEN), undefined,
            'a token issued by the previous server must not become the credential for the new one');
    });

    test('a timeout is reported as a server that did not answer', async () => {
        api.authenticate.rejects(new DOMException('Request timed out', 'TimeoutError'));

        await dispatchLogin({});

        const error = sent.find(m => m.type === 'loginError') as ExtMsg<'loginError'> | undefined;
        assert.strictEqual(error?.error, 'Login failed: The Artemis server did not respond in time. Please try again.');
    });

    test('the start page is opened with the Theia server URL, not the workspace setting', async () => {
        // resolveServerUrl() prefers the Theia environment; reading the setting directly sends an
        // EduIDE user to the wrong Artemis. Same Theia setup as utilityCommands.test.ts.
        const theiaUrl = 'https://artemis-test2.artemis.cit.tum.de';
        const originalBridge = process.env.DATA_BRIDGE_ENABLED;
        process.env.DATA_BRIDGE_ENABLED = '1';
        sandbox.stub(vscode.commands, 'getCommands').resolves(['dataBridge.getEnv']);
        sandbox.stub(vscode.commands, 'executeCommand')
            .withArgs('dataBridge.getEnv', sinon.match.any)
            .resolves({ THEIA: 'true', ARTEMIS_URL: theiaUrl, ARTEMIS_TOKEN: 'tok-123' });
        await initializeTheiaContext();

        configuredServerUrl = 'https://artemis.tum.de';
        api.authenticate.resolves({ success: true, token: 'jwt=fresh' } as AuthenticationResult);
        api.getCurrentUserWithToken.resolves({ id: 1, login: 'student' } as ArtemisUser);

        try {
            await dispatchLogin({});
            assert.strictEqual(navigateToStartPage.firstCall.args[0].serverUrl, theiaUrl);
        } finally {
            // Reset the Theia singleton, or this leaks into every suite that runs after it.
            if (originalBridge === undefined) {
                delete process.env.DATA_BRIDGE_ENABLED;
            } else {
                process.env.DATA_BRIDGE_ENABLED = originalBridge;
            }
            await initializeTheiaContext();
        }
    });
});
