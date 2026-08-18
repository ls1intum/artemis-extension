import * as vscode from 'vscode';
import * as assert from 'assert';

import { ArtemisUriHandler } from '@extension/services/auth/artemisUriHandler';

function callbackUri(path: string, query: string): vscode.Uri {
    return { path, query } as vscode.Uri;
}

suite('Artemis URI Handler Test Suite', () => {
    let codes: string[];
    let errors: string[];
    let handler: ArtemisUriHandler;

    setup(() => {
        codes = [];
        errors = [];
        handler = new ArtemisUriHandler(
            async code => { codes.push(code); },
            async message => { errors.push(message); },
        );
    });

    test('passes the code on for the auth callback path', async () => {
        await handler.handleUri(callbackUri('/auth-callback', 'code=test_code_123'));

        assert.deepStrictEqual(codes, ['test_code_123']);
        assert.deepStrictEqual(errors, []);
    });

    test('ignores a deep link meant for something else', async () => {
        await handler.handleUri(callbackUri('/some-other-feature', 'code=test_code_123'));

        assert.deepStrictEqual(codes, [], 'a foreign path must not be redeemed as a login');
        assert.deepStrictEqual(errors, []);
    });

    test('reports the errors the server actually sends, without redeeming a code', async () => {
        await handler.handleUri(callbackUri('/auth-callback', 'error=deactivated'));
        await handler.handleUri(callbackUri('/auth-callback', 'error=invalid_request'));
        await handler.handleUri(callbackUri('/auth-callback', 'error=server_error'));
        await handler.handleUri(callbackUri('/auth-callback', 'error=something_new'));

        assert.deepStrictEqual(codes, []);
        assert.strictEqual(errors.length, 4);
        assert.match(errors[0], /deactivated in Artemis/);
        assert.match(errors[1], /could not verify this sign-in/);
        assert.match(errors[2], /could not complete the sign-in/);
        assert.match(errors[3], /Authentication failed in browser/);
    });

    test('redeems a callback whose windowId marker folded into the path', async () => {
        // What asExternalUri can produce on the way back. A strict path comparison rejected exactly this
        // shape once before, and the sign-in then failed with no visible reason.
        await handler.handleUri(callbackUri('/auth-callback?windowId=3', 'code=test_code_123'));

        assert.deepStrictEqual(codes, ['test_code_123']);
        assert.deepStrictEqual(errors, []);
    });

    test('reads the code out of the path when the whole query folded into it', async () => {
        await handler.handleUri(callbackUri('/auth-callback?windowId=3&code=folded_code', ''));

        assert.deepStrictEqual(codes, ['folded_code']);
        assert.deepStrictEqual(errors, []);
    });

    test('a path that merely starts like the callback is still ignored', async () => {
        await handler.handleUri(callbackUri('/auth-callback-elsewhere', 'code=test_code_123'));
        await handler.handleUri(callbackUri('/auth-callback-elsewhere?windowId=3', 'code=test_code_123'));

        assert.deepStrictEqual(codes, [], 'stripping the query must not turn a near miss into a match');
        assert.deepStrictEqual(errors, []);
    });

    test('reports a callback that carries neither a code nor an error', async () => {
        await handler.handleUri(callbackUri('/auth-callback', ''));

        assert.deepStrictEqual(codes, []);
        assert.strictEqual(errors.length, 1);
    });
});
