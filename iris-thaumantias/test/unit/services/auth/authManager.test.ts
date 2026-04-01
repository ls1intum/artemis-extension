import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import { AuthManager } from '../../../../src/extension/services/auth/authManager';
import { MockExtensionContext } from '../../mocks/vscodeMocks';
import { CONFIG } from '../../../../src/extension/utils/constants';

suite('AuthManager Test Suite', () => {
    let context: MockExtensionContext;
    let authManager: AuthManager;

    setup(() => {
        context = new MockExtensionContext();
        authManager = new AuthManager(context);
    });

    test('should store and retrieve credentials', async () => {
        const jwt = 'jwt=12345';
        const url = 'https://artemis.example.com';

        await authManager.storeArtemisCredentials(jwt, url, true);

        const storedJwt = await context.secrets.get(CONFIG.SECRET_KEYS.ARTEMIS_TOKEN);
        const storedUrl = await context.secrets.get(CONFIG.SECRET_KEYS.ARTEMIS_SERVER_URL);

        assert.strictEqual(storedJwt, jwt);
        assert.strictEqual(storedUrl, url);

        const headers = await authManager.getAuthHeaders();
        assert.deepStrictEqual(headers, { 'Cookie': jwt });
    });

    test('should clear credentials', async () => {
        const jwt = 'jwt=12345';
        const url = 'https://artemis.example.com';

        await authManager.storeArtemisCredentials(jwt, url, true);
        await authManager.clear();

        const storedJwt = await context.secrets.get(CONFIG.SECRET_KEYS.ARTEMIS_TOKEN);
        const storedUrl = await context.secrets.get(CONFIG.SECRET_KEYS.ARTEMIS_SERVER_URL);

        assert.strictEqual(storedJwt, undefined);
        assert.strictEqual(storedUrl, undefined);
    });

    test('should use memory token if not persisted', async () => {
        const jwt = 'jwt=memory';
        const url = 'https://artemis.example.com';

        await authManager.storeArtemisCredentials(jwt, url, false);

        const storedJwt = await context.secrets.get(CONFIG.SECRET_KEYS.ARTEMIS_TOKEN);
        assert.strictEqual(storedJwt, undefined); // Should not be in secrets

        const headers = await authManager.getAuthHeaders();
        assert.deepStrictEqual(headers, { 'Cookie': jwt }); // Should be in memory
    });

    test('should return correct auth headers', async () => {
        const jwt = 'jwt=token';
        await authManager.storeArtemisCredentials(jwt, 'url', false);

        const headers = await authManager.getAuthHeaders();
        assert.deepStrictEqual(headers, { 'Cookie': jwt });
    });

    test('should return empty auth headers if no token', async () => {
        await authManager.clear();
        const headers = await authManager.getAuthHeaders();
        assert.deepStrictEqual(headers, {});
    });

    // --- hasAuthToken ---

    test('hasAuthToken returns false when no credentials are stored', async () => {
        const result = await authManager.hasAuthToken();
        assert.strictEqual(result, false);
    });

    test('hasAuthToken returns true when ARTEMIS_TOKEN is in secrets', async () => {
        await context.secrets.store(CONFIG.SECRET_KEYS.ARTEMIS_TOKEN, 'jwt=token');
        const result = await authManager.hasAuthToken();
        assert.strictEqual(result, true);
    });

    test('hasAuthToken returns true when legacy AUTH_COOKIE key is in secrets', async () => {
        await context.secrets.store(CONFIG.SECRET_KEYS.AUTH_COOKIE, 'jwt=legacy');
        const result = await authManager.hasAuthToken();
        assert.strictEqual(result, true);
    });

    test('hasAuthToken returns true when only in-memory token is set', async () => {
        await authManager.storeArtemisCredentials('jwt=memory', 'https://example.com', false);
        const result = await authManager.hasAuthToken();
        assert.strictEqual(result, true);
    });

    test('hasAuthToken returns false after clear', async () => {
        await authManager.storeArtemisCredentials('jwt=token', 'https://example.com', true);
        await authManager.clear();
        const result = await authManager.hasAuthToken();
        assert.strictEqual(result, false);
    });

    // --- hasArtemisToken ---

    test('hasArtemisToken returns false when not stored', async () => {
        const result = await authManager.hasArtemisToken();
        assert.strictEqual(result, false);
    });

    test('hasArtemisToken returns true when ARTEMIS_TOKEN is stored', async () => {
        await context.secrets.store(CONFIG.SECRET_KEYS.ARTEMIS_TOKEN, 'jwt=token');
        const result = await authManager.hasArtemisToken();
        assert.strictEqual(result, true);
    });

    test('hasArtemisToken returns false when only in-memory token is set', async () => {
        await authManager.storeArtemisCredentials('jwt=memory', 'https://example.com', false);
        const result = await authManager.hasArtemisToken();
        assert.strictEqual(result, false);
    });

    test('hasArtemisToken returns false after clear', async () => {
        await authManager.storeArtemisCredentials('jwt=token', 'https://example.com', true);
        await authManager.clear();
        const result = await authManager.hasArtemisToken();
        assert.strictEqual(result, false);
    });

    // --- getArtemisServerUrl ---

    test('getArtemisServerUrl returns undefined when not stored', async () => {
        const result = await authManager.getArtemisServerUrl();
        assert.strictEqual(result, undefined);
    });

    test('getArtemisServerUrl returns stored URL after persist', async () => {
        const url = 'https://artemis.example.com';
        await authManager.storeArtemisCredentials('jwt=token', url, true);
        const result = await authManager.getArtemisServerUrl();
        assert.strictEqual(result, url);
    });

    test('getArtemisServerUrl returns undefined when not persisted', async () => {
        await authManager.storeArtemisCredentials('jwt=memory', 'https://example.com', false);
        const result = await authManager.getArtemisServerUrl();
        assert.strictEqual(result, undefined);
    });

    test('getArtemisServerUrl returns undefined after clear', async () => {
        await authManager.storeArtemisCredentials('jwt=token', 'https://example.com', true);
        await authManager.clear();
        const result = await authManager.getArtemisServerUrl();
        assert.strictEqual(result, undefined);
    });

    // --- getStoredToken (via getAuthHeaders, since getStoredToken is private) ---

    test('getAuthHeaders returns empty when no credentials stored', async () => {
        const result = await authManager.getAuthHeaders();
        assert.deepStrictEqual(result, {});
    });

    test('getAuthHeaders ignores legacy AUTH_COOKIE key', async () => {
        await context.secrets.store(CONFIG.SECRET_KEYS.AUTH_COOKIE, 'jwt=legacy');
        const result = await authManager.getAuthHeaders();
        assert.deepStrictEqual(result, {});
    });

    // --- clear: error path ---

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
