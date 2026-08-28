import * as vscode from 'vscode';
import * as assert from 'assert';
import * as sinon from 'sinon';

import type { ExtensionToWebviewMessage } from '@shared/messageContracts';

import { ArtemisApiService } from '@extension/api/artemisApi';
import { AuthManager } from '@extension/services/auth/authManager';
import { HandoverFailureStore } from '@extension/services/auth/handoverFailureStore';
import { LoginCancelledError } from '@extension/services/auth/loginCancelledError';
import { createOidcLoginCallback } from '@extension/services/auth/oidcLoginCallback';
import { OidcLoginService } from '@extension/services/auth/oidcLoginService';
import { CONFIG } from '@extension/utils/constants';
import { MockExtensionContext } from '@test/unit/mocks/vscodeMocks';

suite('OIDC login callback Test Suite', () => {
    let sandbox: sinon.SinonSandbox;
    let context: MockExtensionContext;
    let authManager: AuthManager;
    let service: OidcLoginService;
    let messages: ExtensionToWebviewMessage[];
    let authContextUpdates: boolean[];

    setup(() => {
        sandbox = sinon.createSandbox();
        context = new MockExtensionContext();
        authManager = new AuthManager(context);
        service = new OidcLoginService(context, authManager, new ArtemisApiService(authManager));
        messages = [];
        authContextUpdates = [];
        sandbox.stub(vscode.window, 'showErrorMessage').resolves(undefined);
        sandbox.stub(vscode.window, 'showInformationMessage').resolves(undefined);
        sandbox.stub(vscode.env, 'openExternal').resolves(true);
    });

    teardown(() => sandbox.restore());

    function build(overrides: { navigateToStartPage?: () => Promise<void>; handoverFailures?: HandoverFailureStore } = {}) {
        return createOidcLoginCallback({
            oidcLoginService: service,
            handoverFailures: overrides.handoverFailures ?? new HandoverFailureStore(),
            updateAuthContext: async isAuthenticated => { authContextUpdates.push(isAuthenticated); },
            postMessage: message => { messages.push(message); },
            navigateToStartPage: overrides.navigateToStartPage ?? (async () => {}),
        });
    }

    test('a failed completion reports a login error and keeps the existing session', async () => {
        await authManager.storeArtemisCredentials('jwt=existing', true);
        sandbox.stub(service, 'complete').rejects(new Error('The login code has expired or is invalid.'));

        await build().onCode('stale-code');

        assert.strictEqual(messages.length, 1);
        assert.strictEqual(messages[0].type, 'loginError');
        assert.deepStrictEqual(authContextUpdates, [], 'a failed login must not touch the auth context');
        assert.strictEqual(await context.secrets.get(CONFIG.SECRET_KEYS.ARTEMIS_TOKEN), 'jwt=existing');
    });

    test('a failure after the commit is not reported as a failed login', async () => {
        // complete() is stubbed, so commit the credential here too. Without it the test would pass even
        // if nothing had been stored, which is the very thing it claims to be protecting.
        sandbox.stub(service, 'complete').callsFake(async () => {
            await authManager.storeArtemisCredentials('jwt=fresh', true);
            return { id: 1, login: 'student' } as never;
        });

        await build({ navigateToStartPage: async () => { throw new Error('view disposed'); } }).onCode('code');

        assert.strictEqual(await context.secrets.get(CONFIG.SECRET_KEYS.ARTEMIS_TOKEN), 'jwt=fresh',
            'the credential survives a failure in the wiring that follows it');
        assert.deepStrictEqual(authContextUpdates, [true]);
        assert.deepStrictEqual(messages.map(m => m.type), ['loginSuccess', 'loginHandoverFailed'],
            'the user is signed in at this point, so a broken view must not claim the login FAILED, '
            + 'but it must still be told, or it waits forever on a handover that is not coming');
        assert.ok(!messages.some(m => m.type === 'loginError'),
            'the credential is committed, so nothing here may read as "your login did not work"');
    });

    test('a failure in the auth context still tells the view the login succeeded', async () => {
        sandbox.stub(service, 'complete').resolves({ id: 1, login: 'student' } as never);
        const callback = createOidcLoginCallback({
            oidcLoginService: service,
            handoverFailures: new HandoverFailureStore(),
            updateAuthContext: async () => { throw new Error('context command failed'); },
            postMessage: message => { messages.push(message); },
            navigateToStartPage: async () => {},
        });

        await callback.onCode('code');

        // Success first, because the login really did work. The handover failure after it is what stops
        // the view waiting on an app that is never going to open.
        assert.deepStrictEqual(messages.map(m => m.type), ['loginSuccess', 'loginHandoverFailed']);
    });

    test('a superseded handover cannot record its failure over a newer one', async () => {
        const handoverFailures = new HandoverFailureStore();
        sandbox.stub(service, 'complete').resolves({ id: 1, login: 'student' } as never);

        await build({
            handoverFailures,
            // A newer sign-in opens its own handover while this one is still wiring up. The old one's
            // failure is no longer news about anything the user is waiting for.
            navigateToStartPage: async () => { handoverFailures.begin(); throw new Error('view disposed'); },
        }).onCode('code');

        assert.strictEqual(handoverFailures.current, undefined);
        assert.deepStrictEqual(messages.map(m => m.type), ['loginSuccess']);
    });

    test('a cancelled sign-in is not reported as a failure', async () => {
        sandbox.stub(service, 'complete').rejects(new LoginCancelledError());

        await build().onCode('code');

        assert.deepStrictEqual(messages, [], 'the user cancelled; an error would contradict their own action');
        assert.ok((vscode.window.showErrorMessage as sinon.SinonStub).notCalled);
    });

    test('a browser side error discards the pending attempt and tells the view', async () => {
        const cancel = sandbox.spy(service, 'cancel');

        await build().onError('Your account is deactivated in Artemis.');

        assert.ok(cancel.calledOnce, 'the attempt is dead, leaving it pending invites a stray redemption');
        assert.strictEqual(messages.length, 1);
        assert.strictEqual(messages[0].type, 'loginError');
        assert.deepStrictEqual(authContextUpdates, []);
    });

    test('a browser error for an already-retracted attempt is not reported', async () => {
        await service.start(true);
        await service.cancel();
        const cancel = sandbox.spy(service, 'cancel');

        await build().onError('access_denied');

        assert.ok(cancel.notCalled, 'the attempt is already gone; there is nothing left to retract');
        assert.deepStrictEqual(messages, [], 'a browser error for an attempt the user already retracted is not news');
        assert.ok((vscode.window.showErrorMessage as sinon.SinonStub).notCalled);
    });
});
