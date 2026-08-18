import * as vscode from 'vscode';
import * as assert from 'assert';
import * as sinon from 'sinon';

import { ArtemisApiService } from '@extension/api/artemisApi';
import { AuthManager } from '@extension/services/auth/authManager';
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

    setup(() => {
        sandbox = sinon.createSandbox();
        context = new MockExtensionContext();
        authManager = new AuthManager(context);
        api = new ArtemisApiService(authManager);
        service = new OidcLoginService(context, authManager, api);
        sandbox.stub(vscode.env, 'openExternal').resolves(true);
    });

    teardown(() => sandbox.restore());

    async function writePending(overrides: Record<string, unknown> = {}): Promise<void> {
        const serverUrl = 'https://artemis.tum.de';
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

    test('complete rejects an attempt that has reached the server side time limit', async () => {
        await writePending({ startedAt: Date.now() - 5 * 60 * 1000 });

        await assert.rejects(() => service.complete('code'), /no longer valid/);
    });

    test('complete accepts an attempt just inside the time limit', async () => {
        await writePending({ startedAt: Date.now() - (5 * 60 * 1000 - 1000) });
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

    test('a code can only be redeemed once', async () => {
        await writePending();
        sandbox.stub(api, 'exchangeCodeForToken').resolves('raw-jwt');
        sandbox.stub(api, 'getCurrentUserWithToken').resolves({ id: 1, login: 'student' } as never);

        await service.complete('code');

        await assert.rejects(() => service.complete('code'), /no longer valid/);
    });
});
