import * as assert from 'assert';
import * as sinon from 'sinon';

import { GitService } from '@extension/services/workspace/gitService';

suite('GitService.readIdentity', () => {
    let sandbox: sinon.SinonSandbox;

    setup(() => {
        sandbox = sinon.createSandbox();
    });

    teardown(() => {
        sandbox.restore();
    });

    test('falls back from the local config to the global one, per field, and reports empty strings when neither has a value', async () => {
        const service = new GitService();
        // Never resolving a value forces both lookups for both fields.
        const getConfigValue = sandbox.stub(service, 'getConfigValue').resolves(undefined);

        const identity = await service.readIdentity('/tmp/repo');

        // The local call passes two arguments and lets the parameter default decide
        // the scope, so the stub sees `undefined` there rather than `false`.
        sinon.assert.callCount(getConfigValue, 4);
        assert.deepStrictEqual(
            getConfigValue.getCalls().map(c => [c.args[0], c.args[2]]),
            [
                ['user.name', undefined],
                ['user.name', true],
                ['user.email', undefined],
                ['user.email', true],
            ],
        );
        assert.deepStrictEqual(identity, { name: '', email: '' });
    });

    test('keeps the local value and skips the global lookup for a field that has one', async () => {
        const service = new GitService();
        const getConfigValue = sandbox.stub(service, 'getConfigValue');
        getConfigValue.withArgs('user.name').resolves('Local Name');
        getConfigValue.resolves(undefined);

        const identity = await service.readIdentity('/tmp/repo');

        assert.deepStrictEqual(identity, { name: 'Local Name', email: '' });
        assert.deepStrictEqual(
            getConfigValue.getCalls().map(c => [c.args[0], c.args[2]]),
            [
                ['user.name', undefined],
                ['user.email', undefined],
                ['user.email', true],
            ],
        );
    });
});
