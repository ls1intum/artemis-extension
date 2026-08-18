import * as assert from 'assert';
import * as sinon from 'sinon';

import { AuthManager } from '@extension/services/auth/authManager';
import { CONFIG } from '@extension/utils/constants';
import { MockExtensionContext } from '@test/unit/mocks/vscodeMocks';

suite('AuthManager Test Suite', () => {
    let context: MockExtensionContext;
    let authManager: AuthManager;

    setup(() => {
        context = new MockExtensionContext();
        authManager = new AuthManager(context);
    });

    test('should store and retrieve credentials', async () => {
        const jwt = 'jwt=12345';

        await authManager.storeArtemisCredentials(jwt, true);

        const storedJwt = await context.secrets.get(CONFIG.SECRET_KEYS.ARTEMIS_TOKEN);

        assert.strictEqual(storedJwt, jwt);

        const headers = await authManager.getAuthHeaders();
        assert.deepStrictEqual(headers, { 'Cookie': jwt });
    });

    test('should clear credentials', async () => {
        const jwt = 'jwt=12345';

        await authManager.storeArtemisCredentials(jwt, true);
        await authManager.clear();

        const storedJwt = await context.secrets.get(CONFIG.SECRET_KEYS.ARTEMIS_TOKEN);

        assert.strictEqual(storedJwt, undefined);
    });

    test('should use memory token if not persisted', async () => {
        const jwt = 'jwt=memory';

        await authManager.storeArtemisCredentials(jwt, false);

        const storedJwt = await context.secrets.get(CONFIG.SECRET_KEYS.ARTEMIS_TOKEN);
        assert.strictEqual(storedJwt, undefined); // Should not be in secrets

        const headers = await authManager.getAuthHeaders();
        assert.deepStrictEqual(headers, { 'Cookie': jwt }); // Should be in memory
    });

    test('formatToken produces the cookie form on desktop, from prefixed or bare input', () => {
        assert.strictEqual(authManager.formatToken('raw-jwt'), 'jwt=raw-jwt');
        assert.strictEqual(authManager.formatToken('jwt=raw-jwt'), 'jwt=raw-jwt');
    });

    test('formatToken produces the bare JWT in bearer mode, even from a prefixed input', () => {
        authManager.enableBearerAuth();

        assert.strictEqual(authManager.formatToken('raw-jwt'), 'raw-jwt');
        // The regression that matters: a cookie string reaching bearer mode must not become
        // `Authorization: Bearer jwt=<token>`.
        assert.strictEqual(authManager.formatToken('jwt=raw-jwt'), 'raw-jwt');
    });

    test('declining to be remembered removes an earlier persisted secret', async () => {
        await authManager.storeArtemisCredentials('jwt=remembered', true);
        assert.strictEqual(await context.secrets.get(CONFIG.SECRET_KEYS.ARTEMIS_TOKEN), 'jwt=remembered');

        await authManager.storeArtemisCredentials('jwt=session-only', false);

        assert.strictEqual(await context.secrets.get(CONFIG.SECRET_KEYS.ARTEMIS_TOKEN), undefined);
        assert.deepStrictEqual(await authManager.getAuthHeaders(), { 'Cookie': 'jwt=session-only' });
    });

    test('bearer mode never touches SecretStorage, so Theia cannot delete a desktop secret', async () => {
        await authManager.storeArtemisCredentials('jwt=desktop-secret', true);

        authManager.enableBearerAuth();
        await authManager.storeArtemisCredentials('theia-env-token', false);

        assert.strictEqual(await context.secrets.get(CONFIG.SECRET_KEYS.ARTEMIS_TOKEN), 'jwt=desktop-secret',
            'Theia activation must leave an existing desktop secret alone');
        assert.deepStrictEqual(await authManager.getAuthHeaders(), { 'Authorization': 'Bearer theia-env-token' });
    });

    test('a failing secret write leaves no half-applied credential', async () => {
        await authManager.storeArtemisCredentials('jwt=old', true);
        const failure = new Error('secret storage unavailable');
        const stub = sinon.stub(context.secrets, 'store').rejects(failure);

        try {
            await assert.rejects(() => authManager.storeArtemisCredentials('jwt=new', true), /secret storage unavailable/);
            // Memory is only updated once the persistent side has settled.
            assert.deepStrictEqual(await authManager.getAuthHeaders(), { 'Cookie': 'jwt=old' });
        } finally {
            stub.restore();
        }
    });

    test('should return correct auth headers', async () => {
        const jwt = 'jwt=token';
        await authManager.storeArtemisCredentials(jwt, false);

        const headers = await authManager.getAuthHeaders();
        assert.deepStrictEqual(headers, { 'Cookie': jwt });
    });

    test('should return Bearer headers when enableBearerAuth is called', async () => {
        const jwt = 'eyJhbGciOiJIUzI1NiJ9.raw-token';
        authManager.enableBearerAuth();
        await authManager.storeArtemisCredentials(jwt, false);

        const headers = await authManager.getAuthHeaders();
        assert.deepStrictEqual(headers, { 'Authorization': `Bearer ${jwt}` });
    });

    test('should return empty auth headers if no token', async () => {
        await authManager.clear();
        const headers = await authManager.getAuthHeaders();
        assert.deepStrictEqual(headers, {});
    });

    test('hasAuthToken returns false when no credentials are stored', async () => {
        const result = await authManager.hasAuthToken();
        assert.strictEqual(result, false);
    });

    test('hasAuthToken returns true when ARTEMIS_TOKEN is in secrets', async () => {
        await context.secrets.store(CONFIG.SECRET_KEYS.ARTEMIS_TOKEN, 'jwt=token');
        const result = await authManager.hasAuthToken();
        assert.strictEqual(result, true);
    });

    test('hasAuthToken returns true when only in-memory token is set', async () => {
        await authManager.storeArtemisCredentials('jwt=memory', false);
        const result = await authManager.hasAuthToken();
        assert.strictEqual(result, true);
    });

    test('hasAuthToken returns false after clear', async () => {
        await authManager.storeArtemisCredentials('jwt=token', true);
        await authManager.clear();
        const result = await authManager.hasAuthToken();
        assert.strictEqual(result, false);
    });

    test('getAuthHeaders returns empty when no credentials stored', async () => {
        const result = await authManager.getAuthHeaders();
        assert.deepStrictEqual(result, {});
    });

    test('clear swallows errors from secrets.delete', async () => {
        const sandbox = sinon.createSandbox();
        try {
            sandbox.stub(context.secrets, 'delete').rejects(new Error('storage unavailable'));
            await assert.doesNotReject(() => authManager.clear());
        } finally {
            sandbox.restore();
        }
    });
});
