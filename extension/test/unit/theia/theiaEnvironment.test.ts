/**
 * Unit tests for detectTheiaEnvironment via initializeTheiaContext.
 *
 * Focuses on the fail-loud behaviour for the EduIDE bridge: when
 * DATA_BRIDGE_ENABLED is set but the bridge cannot deliver credentials, the
 * extension must surface a clear error and fall back to the Desktop default
 * (so the diagnostic command is still reachable) instead of silently booting
 * in Desktop-Cookie mode.
 */

import * as vscode from 'vscode';
import * as assert from 'assert';
import * as sinon from 'sinon';

import { getTheiaEnvironment, initializeTheiaContext } from '@extension/theia/theiaEnvironment';

suite('detectTheiaEnvironment / initializeTheiaContext', () => {
    let sandbox: sinon.SinonSandbox;
    let originalDataBridgeEnabled: string | undefined;
    let showErrorMessageStub: sinon.SinonStub;

    setup(() => {
        sandbox = sinon.createSandbox();
        originalDataBridgeEnabled = process.env.DATA_BRIDGE_ENABLED;
        showErrorMessageStub = sandbox.stub(vscode.window, 'showErrorMessage');
    });

    teardown(() => {
        sandbox.restore();
        if (originalDataBridgeEnabled === undefined) {
            delete process.env.DATA_BRIDGE_ENABLED;
        } else {
            process.env.DATA_BRIDGE_ENABLED = originalDataBridgeEnabled;
        }
    });

    test('returns Desktop env without showing an error when DATA_BRIDGE_ENABLED is unset', async () => {
        delete process.env.DATA_BRIDGE_ENABLED;

        const env = await initializeTheiaContext();

        assert.strictEqual(env.isTheia, false);
        assert.strictEqual(env.isManagedEnvironment, false);
        assert.strictEqual(showErrorMessageStub.callCount, 0,
            'genuine Desktop boot must not surface an error');
        assert.strictEqual(getTheiaEnvironment(), env);
    });

    test('shows fail-loud error and returns Desktop fallback when bridge command is missing', async () => {
        process.env.DATA_BRIDGE_ENABLED = '1';
        sandbox.stub(vscode.commands, 'getCommands').resolves(['some.other.command']);

        const env = await initializeTheiaContext();

        assert.strictEqual(env.isTheia, false,
            'extension still loads so diagnostic command remains reachable');
        assert.strictEqual(showErrorMessageStub.callCount, 1, 'expected exactly one error message');
        const message = showErrorMessageStub.firstCall.args[0] as string;
        assert.ok(message.includes('EduIDE bridge unavailable'),
            `error must clearly identify the bridge as the cause: ${message}`);
        assert.ok(message.includes('data-bridge extension not registered'),
            `error must include the specific reason for command-missing: ${message}`);
    });

    test('shows fail-loud error when bridge times out before delivering credentials', async () => {
        process.env.DATA_BRIDGE_ENABLED = '1';
        sandbox.stub(vscode.commands, 'getCommands').resolves(['dataBridge.getEnv']);
        sandbox.stub(vscode.commands, 'executeCommand').resolves({});  // empty forever

        // Force the polling loop to exit after one iteration.
        const startTime = 1_000_000_000;
        let nowOffset = 0;
        sandbox.stub(Date, 'now').callsFake(() => startTime + nowOffset);
        sandbox.stub(global, 'setTimeout').callsFake((fn: TimerHandler) => {
            nowOffset += 11_000;
            if (typeof fn === 'function') { (fn as () => void)(); }
            return 0 as unknown as NodeJS.Timeout;
        });

        const env = await initializeTheiaContext();

        assert.strictEqual(env.isTheia, false);
        assert.strictEqual(showErrorMessageStub.callCount, 1);
        const message = showErrorMessageStub.firstCall.args[0] as string;
        assert.ok(message.includes('timed out'),
            `timeout error must mention the timeout: ${message}`);
    });

    test('returns Theia env on full bridge success', async () => {
        process.env.DATA_BRIDGE_ENABLED = '1';
        sandbox.stub(vscode.commands, 'getCommands').resolves(['dataBridge.getEnv']);
        sandbox.stub(vscode.commands, 'executeCommand').resolves({
            ARTEMIS_URL: 'https://artemis.test',
            ARTEMIS_TOKEN: 'jwt-xyz',
        });

        const env = await initializeTheiaContext();

        assert.strictEqual(env.isTheia, true);
        assert.strictEqual(env.artemisUrl, 'https://artemis.test');
        assert.strictEqual(env.artemisToken, 'jwt-xyz');
        assert.strictEqual(env.isManagedEnvironment, true);
        assert.strictEqual(showErrorMessageStub.callCount, 0);
    });
});
