import * as vscode from 'vscode';
import * as assert from 'assert';
import * as sinon from 'sinon';

import { startBrowserLogin } from '@extension/services/auth/externalLoginStarter';
import { PendingExternalLoginStore } from '@extension/services/auth/pendingExternalLogin';
import { MockExtensionContext } from '@test/unit/mocks/vscodeMocks';

suite('startBrowserLogin', () => {
    let sandbox: sinon.SinonSandbox;
    let context: MockExtensionContext;
    let openExternal: sinon.SinonStub;

    const EXTENSION_ID = 'aet-tum.iris-thaumantias';

    setup(() => {
        sandbox = sinon.createSandbox();
        context = new MockExtensionContext();
        (context as unknown as { extension: { id: string } }).extension = { id: EXTENSION_ID };
        sandbox.replaceGetter(vscode.env, 'uriScheme', () => 'vscode');
        sandbox.stub(vscode.env, 'asExternalUri').callsFake(async (uri: vscode.Uri) => uri);
        openExternal = sandbox.stub(vscode.env, 'openExternal').resolves(true as never);
    });

    teardown(() => {
        sandbox.restore();
    });

    test('persists pending state and opens the browser with challenge, callback and state', async () => {
        await startBrowserLogin(context);

        const pending = await new PendingExternalLoginStore(context).load();
        assert.ok(pending, 'pending login must be persisted');
        assert.ok(pending!.verifier.length > 0, 'verifier must be stored');
        assert.ok(pending!.state.length > 0, 'state must be stored');

        sinon.assert.calledOnce(openExternal);
        // toString(true) = skipEncoding, so the already-encoded query is not re-encoded for inspection.
        const opened = new URL((openExternal.firstCall.args[0] as vscode.Uri).toString(true));
        assert.ok(opened.pathname.endsWith('/external-login'), `expected external-login path, got ${opened.pathname}`);
        assert.ok(opened.searchParams.get('code_challenge'), 'code_challenge must be present');
        assert.strictEqual(opened.searchParams.get('state'), pending!.state, 'state must match the persisted state');

        const callback = opened.searchParams.get('callback');
        assert.ok(callback, 'callback must be present');
        assert.ok(callback!.startsWith(`vscode://${EXTENSION_ID}/`), `callback must target the extension id, got ${callback}`);
        assert.ok(callback!.endsWith('/external-login-callback'), 'callback path must be the external-login-callback');
    });

    test('keeps the asExternalUri windowId marker as a real query param (not folded into the path)', async () => {
        // asExternalUri adds ?windowId=N for window-correct routing. toString(true) keeps it a proper
        // query param so the callback round-trips back as a query rather than folded into the path.
        (vscode.env.asExternalUri as sinon.SinonStub).callsFake(async (uri: vscode.Uri) => uri.with({ query: 'windowId=7' }));

        await startBrowserLogin(context);

        const opened = new URL((openExternal.firstCall.args[0] as vscode.Uri).toString(true));
        const callback = opened.searchParams.get('callback');
        assert.ok(callback, 'callback must be present');
        const callbackUrl = new URL(callback!);
        assert.strictEqual(callbackUrl.pathname, '/external-login-callback', 'windowId must not leak into the path');
        assert.strictEqual(callbackUrl.searchParams.get('windowId'), '7', 'windowId must stay a real query param');
    });
});
