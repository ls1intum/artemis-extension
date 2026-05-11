/**
 * Unit tests for readEnvVarsViaDataBridge.
 *
 * Verifies the discriminated-union return contract:
 *  - DATA_BRIDGE_ENABLED unset → 'no-bridge'
 *  - DATA_BRIDGE_ENABLED=1 + command not registered → 'failure: command-missing'
 *  - DATA_BRIDGE_ENABLED=1 + command never delivers → 'failure: timeout'
 *  - DATA_BRIDGE_ENABLED=1 + command returns full record → 'success'
 *  - DATA_BRIDGE_ENABLED=1 + command returns partial record → eventually
 *    'failure: timeout' (waits for all keys)
 */

import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { readEnvVarsViaDataBridge } from '../../../src/extension/theia/dataBridgeReader';

const KEYS = ['ARTEMIS_URL', 'ARTEMIS_TOKEN'] as const;

suite('readEnvVarsViaDataBridge', () => {
    let sandbox: sinon.SinonSandbox;
    let originalDataBridgeEnabled: string | undefined;

    setup(() => {
        sandbox = sinon.createSandbox();
        originalDataBridgeEnabled = process.env.DATA_BRIDGE_ENABLED;
    });

    teardown(() => {
        sandbox.restore();
        if (originalDataBridgeEnabled === undefined) {
            delete process.env.DATA_BRIDGE_ENABLED;
        } else {
            process.env.DATA_BRIDGE_ENABLED = originalDataBridgeEnabled;
        }
    });

    test('returns no-bridge when DATA_BRIDGE_ENABLED is unset', async () => {
        delete process.env.DATA_BRIDGE_ENABLED;

        const result = await readEnvVarsViaDataBridge(KEYS);

        assert.strictEqual(result.kind, 'no-bridge');
    });

    test('returns no-bridge when DATA_BRIDGE_ENABLED is "false"', async () => {
        process.env.DATA_BRIDGE_ENABLED = 'false';

        const result = await readEnvVarsViaDataBridge(KEYS);

        assert.strictEqual(result.kind, 'no-bridge');
    });

    test('returns failure with reason=command-missing when bridge command is not registered', async () => {
        process.env.DATA_BRIDGE_ENABLED = '1';
        sandbox.stub(vscode.commands, 'getCommands').resolves(['some.other.command']);

        const result = await readEnvVarsViaDataBridge(KEYS);

        assert.strictEqual(result.kind, 'failure');
        if (result.kind === 'failure') {
            assert.strictEqual(result.reason, 'command-missing');
        }
    });

    test('returns failure with reason=timeout when bridge command never delivers values', async () => {
        process.env.DATA_BRIDGE_ENABLED = '1';
        sandbox.stub(vscode.commands, 'getCommands').resolves(['dataBridge.getEnv']);
        sandbox.stub(vscode.commands, 'executeCommand').resolves({});  // empty record forever

        // Drive timeout deterministically by stubbing Date.now to leap past the 10s deadline.
        const startTime = 1_000_000_000;
        let nowOffset = 0;
        sandbox.stub(Date, 'now').callsFake(() => startTime + nowOffset);
        // First poll attempt sees deadline = start + 10000. Bump offset past that on the
        // second call so the while-loop exits via deadline check.
        const setTimeoutStub = sandbox.stub(global, 'setTimeout').callsFake((fn: TimerHandler) => {
            nowOffset += 11_000;  // jump past deadline before the next iteration runs
            if (typeof fn === 'function') { (fn as () => void)(); }
            return 0 as unknown as NodeJS.Timeout;
        });

        const result = await readEnvVarsViaDataBridge(KEYS);

        assert.strictEqual(result.kind, 'failure');
        if (result.kind === 'failure') {
            assert.strictEqual(result.reason, 'timeout');
        }
        // Polling happened at least once
        assert.ok(setTimeoutStub.callCount >= 1);
    });

    test('returns failure with reason=invalid-response when bridge returns a string error', async () => {
        process.env.DATA_BRIDGE_ENABLED = '1';
        sandbox.stub(vscode.commands, 'getCommands').resolves(['dataBridge.getEnv']);
        sandbox.stub(vscode.commands, 'executeCommand').resolves('arktype validation error: expected string[]');

        // No setTimeout/Date stubs needed — the function should fail fast on
        // the first non-record response without polling further.
        const result = await readEnvVarsViaDataBridge(KEYS);

        assert.strictEqual(result.kind, 'failure');
        if (result.kind === 'failure') {
            assert.strictEqual(result.reason, 'invalid-response');
            assert.ok(result.details && result.details.includes('arktype'),
                `expected details to include the bridge error string, got: ${result.details}`);
        }
    });

    test('returns failure with reason=invalid-response when bridge returns an array', async () => {
        process.env.DATA_BRIDGE_ENABLED = '1';
        sandbox.stub(vscode.commands, 'getCommands').resolves(['dataBridge.getEnv']);
        sandbox.stub(vscode.commands, 'executeCommand').resolves(['unexpected'] as unknown as Record<string, string>);

        const result = await readEnvVarsViaDataBridge(KEYS);

        assert.strictEqual(result.kind, 'failure');
        if (result.kind === 'failure') {
            assert.strictEqual(result.reason, 'invalid-response');
        }
    });

    test('returns success with all requested keys when bridge delivers them', async () => {
        process.env.DATA_BRIDGE_ENABLED = '1';
        sandbox.stub(vscode.commands, 'getCommands').resolves(['dataBridge.getEnv']);
        sandbox.stub(vscode.commands, 'executeCommand').resolves({
            ARTEMIS_URL: 'https://artemis.test',
            ARTEMIS_TOKEN: 'jwt-abc',
        });

        const result = await readEnvVarsViaDataBridge(KEYS);

        assert.strictEqual(result.kind, 'success');
        if (result.kind === 'success') {
            assert.strictEqual(result.env.ARTEMIS_URL, 'https://artemis.test');
            assert.strictEqual(result.env.ARTEMIS_TOKEN, 'jwt-abc');
        }
    });
});
