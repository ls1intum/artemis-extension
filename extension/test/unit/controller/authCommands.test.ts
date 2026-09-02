import * as vscode from 'vscode';
import * as assert from 'assert';
import * as sinon from 'sinon';

import type { AttemptId, ExtensionToWebviewMessage, ExtMsg } from '@shared/messageContracts';
import { WebviewCmd } from '@shared/messageContracts';

import { ArtemisApiService } from '@extension/api/artemisApi';
import { AuthCommandModule } from '@extension/controller/commands/authCommands';
import type { CommandContext } from '@extension/controller/commands/types';
import type { ArtemisUser, AuthenticationResult } from '@extension/domain';
import type { LoginOptionsResponse } from '@extension/domain/auth';
import { AuthCancellationService } from '@extension/services/auth/authCancellationService';
import { AuthManager } from '@extension/services/auth/authManager';
import { HandoverFailureStore } from '@extension/services/auth/handoverFailureStore';
import { OidcLoginService } from '@extension/services/auth/oidcLoginService';
import { initializeTheiaContext } from '@extension/theia/theiaEnvironment';
import { CONFIG } from '@extension/utils/constants';
import { MockExtensionContext } from '@test/unit/mocks/vscodeMocks';

suite('AuthCommandModule Test Suite', () => {
    let sandbox: sinon.SinonSandbox;
    let context: MockExtensionContext;
    let authManager: AuthManager;
    let api: sinon.SinonStubbedInstance<ArtemisApiService>;
    let handoverFailures: HandoverFailureStore;
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
        handoverFailures = new HandoverFailureStore();
        module = new AuthCommandModule({
            authManager,
            artemisApi: api,
            oidcLoginService,
            authCancellation: new AuthCancellationService(oidcLoginService),
            handoverFailures,
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

    function dispatchLogin(overrides: { attemptId?: AttemptId } = {}): Promise<void> {
        return dispatch(WebviewCmd.Login, {
            username: 'ab12cde',
            password: 'secret',
            rememberMe: true,
            attemptId: overrides.attemptId ?? 'a-1',
        });
    }

    const dispatchCancel = (): Promise<void> => dispatch(WebviewCmd.CancelLogin);
    const dispatchLogout = (): Promise<void> => dispatch(WebviewCmd.Logout);

    function dispatchCheckLoginOptions(overrides: { attemptId?: AttemptId } = {}): Promise<void> {
        return dispatch(WebviewCmd.CheckLoginOptions, {
            username: 'ab12cde',
            attemptId: overrides.attemptId ?? 'a-1',
        });
    }

    test('a successful login names both steps before it reports success', async () => {
        api.authenticate.resolves({ success: true, token: 'jwt=fresh' } as AuthenticationResult);
        api.getCurrentUserWithToken.resolves({ id: 1, login: 'student' } as ArtemisUser);

        await dispatchLogin({ attemptId: 'a-7' });

        const kinds = sent.map(m => m.type);
        assert.deepStrictEqual(kinds, ['updateLoading', 'loginSuccess']);
        const updateLoading = sent[0] as ExtMsg<'updateLoading'>;
        const loginSuccess = sent[1] as ExtMsg<'loginSuccess'>;
        assert.strictEqual(updateLoading.message, 'Loading your profile');
        assert.strictEqual(updateLoading.subtext, 'Fetching your account details');
        assert.strictEqual(updateLoading.attemptId, 'a-7');
        assert.strictEqual(loginSuccess.attemptId, 'a-7');
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

    test('logging out does not lose a session started while the server logout was still running', async () => {
        await authManager.storeArtemisCredentials('jwt=old', true);
        // Two levers, so the fresh login provably happens while the server logout is pending. A bare
        // `await Promise.resolve()` would only prove that some microtask ran.
        const reachedServerLogout = deferred<void>();
        const releaseServerLogout = deferred<void>();
        api.logoutFromServer.callsFake(async () => {
            reachedServerLogout.resolve();
            await releaseServerLogout.promise;
        });

        const logout = dispatchLogout();
        await reachedServerLogout.promise;
        await authManager.storeArtemisCredentials('jwt=new', true);
        releaseServerLogout.resolve();
        await logout;

        assert.strictEqual(await context.secrets.get(CONFIG.SECRET_KEYS.ARTEMIS_TOKEN), 'jwt=new',
            'the trailing clear belongs to the credential the logout started with, not to this one');
    });

    test('logging out removes the credential it was asked to remove', async () => {
        await authManager.storeArtemisCredentials('jwt=old', true);

        await dispatchLogout();

        assert.strictEqual(await context.secrets.get(CONFIG.SECRET_KEYS.ARTEMIS_TOKEN), undefined);
    });

    test('a cancel during the deferred SecretStorage commit does not leave the user signed in', async () => {
        // The cancel is issued from inside the write. Issuing it from the test body would land before
        // the transaction's pre-write check and prove nothing about the rollback.
        const originalStore = context.secrets.store.bind(context.secrets);
        let cancelDuringWrite: Promise<void> | undefined;
        context.secrets.store = async (key: string, value: string) => {
            await originalStore(key, value);
            cancelDuringWrite = dispatchCancel();
            await cancelDuringWrite;
        };
        api.authenticate.resolves({ success: true, token: 'jwt=fresh' } as AuthenticationResult);
        api.getCurrentUserWithToken.resolves({ id: 1, login: 'student' } as ArtemisUser);

        await dispatchLogin({});
        await cancelDuringWrite;

        assert.strictEqual(await context.secrets.get(CONFIG.SECRET_KEYS.ARTEMIS_TOKEN), undefined,
            'the write had already landed, so only a rollback can make this true');
        assert.deepStrictEqual(await authManager.getAuthHeaders(), {},
            'a candidate left behind in memory would still authenticate requests even with SecretStorage empty');
        assert.deepStrictEqual(sent.map(m => m.type), ['updateLoading'],
            'a retracted attempt reports no success');
    });

    test('a server change overtaken by a login for the new server leaves that login alone', async () => {
        // The listener lives in extension.ts, so drive its two collaborators directly: this pins the
        // contract the listener has to honour, which is the part that can regress.
        await authManager.storeArtemisCredentials('jwt=old-server', true);
        const revision = authManager.currentCredentialRevision();
        await authManager.storeArtemisCredentials('jwt=new-server', true);

        const cleared = await authManager.clearIfUnchanged(revision);

        assert.strictEqual(cleared, false,
            'the listener keys its whole teardown off this boolean; if it lies, the user ends up signed in behind a login form');
        assert.strictEqual(await context.secrets.get(CONFIG.SECRET_KEYS.ARTEMIS_TOKEN), 'jwt=new-server');
    });

    test('a cancel arriving after the login finished is a no-op', async () => {
        api.authenticate.resolves({ success: true, token: 'jwt=fresh' } as AuthenticationResult);
        api.getCurrentUserWithToken.resolves({ id: 1, login: 'student' } as ArtemisUser);
        await dispatchLogin({});

        await dispatchCancel();

        assert.strictEqual(await context.secrets.get(CONFIG.SECRET_KEYS.ARTEMIS_TOKEN), 'jwt=fresh');
    });

    test('the login-options result carries the attempt it answers', async () => {
        api.getLoginOptions.resolves({ loginMethod: 'PASSWORD', idpName: null });

        await dispatchCheckLoginOptions({ attemptId: 'a-3' });

        assert.strictEqual(sent[0].type, 'loginOptionsResult');
        assert.strictEqual(sent[0].attemptId, 'a-3');
    });

    test('cancelling the login-options lookup reports nothing', async () => {
        const gate = deferred<LoginOptionsResponse>();
        api.getLoginOptions.returns(gate.promise);

        const check = dispatchCheckLoginOptions({});
        await Promise.resolve();
        await dispatchCancel();
        gate.resolve({ loginMethod: 'PASSWORD', idpName: null });
        await check;

        assert.deepStrictEqual(sent.map(m => m.type), [],
            'the user retracted the question; answering it would move them to a stage they left');
    });

    test('a browser sign-in drops the record the sign-in before it left behind', async () => {
        // The record is replayed into every login view that asks for init data. Starting another
        // sign-in is the user saying they are past it, and the browser flow is one of those starts.
        sandbox.stub(OidcLoginService.prototype, 'start').resolves();
        handoverFailures.record(handoverFailures.begin(), 'could not open');

        await dispatch(WebviewCmd.StartOidcLogin, { rememberMe: true });

        assert.strictEqual(handoverFailures.current, undefined);
    });
});
