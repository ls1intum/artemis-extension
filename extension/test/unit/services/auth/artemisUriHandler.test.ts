import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';

import { ArtemisUriHandler } from '@extension/services/auth/artemisUriHandler';

suite('ArtemisUriHandler Test Suite', () => {
    let sandbox: sinon.SinonSandbox;
    let handleTokenStub: sinon.SinonStub;
    let uriHandler: ArtemisUriHandler;
    let showErrorMessageStub: sinon.SinonStub;

    setup(() => {
        sandbox = sinon.createSandbox();
        handleTokenStub = sandbox.stub().resolves();
        showErrorMessageStub = sandbox.stub(vscode.window, 'showErrorMessage');
        uriHandler = new ArtemisUriHandler(handleTokenStub);
    });

    teardown(() => {
        sandbox.restore();
    });

    test('invokes handleToken when token parameter is present in URI', async () => {
        const uri = vscode.Uri.parse('vscode://ls1intum.artemis-vscode/auth-callback?token=test_jwt_token');

        await uriHandler.handleUri(uri);

        assert.ok(handleTokenStub.calledWith('test_jwt_token'));
        assert.ok(showErrorMessageStub.notCalled);
    });

    test('shows error message when error query param is deactivated', async () => {
        const uri = vscode.Uri.parse('vscode://ls1intum.artemis-vscode/auth-callback?error=deactivated');

        await uriHandler.handleUri(uri);

        assert.ok(handleTokenStub.notCalled);
        assert.ok(showErrorMessageStub.calledOnce);
        assert.ok(showErrorMessageStub.firstCall.args[0].includes('deactivated'));
    });

    test('shows default error message when no token or error param is provided', async () => {
        const uri = vscode.Uri.parse('vscode://ls1intum.artemis-vscode/auth-callback');

        await uriHandler.handleUri(uri);

        assert.ok(handleTokenStub.notCalled);
        assert.ok(showErrorMessageStub.calledWith('Artemis Login failed: No auth token received from server.'));
    });
});
