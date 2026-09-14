import * as vscode from 'vscode';
import * as assert from 'assert';
import * as path from 'path';

import type { ArtemisApiService } from '@extension/api';
import { ConsentLevel } from '@extension/services/auth/consentService';
import { StartPageResolver } from '@extension/services/ui/startPageResolver';
import { CONFIG, resolveServerUrl, VSCODE_CONFIG } from '@extension/utils';
import manifest from '@root/package.json';

// Compiled to `out/test/unit`, so the extension root is three levels up at runtime.
const EXTENSION_ROOT = path.join(__dirname, '../../..');

// The packaging script is CommonJS and lives outside `src`, so it is loaded the way the
// packaging step loads it, built from the root rather than written as an upward relative
// literal, which the lint config forbids.
const { cleanManifest } = require(path.join(EXTENSION_ROOT, 'scripts/generate-clean-manifest.js')) as {
    cleanManifest: (manifest: unknown, profile: string) => { contributes: { commands: { command: string }[] } };
};

/**
 * The state every new student is in and no long-lived install ever returns to (#498):
 * a profile with an empty `settings.json`, nothing in `globalState`, no credential in
 * the secret store and no folder open. The test host is launched with a fresh
 * `--user-data-dir` per run (see `.vscode-test.mjs`), so this suite reads that state
 * directly rather than simulating it.
 *
 * What it cannot reach is anything behind a sign-in: cloning, submitting and a build
 * result need an account and a server, and those live in the `e2e` label.
 */
suite('A first install, with nothing configured yet (#498)', () => {
    const extensionId = `${manifest.publisher}.${manifest.name}`;

    test('the extension activates with no folder open', async () => {
        const extension = vscode.extensions.getExtension(extensionId);
        assert.ok(extension, `${extensionId} is loaded in the test host`);

        await extension.activate();

        assert.strictEqual(extension.isActive, true, 'activation completed without throwing');
        assert.strictEqual(
            vscode.workspace.workspaceFolders,
            undefined,
            'no workspace, which is what activation had to cope with',
        );
    });

    test('every command a student is offered is actually registered', async () => {
        const extension = vscode.extensions.getExtension(extensionId);
        await extension?.activate();

        // Against the desktop manifest, not the source one. The source manifest still
        // contributes the recorder commands, which only exist in the recording build;
        // packaging drops them, and this bundle is built the same way (recording=false).
        // Comparing against the raw manifest would report a command no student ever sees.
        const shipped = cleanManifest(JSON.parse(JSON.stringify(manifest)), 'desktop');
        const declared: string[] = shipped.contributes.commands.map(c => c.command);
        const registered = new Set(await vscode.commands.getCommands(true));

        assert.deepStrictEqual(
            declared.filter(command => !registered.has(command)),
            [],
            'a contributed command that is never registered fails with "command not found" when a menu entry runs it',
        );
    });

    test('every setting it contributes reads back as its declared default', () => {
        // The manifest default is what the Settings UI shows; this is what the code gets.
        // The two are separate values and only agree because VS Code is asked for the
        // right section, which is the part a typo breaks silently.
        const properties: Record<string, { default?: unknown }> = manifest.contributes.configuration.properties;

        const disagreeing = Object.entries(properties).filter(([key, schema]) => {
            const [section, ...rest] = key.split('.');
            const actual = vscode.workspace.getConfiguration(section).get(rest.join('.'));
            return JSON.stringify(actual) !== JSON.stringify(schema.default);
        });

        assert.deepStrictEqual(disagreeing.map(([key]) => key), []);
    });

    test('the server is production, because nothing has chosen one', () => {
        assert.strictEqual(resolveServerUrl(), CONFIG.ARTEMIS_SERVER_URL_DEFAULT);
        assert.strictEqual(resolveServerUrl(), 'https://artemis.tum.de');
    });

    test('recording consent is undecided, and nothing is collected while it is', () => {
        const level = vscode.workspace
            .getConfiguration(VSCODE_CONFIG.ARTEMIS_SECTION)
            .get<string>(VSCODE_CONFIG.DATA_COLLECTION_CONSENT_KEY, ConsentLevel.Pending);

        assert.strictEqual(level, ConsentLevel.Pending, 'asked once, on this run');
        assert.notStrictEqual(level, ConsentLevel.Extended, 'and recording stays off until it is answered');
    });

    test('the start page is the dashboard, without asking the server anything', async () => {
        // `startPage` defaults to `dashboard`, so the branches that fetch courses or read the
        // workspace must not be taken. An API that throws on contact proves they were not.
        const refuses = new Proxy({} as ArtemisApiService, {
            get() { throw new Error('a first run must not need the server to pick a start page'); },
        });

        const result = await new StartPageResolver(refuses).resolve();

        assert.strictEqual(result.type, 'dashboard');
    });

    test('the clone destination is still unset, so cloning has to ask', () => {
        const config = vscode.workspace.getConfiguration(VSCODE_CONFIG.ARTEMIS_SECTION);

        assert.strictEqual(config.get<string>(VSCODE_CONFIG.DEFAULT_CLONE_PATH_KEY, ''), '');
        assert.strictEqual(
            config.get<boolean>(VSCODE_CONFIG.SHOW_SET_DEFAULT_CLONE_PATH_PROMPT_KEY, true),
            true,
            'the full "set default / choose / do not ask again" prompt, not the bare folder picker',
        );
    });
});
