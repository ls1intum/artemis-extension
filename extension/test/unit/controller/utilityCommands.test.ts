import * as vscode from 'vscode';
import * as assert from 'assert';
import * as sinon from 'sinon';

import { WebviewCmd } from '@shared/messageContracts';

import type { CommandContext } from '@extension/controller/commands/types';
import { UtilityCommandModule } from '@extension/controller/commands/utilityCommands';
import { initializeTheiaContext } from '@extension/theia/theiaEnvironment';

suite('UtilityCommandModule.handleOpenWebsite', () => {
    let sandbox: sinon.SinonSandbox;
    let openExternal: sinon.SinonStub;
    let configValues: Map<string, unknown>;
    let originalBridge: string | undefined;

    function dispatchOpenWebsite(path: string): Promise<void> {
        const mod = new UtilityCommandModule({} as CommandContext);
        return mod.getHandlers()[WebviewCmd.OpenWebsite]({
            type: 'command',
            command: WebviewCmd.OpenWebsite,
            payload: { path },
        } as never);
    }

    setup(() => {
        sandbox = sinon.createSandbox();
        originalBridge = process.env.DATA_BRIDGE_ENABLED;
        openExternal = sandbox.stub(vscode.env, 'openExternal').resolves(true as never);

        configValues = new Map<string, unknown>();
        sandbox.stub(vscode.workspace, 'getConfiguration').returns({
            get: (key: string, fallback?: unknown) => (configValues.has(key) ? configValues.get(key) : fallback),
            update: sandbox.stub().resolves(undefined),
        } as unknown as vscode.WorkspaceConfiguration);
    });

    teardown(async () => {
        // Reset the Theia singleton to the Desktop default so managed-env state
        // set in a test cannot leak into other suites.
        if (originalBridge === undefined) {
            delete process.env.DATA_BRIDGE_ENABLED;
        } else {
            process.env.DATA_BRIDGE_ENABLED = originalBridge;
        }
        await initializeTheiaContext();
        sandbox.restore();
    });

    test('opens the Theia/EduIDE server URL (data-bridge ARTEMIS_URL), not the VS Code config default', async () => {
        const theiaUrl = 'https://artemis-test2.artemis.cit.tum.de';
        process.env.DATA_BRIDGE_ENABLED = '1';
        sandbox.stub(vscode.commands, 'getCommands').resolves(['dataBridge.getEnv']);
        sandbox.stub(vscode.commands, 'executeCommand')
            .withArgs('dataBridge.getEnv', sinon.match.any)
            .resolves({ THEIA: 'true', ARTEMIS_URL: theiaUrl, ARTEMIS_TOKEN: 'tok-123' });
        await initializeTheiaContext();

        await dispatchOpenWebsite('/courses/1/exercises/2');

        sinon.assert.calledOnce(openExternal);
        const opened = (openExternal.firstCall.args[0] as vscode.Uri).toString(true);
        assert.strictEqual(opened, `${theiaUrl}/courses/1/exercises/2`);
    });

    test('falls back to the configured server URL on Desktop (no data-bridge)', async () => {
        delete process.env.DATA_BRIDGE_ENABLED;
        await initializeTheiaContext();
        configValues.set('serverUrl', 'https://artemis.example.com');

        await dispatchOpenWebsite('/courses/3/exercises/4');

        sinon.assert.calledOnce(openExternal);
        const opened = (openExternal.firstCall.args[0] as vscode.Uri).toString(true);
        assert.strictEqual(opened, 'https://artemis.example.com/courses/3/exercises/4');
    });
});
