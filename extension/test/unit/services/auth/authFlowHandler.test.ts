import * as assert from 'assert';

import { ArtemisApiService } from '@extension/api';
import { AuthFlowHandler } from '@extension/services/auth/authFlowHandler';
import { AuthManager } from '@extension/services/auth/authManager';
import { ApiError } from '@extension/types';
import { CONFIG } from '@extension/utils';
import { MockExtensionContext } from '@test/unit/mocks/vscodeMocks';

suite('AuthFlowHandler.checkExistingAuthentication', () => {
    interface HarnessOpts {
        hasAuthToken?: () => Promise<boolean>;
        getCurrentUser: () => Promise<unknown>;
        onAuthenticated?: (info: unknown) => Promise<void>;
        updater?: (isAuthenticated: boolean) => Promise<void>;
        authManager?: AuthManager;
    }

    function makeHandler(opts: HarnessOpts) {
        const state = {
            cleared: false,
            hideCalled: false,
            authenticatedWith: undefined as unknown,
            updaterCalledWith: undefined as boolean | undefined,
        };
        const authManager = opts.authManager ?? ({
            hasAuthToken: opts.hasAuthToken ?? (async () => true),
            clear: async () => { state.cleared = true; },
            currentCredentialRevision: () => 0,
            clearIfUnchanged: async () => { state.cleared = true; return true; },
        } as unknown as AuthManager);
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
            },
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

    test('a 401 during the startup check spares a credential acquired since it started', async () => {
        const context = new MockExtensionContext();
        const authManager = new AuthManager(context);
        await authManager.storeArtemisCredentials('jwt=stored', true);

        let release!: () => void;
        const { handler, state } = makeHandler({
            authManager,
            getCurrentUser: async () => {
                await new Promise<void>(resolve => { release = resolve; });
                throw new ApiError('Not authenticated', 401);
            },
        });

        const running = handler.checkExistingAuthentication();
        await Promise.resolve();
        await authManager.storeArtemisCredentials('jwt=interactive', true);
        release();
        await running;

        assert.strictEqual(await context.secrets.get(CONFIG.SECRET_KEYS.ARTEMIS_TOKEN), 'jwt=interactive');
        assert.strictEqual(state.hideCalled, true, 'must recover the UI even when the 401 verdict is stale');
    });

    test('a genuine 401 releases the loading view even though the request layer clears first', async () => {
        // Uses the real ArtemisApiService (not a stub of getCurrentUser), so the request layer's own
        // 401 handling in makeRequest() runs and clears the credential before this handler's catch
        // block gets a chance to. That is what makes this handler's own clearIfUnchanged() see a
        // revision that has already moved and report false, which is the exact case this test guards.
        const context = new MockExtensionContext();
        const authManager = new AuthManager(context);
        await authManager.storeArtemisCredentials('jwt=stale', true);

        const originalFetch = global.fetch;
        global.fetch = (async () => ({ ok: false, status: 401, text: async () => '' })) as unknown as typeof fetch;

        const artemisApi = new ArtemisApiService(authManager);
        const state = {
            hideCalled: false,
            updaterCalledWith: undefined as boolean | undefined,
        };
        const updater = async (isAuthenticated: boolean) => { state.updaterCalledWith = isAuthenticated; };
        const handler = new AuthFlowHandler(
            authManager,
            artemisApi,
            () => updater,
            () => { /* postMessage */ },
            {
                onAuthenticated: async () => { throw new Error('must not auto-authenticate on a real 401'); },
                hideLoadingAndSendServerUrl: () => { state.hideCalled = true; },
            },
        );

        try {
            await handler.checkExistingAuthentication();
        } finally {
            global.fetch = originalFetch;
        }

        assert.strictEqual(await context.secrets.get(CONFIG.SECRET_KEYS.ARTEMIS_TOKEN), undefined,
            'the stale credential must still end up cleared');
        assert.strictEqual(state.hideCalled, true,
            'a genuine 401 must not strand the startup loading view, even though makeRequest cleared first');
        assert.strictEqual(state.updaterCalledWith, undefined,
            "this handler's own clearIfUnchanged() lost the race, so it must not also claim the context update");
    });
});
