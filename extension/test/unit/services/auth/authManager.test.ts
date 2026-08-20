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

suite('AuthManager credential transaction', () => {
    let context: MockExtensionContext;
    let authManager: AuthManager;

    setup(() => {
        context = new MockExtensionContext();
        authManager = new AuthManager(context);
    });

    test('a predicate that is already false stores nothing', async () => {
        const committed = await authManager.storeArtemisCredentials('jwt=candidate', true, () => false);

        assert.strictEqual(committed, false);
        assert.strictEqual(await context.secrets.get(CONFIG.SECRET_KEYS.ARTEMIS_TOKEN), undefined);
    });

    test('a cancellation during the write restores the previous credential', async () => {
        await authManager.storeArtemisCredentials('jwt=existing', true);
        const revisionBefore = authManager.currentCredentialRevision();

        let cancelled = false;
        const originalStore = context.secrets.store.bind(context.secrets);
        // The cancellation is flipped from INSIDE the write, which is the only way to be sure it lands
        // after the pre-write check has already passed. Flipping it in the test body instead would let
        // an implementation that only checks before the write pass this test.
        context.secrets.store = async (key: string, value: string) => {
            await originalStore(key, value);
            cancelled = true;
        };

        const commit = authManager.storeArtemisCredentials('jwt=candidate', true, () => !cancelled);

        assert.strictEqual(await commit, false);
        assert.strictEqual(await context.secrets.get(CONFIG.SECRET_KEYS.ARTEMIS_TOKEN), 'jwt=existing');
        assert.deepStrictEqual(await authManager.getAuthHeaders(), { 'Cookie': 'jwt=existing' });
        assert.strictEqual(authManager.currentCredentialRevision(), revisionBefore,
            'a refused commit must not move the revision, or a logout barrier would think it was superseded');
    });

    test('a cancellation during the write leaves no credential when there was none before', async () => {
        let cancelled = false;
        const originalStore = context.secrets.store.bind(context.secrets);
        context.secrets.store = async (key: string, value: string) => {
            await originalStore(key, value);
            cancelled = true;
        };

        const commit = authManager.storeArtemisCredentials('jwt=candidate', true, () => !cancelled);

        assert.strictEqual(await commit, false);
        assert.strictEqual(await context.secrets.get(CONFIG.SECRET_KEYS.ARTEMIS_TOKEN), undefined);
        assert.deepStrictEqual(await authManager.getAuthHeaders(), {},
            'a candidate left behind in memory would still authenticate requests even with SecretStorage empty');
    });

    test('a cancellation during the delete branch restores the earlier opt-in', async () => {
        // persist: false deletes rather than stores, so the restore has to put the old secret back.
        await authManager.storeArtemisCredentials('jwt=remembered', true);

        let cancelled = false;
        const originalDelete = context.secrets.delete.bind(context.secrets);
        // Only the first delete is the transaction's own write; the restore path deletes too, and
        // cancelling again there would make the test meaningless.
        let deletes = 0;
        context.secrets.delete = async (key: string) => {
            await originalDelete(key);
            if (++deletes === 1) {
                cancelled = true;
            }
        };

        const commit = authManager.storeArtemisCredentials('jwt=candidate', false, () => !cancelled);

        assert.strictEqual(await commit, false);
        assert.strictEqual(await context.secrets.get(CONFIG.SECRET_KEYS.ARTEMIS_TOKEN), 'jwt=remembered');
        assert.deepStrictEqual(await authManager.getAuthHeaders(), { 'Cookie': 'jwt=remembered' });
    });

    test('clearIfUnchanged clears its own credential and spares a newer one', async () => {
        await authManager.storeArtemisCredentials('jwt=first', true);
        const revision = authManager.currentCredentialRevision();

        assert.strictEqual(await authManager.clearIfUnchanged(revision), true);
        assert.strictEqual(await context.secrets.get(CONFIG.SECRET_KEYS.ARTEMIS_TOKEN), undefined);

        await authManager.storeArtemisCredentials('jwt=second', true);
        assert.strictEqual(await authManager.clearIfUnchanged(revision), false,
            'a logout must not delete a session the user started after it');
        assert.strictEqual(await context.secrets.get(CONFIG.SECRET_KEYS.ARTEMIS_TOKEN), 'jwt=second');
    });

    test('a rejected mutation does not strand the operations queued behind it', async () => {
        await authManager.storeArtemisCredentials('jwt=existing', true);
        // `secrets` is an instance field, so there is no prototype method to restore from. Keep the
        // original bound method and put it back by hand.
        const originalStore = context.secrets.store.bind(context.secrets);
        context.secrets.store = async () => { throw new Error('keychain unavailable'); };

        await assert.rejects(() => authManager.storeArtemisCredentials('jwt=candidate', true));

        context.secrets.store = originalStore;
        await authManager.clear();
        assert.strictEqual(await context.secrets.get(CONFIG.SECRET_KEYS.ARTEMIS_TOKEN), undefined);
    });

    test('getAuthContext reports the headers and the revision they belong to', async () => {
        await authManager.storeArtemisCredentials('jwt=live', true);

        const { headers, revision } = await authManager.getAuthContext();

        assert.deepStrictEqual(headers, { 'Cookie': 'jwt=live' });
        assert.strictEqual(revision, authManager.currentCredentialRevision());
    });

    test('bearer mode commits in memory, moves the revision, and never touches SecretStorage', async () => {
        await context.secrets.store(CONFIG.SECRET_KEYS.ARTEMIS_TOKEN, 'jwt=desktop-leftover');
        authManager.enableBearerAuth();
        const revisionBefore = authManager.currentCredentialRevision();

        assert.strictEqual(await authManager.storeArtemisCredentials('raw-jwt', false), true);

        assert.notStrictEqual(authManager.currentCredentialRevision(), revisionBefore,
            'without this a logout barrier would erase a newer Theia credential');
        assert.strictEqual(await context.secrets.get(CONFIG.SECRET_KEYS.ARTEMIS_TOKEN), 'jwt=desktop-leftover');
        assert.deepStrictEqual(await authManager.getAuthHeaders(), { 'Authorization': 'Bearer raw-jwt' });
    });

    test('bearer mode without a memory token is unauthenticated, not the Desktop secret', async () => {
        await context.secrets.store(CONFIG.SECRET_KEYS.ARTEMIS_TOKEN, 'jwt=desktop-leftover');
        authManager.enableBearerAuth();

        const { headers } = await authManager.getAuthContext();

        assert.deepStrictEqual(headers, {},
            'reading the Desktop secret here would send it as "Authorization: Bearer jwt=<token>"');
        assert.deepStrictEqual(await authManager.getAuthHeaders(), {});
    });

    test('bearer mode clears in memory without deleting the Desktop secret', async () => {
        await context.secrets.store(CONFIG.SECRET_KEYS.ARTEMIS_TOKEN, 'jwt=desktop-leftover');
        authManager.enableBearerAuth();
        await authManager.storeArtemisCredentials('raw-jwt', false);

        await authManager.clearIfUnchanged(authManager.currentCredentialRevision());

        assert.strictEqual(await context.secrets.get(CONFIG.SECRET_KEYS.ARTEMIS_TOKEN), 'jwt=desktop-leftover');
        assert.deepStrictEqual(await authManager.getAuthHeaders(), {});
    });
});
