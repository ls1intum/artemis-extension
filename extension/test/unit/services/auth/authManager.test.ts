import * as vscode from 'vscode';
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

    test('should return Bearer headers when enableBearerAuth is called', async () => {
        const jwt = 'eyJhbGciOiJIUzI1NiJ9.raw-token';
        authManager.enableBearerAuth();
        await authManager.storeArtemisCredentials(jwt, 'url', false);

        const headers = await authManager.getAuthHeaders();
        assert.deepStrictEqual(headers, { 'Authorization': `Bearer ${jwt}` });
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

    // --- getStoredLoginServerUrl / isServerUrlChanged ---

    test('getStoredLoginServerUrl returns undefined when not stored', async () => {
        const result = await authManager.getStoredLoginServerUrl();
        assert.strictEqual(result, undefined);
    });

    test('getStoredLoginServerUrl returns stored URL after persist', async () => {
        const url = 'https://artemis.example.com';
        await authManager.storeArtemisCredentials('jwt=token', url, true);
        const result = await authManager.getStoredLoginServerUrl();
        assert.strictEqual(result, url);
    });

    test('getStoredLoginServerUrl returns undefined when not persisted', async () => {
        await authManager.storeArtemisCredentials('jwt=memory', 'https://example.com', false);
        const result = await authManager.getStoredLoginServerUrl();
        assert.strictEqual(result, undefined);
    });

    test('getStoredLoginServerUrl returns undefined after clear', async () => {
        await authManager.storeArtemisCredentials('jwt=token', 'https://example.com', true);
        await authManager.clear();
        const result = await authManager.getStoredLoginServerUrl();
        assert.strictEqual(result, undefined);
    });

    test('isServerUrlChanged returns false when no stored URL', async () => {
        const result = await authManager.isServerUrlChanged('https://new.example.com');
        assert.strictEqual(result, false);
    });

    test('isServerUrlChanged returns true when URL differs', async () => {
        await authManager.storeArtemisCredentials('jwt=token', 'https://old.example.com', true);
        const result = await authManager.isServerUrlChanged('https://new.example.com');
        assert.strictEqual(result, true);
    });

    test('isServerUrlChanged returns false when URL matches', async () => {
        await authManager.storeArtemisCredentials('jwt=token', 'https://same.example.com', true);
        const result = await authManager.isServerUrlChanged('https://same.example.com');
        assert.strictEqual(result, false);
    });

    // --- getAuthHeaders ---

    test('getAuthHeaders returns empty when no credentials stored', async () => {
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
