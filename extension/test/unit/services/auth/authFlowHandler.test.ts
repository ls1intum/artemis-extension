import * as vscode from 'vscode';
import * as assert from 'assert';

import { ArtemisApiService } from '@extension/api';
import { AuthFlowHandler } from '@extension/services/auth/authFlowHandler';
import { AuthManager } from '@extension/services/auth/authManager';
import { PendingExternalLogin, PendingExternalLoginStore } from '@extension/services/auth/pendingExternalLogin';
import { ApiError } from '@extension/types';
import { resolveServerUrl } from '@extension/utils';

suite('AuthFlowHandler.checkExistingAuthentication', () => {
    interface HarnessOpts {
        hasAuthToken?: () => Promise<boolean>;
        getCurrentUser: () => Promise<unknown>;
        onAuthenticated?: (info: unknown) => Promise<void>;
        updater?: (isAuthenticated: boolean) => Promise<void>;
    }

    function makeHandler(opts: HarnessOpts) {
        const state = {
            cleared: false,
            hideCalled: false,
            authenticatedWith: undefined as unknown,
            updaterCalledWith: undefined as boolean | undefined,
        };
        const authManager = {
            hasAuthToken: opts.hasAuthToken ?? (async () => true),
            clear: async () => { state.cleared = true; },
        } as unknown as AuthManager;
        const artemisApi = { getCurrentUser: opts.getCurrentUser } as unknown as ArtemisApiService;
        const updater = opts.updater ?? (async (isAuthenticated: boolean) => { state.updaterCalledWith = isAuthenticated; });
        const handler = new AuthFlowHandler(
            authManager,
            artemisApi,
            () => updater,
            () => { /* postMessage */ },
            {
                onAuthenticated: opts.onAuthenticated ?? (async (info) => { state.authenticatedWith = info; }),
                hideLoadingAndSendServerUrl: () => { state.hideCalled = true; },
                showLogin: () => { /* noop */ },
            },
            { load: async () => undefined, clear: async () => { /* noop */ }, save: async () => { /* noop */ }, isExpired: () => false } as unknown as PendingExternalLoginStore,
        );
        return { handler, state };
    }

    test('keeps credentials when the server times out (no clear)', async () => {
        const { handler, state } = makeHandler({ getCurrentUser: async () => { throw new DOMException('Request timed out', 'TimeoutError'); } });
        await handler.checkExistingAuthentication();
        assert.strictEqual(state.cleared, false, 'must NOT clear stored credentials on a timeout');
        assert.strictEqual(state.hideCalled, true, 'must recover the UI');
    });

    test('keeps credentials on a network error (no clear)', async () => {
        const { handler, state } = makeHandler({ getCurrentUser: async () => { throw new TypeError('fetch failed'); } });
        await handler.checkExistingAuthentication();
        assert.strictEqual(state.cleared, false, 'must NOT clear stored credentials on a network error');
        assert.strictEqual(state.hideCalled, true);
    });

    test('keeps credentials on a non-401 server error (no clear)', async () => {
        const { handler, state } = makeHandler({ getCurrentUser: async () => { throw new ApiError('Server error', 503); } });
        await handler.checkExistingAuthentication();
        assert.strictEqual(state.cleared, false, 'must NOT clear on a transient 5xx');
        assert.strictEqual(state.hideCalled, true);
    });

    test('clears credentials and marks context unauthenticated on a 401', async () => {
        const { handler, state } = makeHandler({ getCurrentUser: async () => { throw new ApiError('Authentication failed', 401); } });
        await handler.checkExistingAuthentication();
        assert.strictEqual(state.cleared, true, 'must clear stored credentials on 401');
        assert.strictEqual(state.updaterCalledWith, false, 'must mark the auth context unauthenticated');
        assert.strictEqual(state.hideCalled, true);
    });

    test('recovers the UI even if the auth-context updater throws on 401', async () => {
        const { handler, state } = makeHandler({
            getCurrentUser: async () => { throw new ApiError('Authentication failed', 401); },
            updater: async () => { throw new Error('setContext boom'); },
        });
        await handler.checkExistingAuthentication();
        assert.strictEqual(state.cleared, true, 'credentials are still cleared on 401');
        assert.strictEqual(state.hideCalled, true, 'must still recover the UI when the updater throws');
    });

    test('does not clear and recovers the UI when post-auth wiring fails after a valid fetch', async () => {
        const { handler, state } = makeHandler({
            getCurrentUser: async () => ({ login: 'test' }),
            onAuthenticated: async () => { throw new Error('wiring boom'); },
        });
        await handler.checkExistingAuthentication();
        assert.strictEqual(state.cleared, false, 'valid credentials must survive a post-auth wiring failure');
        assert.strictEqual(state.hideCalled, true, 'must recover the UI rather than strand the loader');
    });

    test('does not clear and recovers the UI when reading the stored token fails', async () => {
        const { handler, state } = makeHandler({
            hasAuthToken: async () => { throw new Error('secrets read failed'); },
            getCurrentUser: async () => { throw new Error('should not be called'); },
        });
        await handler.checkExistingAuthentication();
        assert.strictEqual(state.cleared, false, 'must NOT clear when the token cannot even be read');
        assert.strictEqual(state.hideCalled, true);
    });

    test('happy path authenticates and does not reset to the login view', async () => {
        const { handler, state } = makeHandler({ getCurrentUser: async () => ({ login: 'alice' }) });
        await handler.checkExistingAuthentication();
        assert.strictEqual(state.cleared, false);
        assert.strictEqual(state.hideCalled, false, 'a successful auto-login must not send the login view');
        assert.ok(state.authenticatedWith, 'onAuthenticated must be called');
        const payload = state.authenticatedWith as { username: string; serverUrl: string; user: { login: string } };
        assert.strictEqual(payload.username, 'alice');
        assert.strictEqual(payload.user.login, 'alice', 'must forward the fetched user');
        assert.ok(payload.serverUrl, 'must include the resolved server URL');
    });
});

suite('AuthFlowHandler.completeExternalLogin', () => {
    interface CompletionOpts {
        pending?: PendingExternalLogin;
        exchange?: (code: string, verifier: string) => Promise<void>;
        getCurrentUser?: () => Promise<unknown>;
    }

    function makeHandler(opts: CompletionOpts) {
        const state = {
            cleared: false,
            pendingCleared: false,
            exchanged: undefined as { code: string; verifier: string } | undefined,
            authenticatedWith: undefined as unknown,
            showLoginCalled: false,
            updaterCalledWith: undefined as boolean | undefined,
        };
        let stored = opts.pending;
        const pendingStore = {
            load: async () => stored,
            clear: async () => { stored = undefined; state.pendingCleared = true; },
            save: async () => { /* noop */ },
            isExpired: (p: PendingExternalLogin, now: number = Date.now()) => now - p.createdAt > 10 * 60 * 1000,
        } as unknown as PendingExternalLoginStore;
        const authManager = { clear: async () => { state.cleared = true; } } as unknown as AuthManager;
        const artemisApi = {
            exchangeExternalLoginCode: opts.exchange ?? (async (code: string, verifier: string) => { state.exchanged = { code, verifier }; }),
            getCurrentUser: opts.getCurrentUser ?? (async () => ({ login: 'alice' })),
        } as unknown as ArtemisApiService;
        const updater = async (isAuthenticated: boolean) => { state.updaterCalledWith = isAuthenticated; };
        const handler = new AuthFlowHandler(
            authManager,
            artemisApi,
            () => updater,
            () => { /* postMessage */ },
            {
                onAuthenticated: async (info) => { state.authenticatedWith = info; },
                hideLoadingAndSendServerUrl: () => { /* noop */ },
                showLogin: () => { state.showLoginCalled = true; },
            },
            pendingStore,
        );
        return { handler, state };
    }

    function validPending(): PendingExternalLogin {
        return { verifier: 'the-verifier', state: 'the-state', createdAt: Date.now(), serverUrl: resolveServerUrl() };
    }

    function callbackUri(query: string): vscode.Uri {
        return vscode.Uri.parse(`vscode://aet-tum.iris-thaumantias/external-login-callback?${query}`);
    }

    test('ignores a callback with an unexpected path (no exchange, no error)', async () => {
        const { handler, state } = makeHandler({ pending: validPending() });
        await handler.completeExternalLogin(vscode.Uri.parse('vscode://aet-tum.iris-thaumantias/something-else?code=c&state=the-state'));
        assert.strictEqual(state.exchanged, undefined);
        assert.strictEqual(state.showLoginCalled, false);
    });

    test('happy path: exchanges the code and authenticates', async () => {
        const { handler, state } = makeHandler({ pending: validPending() });
        await handler.completeExternalLogin(callbackUri('code=one-time&state=the-state'));
        assert.deepStrictEqual(state.exchanged, { code: 'one-time', verifier: 'the-verifier' });
        assert.strictEqual(state.updaterCalledWith, true);
        assert.ok(state.authenticatedWith, 'onAuthenticated must be called');
        assert.strictEqual(state.pendingCleared, true, 'pending must be consumed');
        assert.strictEqual(state.showLoginCalled, false);
    });

    test('rejects a state mismatch without exchanging', async () => {
        const { handler, state } = makeHandler({ pending: validPending() });
        await handler.completeExternalLogin(callbackUri('code=one-time&state=wrong'));
        assert.strictEqual(state.exchanged, undefined);
        assert.strictEqual(state.showLoginCalled, true);
        // A bogus callback must NOT consume the pending flow, so the legitimate callback can still complete.
        assert.strictEqual(state.pendingCleared, false);
    });

    test('a bogus callback does not prevent the subsequent valid callback from completing', async () => {
        const { handler, state } = makeHandler({ pending: validPending() });

        await handler.completeExternalLogin(callbackUri('code=one-time&state=wrong'));
        assert.strictEqual(state.exchanged, undefined, 'bogus callback must not exchange');
        assert.strictEqual(state.pendingCleared, false, 'bogus callback must not consume the pending flow');

        await handler.completeExternalLogin(callbackUri('code=one-time&state=the-state'));
        assert.deepStrictEqual(state.exchanged, { code: 'one-time', verifier: 'the-verifier' }, 'the legitimate callback still completes');
        assert.strictEqual(state.pendingCleared, true);
    });

    test('rejects an expired pending flow', async () => {
        const { handler, state } = makeHandler({ pending: { ...validPending(), createdAt: Date.now() - 20 * 60 * 1000 } });
        await handler.completeExternalLogin(callbackUri('code=one-time&state=the-state'));
        assert.strictEqual(state.exchanged, undefined);
        assert.strictEqual(state.showLoginCalled, true);
    });

    test('rejects when the server URL changed mid-flow', async () => {
        const { handler, state } = makeHandler({ pending: { ...validPending(), serverUrl: 'https://some-other-instance.example.com' } });
        await handler.completeExternalLogin(callbackUri('code=one-time&state=the-state'));
        assert.strictEqual(state.exchanged, undefined);
        assert.strictEqual(state.showLoginCalled, true);
    });

    test('rejects when there is no pending flow', async () => {
        const { handler, state } = makeHandler({});
        await handler.completeExternalLogin(callbackUri('code=one-time&state=the-state'));
        assert.strictEqual(state.exchanged, undefined);
        assert.strictEqual(state.showLoginCalled, true);
    });

    test('shows the login view when the code exchange fails (nothing stored)', async () => {
        const { handler, state } = makeHandler({ pending: validPending(), exchange: async () => { throw new ApiError('bad', 401); } });
        await handler.completeExternalLogin(callbackUri('code=one-time&state=the-state'));
        assert.strictEqual(state.showLoginCalled, true);
        assert.strictEqual(state.cleared, false, 'no token was stored, nothing to clear');
    });

    test('clears the token on a 401 during the post-exchange user fetch', async () => {
        const { handler, state } = makeHandler({ pending: validPending(), getCurrentUser: async () => { throw new ApiError('unauthorized', 401); } });
        await handler.completeExternalLogin(callbackUri('code=one-time&state=the-state'));
        assert.strictEqual(state.cleared, true, 'a 401 means the stored token is unusable');
        assert.strictEqual(state.updaterCalledWith, false);
        assert.strictEqual(state.showLoginCalled, true);
    });

    test('keeps the valid token on a transient post-exchange failure', async () => {
        const { handler, state } = makeHandler({ pending: validPending(), getCurrentUser: async () => { throw new ApiError('server error', 503); } });
        await handler.completeExternalLogin(callbackUri('code=one-time&state=the-state'));
        assert.strictEqual(state.cleared, false, 'a transient 5xx must not discard a valid token');
        assert.strictEqual(state.showLoginCalled, false);
        assert.strictEqual(state.updaterCalledWith, true, 'the valid session must still be marked authenticated');
    });
});
