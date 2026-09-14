import * as vscode from 'vscode';
import * as assert from 'assert';
import * as sinon from 'sinon';

import { serverDisplayName } from '@shared/utils/serverDisplayName';

import { initializeTheiaContext } from '@extension/theia/theiaEnvironment';
import { isServerUrlLocked } from '@extension/utils';

suite('serverDisplayName', () => {
    test('reduces a plain https URL to its host', () => {
        assert.strictEqual(serverDisplayName('https://artemis.tum.de'), 'artemis.tum.de');
    });

    test('keeps a non-default port', () => {
        assert.strictEqual(serverDisplayName('http://localhost:8080'), 'localhost:8080');
    });

    test('keeps a path prefix, because it is part of which server you are on', () => {
        assert.strictEqual(serverDisplayName('https://example.edu/artemis'), 'example.edu/artemis');
    });

    test('drops a trailing slash', () => {
        assert.strictEqual(serverDisplayName('https://artemis.tum.de/'), 'artemis.tum.de');
        assert.strictEqual(serverDisplayName('https://example.edu/artemis/'), 'example.edu/artemis');
    });

    test('passes through a value with no scheme, which the setting allows', () => {
        assert.strictEqual(serverDisplayName('artemis.tum.de'), 'artemis.tum.de');
    });

    test('passes through a scheme-less host:port, which URL() misreads as a scheme', () => {
        // `new URL('localhost:8080')` does not throw: it reads `localhost:` as the protocol and
        // leaves the host empty, so a naive `.host` would render this as "8080".
        assert.strictEqual(serverDisplayName('localhost:8080'), 'localhost:8080');
    });

    test('passes through a protocol that is not http(s)', () => {
        assert.strictEqual(serverDisplayName('ftp://artemis.tum.de'), 'ftp://artemis.tum.de');
    });

    test('trims surrounding whitespace', () => {
        assert.strictEqual(serverDisplayName('  https://artemis.tum.de  '), 'artemis.tum.de');
    });

    test('answers empty for an empty value, so the caller shows no description', () => {
        assert.strictEqual(serverDisplayName(''), '');
        assert.strictEqual(serverDisplayName('   '), '');
    });
});

suite('isServerUrlLocked', () => {
    let originalBridge: string | undefined;

    setup(() => {
        originalBridge = process.env.DATA_BRIDGE_ENABLED;
    });

    teardown(async () => {
        if (originalBridge === undefined) {
            delete process.env.DATA_BRIDGE_ENABLED;
        } else {
            process.env.DATA_BRIDGE_ENABLED = originalBridge;
        }
        await initializeTheiaContext();
        sinon.restore();
    });

    test('on the desktop the server is the user\'s to change', async () => {
        await initializeTheiaContext();
        assert.strictEqual(isServerUrlLocked(), false);
    });

    test('in a managed session it is not, because the environment owns it', async () => {
        // Same condition the command palette hides the picker behind: a URL and a token
        // injected by the operator. `extension.ts` reverts any write to the setting there,
        // so the login page has to state the server without offering to change it.
        process.env.DATA_BRIDGE_ENABLED = '1';
        sinon.stub(vscode.commands, 'getCommands').resolves(['dataBridge.getEnv']);
        sinon.stub(vscode.commands, 'executeCommand')
            .withArgs('dataBridge.getEnv', sinon.match.any)
            .resolves({ THEIA: 'true', ARTEMIS_URL: 'https://artemis-test2.artemis.cit.tum.de', ARTEMIS_TOKEN: 'tok-123' });
        await initializeTheiaContext();

        assert.strictEqual(isServerUrlLocked(), true);
    });
});
