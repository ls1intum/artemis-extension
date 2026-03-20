import * as assert from 'assert';
import * as vscode from 'vscode';
import { AuthManager } from '../../../../src/services/auth/authManager';
import { MockExtensionContext } from '../../mocks/vscodeMocks';
import { CONFIG } from '../../../../src/utils/constants';

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

        const cookieHeader = await authManager.getCookieHeader();
        assert.strictEqual(cookieHeader, jwt);
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

    test('should use memory cookie if not persisted', async () => {
        const jwt = 'jwt=memory';
        const url = 'https://artemis.example.com';
        
        await authManager.storeArtemisCredentials(jwt, url, false);

        const storedJwt = await context.secrets.get(CONFIG.SECRET_KEYS.ARTEMIS_TOKEN);
        assert.strictEqual(storedJwt, undefined); // Should not be in secrets

        const cookieHeader = await authManager.getCookieHeader();
        assert.strictEqual(cookieHeader, jwt); // Should be in memory
    });

    test('should extract cookie from fetch response (Headers object)', async () => {
        const cookieValue = 'jwt=abcde';
        const response = {
            headers: {
                get: (key: string) => key === 'set-cookie' ? `${cookieValue}; Path=/` : null
            }
        };

        await authManager.setFromResponse(response, true);
        const stored = await authManager.getCookieHeader();
        assert.strictEqual(stored, cookieValue);
    });

    test('should extract cookie from fetch response (getSetCookie array)', async () => {
        const cookieValue = 'jwt=xyz';
        const response = {
            headers: {
                getSetCookie: () => [`${cookieValue}; Path=/`, 'other=value']
            }
        };

        await authManager.setFromResponse(response, true);
        const stored = await authManager.getCookieHeader();
        // The implementation joins multiple cookies with '; '
        assert.ok(stored?.includes(cookieValue));
    });

    test('should return correct auth headers', async () => {
        const jwt = 'jwt=token';
        await authManager.storeArtemisCredentials(jwt, 'url', false);
        
        const headers = await authManager.getAuthHeaders();
        assert.deepStrictEqual(headers, { 'Cookie': jwt });
    });

    test('should return empty auth headers if no cookie', async () => {
        await authManager.clear();
        const headers = await authManager.getAuthHeaders();
        assert.deepStrictEqual(headers, {});
    });
});
