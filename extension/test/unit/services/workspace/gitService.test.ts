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

    /** The scope each call asked for: absent on the local lookup, `true` on the global one. */
    function scopes(stub: sinon.SinonStub): Array<[string, boolean | undefined]> {
        return stub.getCalls().map(c => [c.args[0] as string, c.args[2] as boolean | undefined]);
    }

    test('falls back from the local config to the global one, per field, and reports empty strings when neither has a value', async () => {
        const service = new GitService();
        // Never resolving a value forces both lookups for both fields.
        const getConfigValue = sandbox.stub(service, 'getConfigValue').resolves(undefined);

        const identity = await service.readIdentity('/tmp/repo');

        // The local call passes two arguments and lets the parameter default decide
        // the scope, so the stub sees `undefined` there rather than `false`.
        assert.deepStrictEqual(scopes(getConfigValue), [
            ['user.name', undefined],
            ['user.name', true],
            ['user.email', undefined],
            ['user.email', true],
        ]);
        assert.ok(getConfigValue.alwaysCalledWith(sinon.match.string, sinon.match({ cwd: '/tmp/repo' })));
        assert.deepStrictEqual(identity, { name: '', email: '' });
    });

    test('returns the global value when the local config has none', async () => {
        const service = new GitService();
        const getConfigValue = sandbox.stub(service, 'getConfigValue');
        getConfigValue.withArgs('user.name', sinon.match.any, true).resolves('Global Name');
        getConfigValue.withArgs('user.email', sinon.match.any, true).resolves('global@example.com');
        getConfigValue.resolves(undefined);

        const identity = await service.readIdentity('/tmp/repo');

        assert.deepStrictEqual(identity, { name: 'Global Name', email: 'global@example.com' });
    });

    test('keeps the local value and skips the global lookup for a field that has one', async () => {
        const service = new GitService();
        const getConfigValue = sandbox.stub(service, 'getConfigValue');
        getConfigValue.withArgs('user.name').resolves('Local Name');
        getConfigValue.resolves(undefined);

        const identity = await service.readIdentity('/tmp/repo');

        assert.deepStrictEqual(identity, { name: 'Local Name', email: '' });
        assert.deepStrictEqual(scopes(getConfigValue), [
            ['user.name', undefined],
            ['user.email', undefined],
            ['user.email', true],
        ]);
    });
});
