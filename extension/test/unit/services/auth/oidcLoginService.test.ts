import * as vscode from 'vscode';
import * as assert from 'assert';
import * as sinon from 'sinon';

import { ArtemisApiService } from '@extension/api/artemisApi';
import { AuthManager } from '@extension/services/auth/authManager';
import { LoginCancelledError } from '@extension/services/auth/loginCancelledError';
import { OidcLoginService } from '@extension/services/auth/oidcLoginService';
import { CONFIG } from '@extension/utils/constants';
import { MockExtensionContext } from '@test/unit/mocks/vscodeMocks';

const PENDING_KEY = CONFIG.SECRET_KEYS.OIDC_PENDING_LOGIN;
const VALID_VERIFIER = 'a'.repeat(43);

suite('OidcLoginService Test Suite', () => {
    let context: MockExtensionContext;
    let authManager: AuthManager;
    let api: ArtemisApiService;
    let service: OidcLoginService;
    let sandbox: sinon.SinonSandbox;
    let configuredServerUrl: string;

    /** A promise plus the lever that settles it, for parking a call at the boundary under test. */
    function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
        let resolve!: (value: T) => void;
        const promise = new Promise<T>(r => { resolve = r; });
        return { promise, resolve };
    }

    setup(() => {
        sandbox = sinon.createSandbox();
        configuredServerUrl = 'https://artemis.tum.de';
        // resolveServerUrl() reads this every time it runs, which is exactly the behaviour the
        // server-switch test needs to drive.
        sandbox.stub(vscode.workspace, 'getConfiguration').returns({
            get: (_key: string, fallback?: unknown) => configuredServerUrl ?? fallback,
        } as unknown as vscode.WorkspaceConfiguration);
        context = new MockExtensionContext();
        authManager = new AuthManager(context);
        api = new ArtemisApiService(authManager);
        service = new OidcLoginService(context, authManager, api);
        sandbox.stub(vscode.env, 'openExternal').resolves(true);
    });

    teardown(() => sandbox.restore());

    async function writePending(overrides: Record<string, unknown> = {}): Promise<void> {
        const serverUrl = configuredServerUrl;
        await context.secrets.store(PENDING_KEY, JSON.stringify({
            attemptId: 'attempt-1',
            codeVerifier: VALID_VERIFIER,
            rememberMe: true,
            startedAt: Date.now(),
            serverUrl,
            ...overrides,
        }));
    }

    test('start records a pending attempt and opens the browser', async () => {
        await service.start(true);

        const stored = await context.secrets.get(PENDING_KEY);
        assert.ok(stored, 'the attempt must survive an extension host reload');
        const parsed = JSON.parse(stored);
        assert.strictEqual(parsed.rememberMe, true);
        assert.match(parsed.codeVerifier, /^[a-zA-Z0-9\-._~]{43,128}$/);
    });

    test('start leaves no pending attempt when the browser refuses to open', async () => {
        (vscode.env.openExternal as sinon.SinonStub).resolves(false);

        await assert.rejects(() => service.start(true), /browser could not be opened/);

        assert.strictEqual(await context.secrets.get(PENDING_KEY), undefined);
    });

    test('start leaves no pending attempt when opening the browser rejects', async () => {
        (vscode.env.openExternal as sinon.SinonStub).rejects(new Error('no handler'));

        await assert.rejects(() => service.start(true), /no handler/);

        assert.strictEqual(await context.secrets.get(PENDING_KEY), undefined);
    });

    test('cleanup of a superseded attempt does not discard the newer record', async () => {
        // The second window started an attempt while the first was still opening its browser.
        (vscode.env.openExternal as sinon.SinonStub).callsFake(async () => {
            await writePending({ attemptId: 'newer-attempt' });
            return false;
        });

        await assert.rejects(() => service.start(true));

        const stored = await context.secrets.get(PENDING_KEY);
        assert.ok(stored, 'the newer attempt must survive the older one cleaning up after itself');
        assert.strictEqual(JSON.parse(stored).attemptId, 'newer-attempt');
    });

    test('complete rejects when nothing is pending', async () => {
        await assert.rejects(() => service.complete('code'), /no longer valid/);
    });

    test('complete rejects an attempt that has been abandoned for too long', async () => {
        await writePending({ startedAt: Date.now() - 30 * 60 * 1000 });

        await assert.rejects(() => service.complete('code'), /no longer valid/);
    });

    test('a slow identity provider login is still redeemable locally', async () => {
        // The local window starts when the browser opens, the server's five minutes only once the identity
        // provider is done, so matching the two would reject codes the server still accepts.
        await writePending({ startedAt: Date.now() - 10 * 60 * 1000 });
        sandbox.stub(api, 'exchangeCodeForToken').resolves('raw-jwt');
        sandbox.stub(api, 'getCurrentUserWithToken').resolves({ id: 1, login: 'student' } as never);

        const user = await service.complete('code');

        assert.strictEqual(user.login, 'student');
    });

    test('complete treats a malformed or future record as absent', async () => {
        await context.secrets.store(PENDING_KEY, 'not json');
        await assert.rejects(() => service.complete('code'), /no longer valid/);

        await writePending({ codeVerifier: 'too-short' });
        await assert.rejects(() => service.complete('code'), /no longer valid/);

        await writePending({ startedAt: Date.now() + 60_000 });
        await assert.rejects(() => service.complete('code'), /no longer valid/);
    });

    test('complete refuses a code issued by a different server', async () => {
        await writePending({ serverUrl: 'https://artemis.example.org' });

        await assert.rejects(() => service.complete('code'), /different Artemis server/);
    });

    test('a failing exchange leaves an existing session untouched', async () => {
        await authManager.storeArtemisCredentials('jwt=existing', true);
        await writePending();
        sandbox.stub(api, 'exchangeCodeForToken').rejects(new Error('code expired'));

        await assert.rejects(() => service.complete('code'), /code expired/);

        assert.strictEqual(await context.secrets.get(CONFIG.SECRET_KEYS.ARTEMIS_TOKEN), 'jwt=existing');
        assert.deepStrictEqual(await authManager.getAuthHeaders(), { 'Cookie': 'jwt=existing' });
    });

    test('a candidate the server will not accept is never committed', async () => {
        await authManager.storeArtemisCredentials('jwt=existing', true);
        await writePending();
        sandbox.stub(api, 'exchangeCodeForToken').resolves('raw-jwt');
        sandbox.stub(api, 'getCurrentUserWithToken').rejects(new Error('not authenticated'));

        await assert.rejects(() => service.complete('code'), /not authenticated/);

        assert.strictEqual(await context.secrets.get(CONFIG.SECRET_KEYS.ARTEMIS_TOKEN), 'jwt=existing');
    });

    test('declining to be remembered stores nothing and clears an earlier opt-in', async () => {
        await authManager.storeArtemisCredentials('jwt=remembered', true);
        await writePending({ rememberMe: false });
        sandbox.stub(api, 'exchangeCodeForToken').resolves('raw-jwt');
        sandbox.stub(api, 'getCurrentUserWithToken').resolves({ id: 1, login: 'student' } as never);

        await service.complete('code');

        assert.strictEqual(await context.secrets.get(CONFIG.SECRET_KEYS.ARTEMIS_TOKEN), undefined);
        assert.deepStrictEqual(await authManager.getAuthHeaders(), { 'Cookie': 'jwt=raw-jwt' });
    });

    test('cancel makes a later callback fail instead of signing the user in', async () => {
        await writePending();

        await service.cancel();

        await assert.rejects(() => service.complete('code'), /no longer valid/);
    });

    test('a logout during the exchange stops the commit', async () => {
        await writePending();
        sandbox.stub(api, 'exchangeCodeForToken').callsFake(async () => {
            // The user logs out while the browser callback is still being redeemed.
            await service.cancel();
            return 'raw-jwt';
        });
        sandbox.stub(api, 'getCurrentUserWithToken').resolves({ id: 1, login: 'student' } as never);

        await assert.rejects(() => service.complete('code'), LoginCancelledError);

        assert.strictEqual(await context.secrets.get(CONFIG.SECRET_KEYS.ARTEMIS_TOKEN), undefined,
            'consuming the record is not enough: a later cancel has nothing left to delete');
    });

    test('switching server during the exchange stops the commit', async () => {
        await writePending();
        sandbox.stub(api, 'exchangeCodeForToken').resolves('raw-jwt');
        sandbox.stub(api, 'getCurrentUserWithToken').callsFake(async () => {
            // The setting changes while the candidate is being checked against the old server.
            configuredServerUrl = 'https://artemis.example.org';
            return { id: 1, login: 'student' } as never;
        });

        await assert.rejects(() => service.complete('code'), /different Artemis server/);

        assert.strictEqual(await context.secrets.get(CONFIG.SECRET_KEYS.ARTEMIS_TOKEN), undefined,
            "a token from the previous server must not be stored against the new one");
    });

    test('a code can only be redeemed once', async () => {
        await writePending();
        sandbox.stub(api, 'exchangeCodeForToken').resolves('raw-jwt');
        sandbox.stub(api, 'getCurrentUserWithToken').resolves({ id: 1, login: 'student' } as never);

        await service.complete('code');

        await assert.rejects(() => service.complete('code'), /no longer valid/);
    });

    test('cancel A, start B, then A comes back: A is refused and B still works', async () => {
        // The scenario a per-service boolean passes and must not. cancelGeneration alone cannot see it
        // either: complete() captures the already-incremented value as its own starting point, so the
        // cancellation looks to it like it never happened.
        await service.start(true);
        const recordA = await context.secrets.get(PENDING_KEY);
        await service.cancel();
        await service.start(true);
        const recordB = await context.secrets.get(PENDING_KEY);
        sandbox.stub(api, 'exchangeCodeForToken').resolves('raw-jwt');
        sandbox.stub(api, 'getCurrentUserWithToken').resolves({ id: 1, login: 'student' } as never);

        // A's browser tab comes back: its record deletion had not landed yet.
        await context.secrets.store(PENDING_KEY, recordA!);
        await assert.rejects(() => service.complete('code-a'), LoginCancelledError);

        // B was never retracted and must still be redeemable.
        await context.secrets.store(PENDING_KEY, recordB!);
        const user = await service.complete('code-b');
        assert.strictEqual(user.login, 'student');
    });

    test('a cancel during the commit leaves the previous credential in place', async () => {
        await authManager.storeArtemisCredentials('jwt=existing', true);
        await writePending();
        sandbox.stub(api, 'exchangeCodeForToken').resolves('raw-jwt');
        sandbox.stub(api, 'getCurrentUserWithToken').resolves({ id: 1, login: 'student' } as never);
        const originalStore = context.secrets.store.bind(context.secrets);
        // Cancelled from inside the write, so this exercises the rollback rather than the pre-check.
        // Guarded, because the rollback writes the previous value back through this same stub.
        let stores = 0;
        context.secrets.store = async (key: string, value: string) => {
            await originalStore(key, value);
            if (key === CONFIG.SECRET_KEYS.ARTEMIS_TOKEN && ++stores === 1) {
                await service.cancel();
            }
        };

        await assert.rejects(() => service.complete('code'), LoginCancelledError);
        assert.strictEqual(await context.secrets.get(CONFIG.SECRET_KEYS.ARTEMIS_TOKEN), 'jwt=existing');
    });

    test('a restart that overtakes a cancellation keeps its own record', async () => {
        // The window the merged A/B test cannot reach: A's record deletion is still in flight when B
        // starts. Without ordering, that deletion lands on B's record and B is left unredeemable.
        await service.start(true);
        const originalDelete = context.secrets.delete.bind(context.secrets);
        const holdDelete = deferred<void>();
        context.secrets.delete = async (key: string) => {
            await holdDelete.promise;
            await originalDelete(key);
        };

        const cancelling = service.cancel();
        const starting = service.start(true);
        holdDelete.resolve();
        await Promise.all([cancelling, starting]);

        assert.ok(await context.secrets.get(PENDING_KEY),
            'the restart must not be left recordless by the cancellation it replaced');
    });

    test('a cancel during start neither opens the browser nor leaves a redeemable record', async () => {
        (vscode.env.openExternal as sinon.SinonStub).resolves(true);
        const originalStore = context.secrets.store.bind(context.secrets);
        context.secrets.store = async (key: string, value: string) => {
            await originalStore(key, value);
            await service.cancel();
        };

        await assert.rejects(() => service.start(true), LoginCancelledError);

        assert.ok((vscode.env.openExternal as sinon.SinonStub).notCalled);
        assert.strictEqual(await context.secrets.get(PENDING_KEY), undefined);
    });
});
