/**
 * Tests for the `artemis.setDefaultClonePath` command, which the Get Started walkthrough's
 * folder step runs.
 *
 * Only the folder dialog is stubbed. The assertions read the setting back through
 * `inspect().globalValue`, so they prove the value actually landed in Global scope rather
 * than that a stub was called. Scope is worth pinning: a Workspace-scoped default would
 * silently stop applying the moment the student opens a different folder.
 *
 * The host runs against a temp user-data dir, so writing a global setting here touches
 * nothing outside the test run; teardown restores it regardless.
 */

import * as vscode from 'vscode';
import * as assert from 'assert';
import * as sinon from 'sinon';

import { VSCODE_CONFIG } from '@extension/utils';

const COMMAND_ID = 'artemis.setDefaultClonePath';

function globalClonePath(): string | undefined {
    return vscode.workspace
        .getConfiguration(VSCODE_CONFIG.ARTEMIS_SECTION)
        .inspect<string>(VSCODE_CONFIG.DEFAULT_CLONE_PATH_KEY)?.globalValue;
}

suite('artemis.setDefaultClonePath', () => {
    let sandbox: sinon.SinonSandbox;
    let originalValue: string | undefined;

    setup(async () => {
        sandbox = sinon.createSandbox();
        sandbox.stub(vscode.window, 'showInformationMessage').resolves(undefined);
        originalValue = globalClonePath();
        await vscode.workspace
            .getConfiguration(VSCODE_CONFIG.ARTEMIS_SECTION)
            .update(VSCODE_CONFIG.DEFAULT_CLONE_PATH_KEY, undefined, vscode.ConfigurationTarget.Global);
    });

    teardown(async () => {
        sandbox.restore();
        await vscode.workspace
            .getConfiguration(VSCODE_CONFIG.ARTEMIS_SECTION)
            .update(VSCODE_CONFIG.DEFAULT_CLONE_PATH_KEY, originalValue, vscode.ConfigurationTarget.Global);
    });

    test('is contributed by the extension', async () => {
        const commands = await vscode.commands.getCommands(true);
        assert.ok(commands.includes(COMMAND_ID), `${COMMAND_ID} is not registered`);
    });

    test('writes the chosen folder to the global default-clone-path setting', async () => {
        const chosen = '/tmp/artemis-exercises';
        sandbox.stub(vscode.window, 'showOpenDialog').resolves([vscode.Uri.file(chosen)]);

        await vscode.commands.executeCommand(COMMAND_ID);

        assert.strictEqual(globalClonePath(), chosen);
    });

    test('asks for a folder, never a file', async () => {
        const dialogStub = sandbox.stub(vscode.window, 'showOpenDialog').resolves(undefined);

        await vscode.commands.executeCommand(COMMAND_ID);

        const options = dialogStub.firstCall.args[0];
        assert.strictEqual(options?.canSelectFolders, true);
        assert.strictEqual(options?.canSelectFiles, false);
        assert.strictEqual(options?.canSelectMany, false);
    });

    test('writes nothing when the dialog is cancelled', async () => {
        sandbox.stub(vscode.window, 'showOpenDialog').resolves(undefined);

        await vscode.commands.executeCommand(COMMAND_ID);

        assert.strictEqual(globalClonePath(), undefined, 'a cancelled dialog must not change the setting');
    });

    test('writes nothing when the dialog resolves an empty selection', async () => {
        sandbox.stub(vscode.window, 'showOpenDialog').resolves([]);

        await vscode.commands.executeCommand(COMMAND_ID);

        assert.strictEqual(globalClonePath(), undefined, 'an empty selection must not change the setting');
    });
});
