import * as assert from 'assert';

import { PendingExternalLogin, PendingExternalLoginStore } from '@extension/services/auth/pendingExternalLogin';
import { CONFIG } from '@extension/utils';
import { MockExtensionContext } from '@test/unit/mocks/vscodeMocks';

suite('PendingExternalLoginStore', () => {
    let context: MockExtensionContext;
    let store: PendingExternalLoginStore;

    const sample: PendingExternalLogin = { verifier: 'v', state: 's', createdAt: 1000, serverUrl: 'https://artemis.example.com' };

    setup(() => {
        context = new MockExtensionContext();
        store = new PendingExternalLoginStore(context);
    });

    test('saves and loads a pending login round-trip', async () => {
        await store.save(sample);
        assert.deepStrictEqual(await store.load(), sample);
    });

    test('load returns undefined when nothing is stored', async () => {
        assert.strictEqual(await store.load(), undefined);
    });

    test('clear removes the pending login', async () => {
        await store.save(sample);
        await store.clear();
        assert.strictEqual(await store.load(), undefined);
    });

    test('load returns undefined on corrupt JSON', async () => {
        await context.secrets.store(CONFIG.SECRET_KEYS.PENDING_EXTERNAL_LOGIN, '{ not json');
        assert.strictEqual(await store.load(), undefined);
    });

    test('isExpired is false within the TTL and true past it', () => {
        assert.strictEqual(store.isExpired(sample, sample.createdAt + 5 * 60 * 1000), false);
        assert.strictEqual(store.isExpired(sample, sample.createdAt + 11 * 60 * 1000), true);
    });
});
