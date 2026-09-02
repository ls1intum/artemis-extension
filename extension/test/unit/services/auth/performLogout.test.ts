import * as vscode from 'vscode';
import * as assert from 'assert';
import * as sinon from 'sinon';

import type { ArtemisApiService } from '@extension/api';
import type { AuthCancellationService, AuthManager, LogoutDeps } from '@extension/services/auth';
import { performLogout } from '@extension/services/auth';

/**
 * `performLogout` is the one implementation behind both logout entry points:
 * the `artemis.logout` command and the webview's logout command. The command
 * path has no test of its own, so these cover the handshake directly.
 */
suite('performLogout', () => {
    let sandbox: sinon.SinonSandbox;
    let showInformationMessage: sinon.SinonStub;
    let showErrorMessage: sinon.SinonStub;

    /** Order of the externally visible steps, so sequencing can be asserted. */
    let trace: string[];
    let deps: LogoutDeps & {
        authManager: sinon.SinonStubbedInstance<AuthManager>;
        artemisApi: sinon.SinonStubbedInstance<ArtemisApiService>;
        authCancellation: sinon.SinonStubbedInstance<AuthCancellationService>;
    };
    let showLogin: sinon.SinonStub;
    let updateAuthContext: sinon.SinonStub;

    setup(() => {
        sandbox = sinon.createSandbox();
        trace = [];
        showInformationMessage = sandbox.stub(vscode.window, 'showInformationMessage').resolves(undefined);
        showErrorMessage = sandbox.stub(vscode.window, 'showErrorMessage').resolves(undefined);

        showLogin = sandbox.stub().callsFake(() => trace.push('showLogin'));
        updateAuthContext = sandbox.stub().callsFake(async () => { trace.push('updateAuthContext'); });

        deps = {
            authManager: {
                currentCredentialRevision: sandbox.stub().callsFake(() => { trace.push('revision'); return 7; }),
                clearIfUnchanged: sandbox.stub().callsFake(async () => { trace.push('clear'); return true; }),
            } as unknown as sinon.SinonStubbedInstance<AuthManager>,
            artemisApi: {
                logoutFromServer: sandbox.stub().callsFake(async () => { trace.push('serverLogout'); }),
            } as unknown as sinon.SinonStubbedInstance<ArtemisApiService>,
            authCancellation: {
                cancelAll: sandbox.stub().callsFake(async () => { trace.push('cancelAll'); }),
            } as unknown as sinon.SinonStubbedInstance<AuthCancellationService>,
            updateAuthContext,
            showLogin,
        } as typeof deps;
    });

    teardown(() => sandbox.restore());

    test('clears the credential, updates the context, and shows the login surface', async () => {
        await performLogout(deps);

        assert.deepStrictEqual(trace, [
            'revision', 'cancelAll', 'serverLogout', 'clear', 'updateAuthContext', 'showLogin',
        ]);
        assert.ok(deps.authManager.clearIfUnchanged.calledOnceWithExactly(7));
        assert.ok(updateAuthContext.calledOnceWithExactly(false));
        assert.ok(showInformationMessage.calledOnceWithExactly('Successfully logged out of Artemis'));
    });

    test('captures the revision and cancels sign-ins before the first await', async () => {
        // Both happen synchronously, so a sign-in racing this logout cannot slip
        // between the read and the cancellation.
        const pending = performLogout(deps);

        assert.deepStrictEqual(trace, ['revision', 'cancelAll']);
        await pending;
    });

    test('leaves the UI alone when a newer sign-in superseded the logout', async () => {
        deps.authManager.clearIfUnchanged.resolves(false);

        await performLogout(deps);

        assert.ok(updateAuthContext.notCalled, 'the new session must stay authenticated');
        assert.ok(showLogin.notCalled, 'signing the user out of a session they just started strands them');
        assert.ok(showInformationMessage.notCalled);
    });

    test('reports a failure without showing the login surface', async () => {
        deps.authManager.clearIfUnchanged.rejects(new Error('secret storage unavailable'));

        await performLogout(deps);

        assert.ok(showErrorMessage.calledOnceWithExactly('Error during logout'));
        assert.ok(showLogin.notCalled, 'a login form over a credential that is still there is a lie');
    });
});
