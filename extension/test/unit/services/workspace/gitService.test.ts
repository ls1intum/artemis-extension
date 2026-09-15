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

suite('GitService remote probing', () => {
    let sandbox: sinon.SinonSandbox;

    setup(() => { sandbox = sinon.createSandbox(); });
    teardown(() => { sandbox.restore(); });

    /** The arguments the probe handed to git, minus the leading config flags. */
    function probeArgs(stub: sinon.SinonStub): string[] {
        return stub.firstCall.args[0] as string[];
    }

    test('asks ls-remote without --exit-code and without a ref, so an empty repository still counts as reachable', async () => {
        const service = new GitService();
        const runGit = sandbox.stub(service, 'runGit').resolves({ stdout: '', stderr: '' });

        const result = await service.probeRemoteAccess('/tmp/repo');

        assert.strictEqual(result, 'ok');
        const args = probeArgs(runGit);
        assert.ok(!args.includes('--exit-code'), 'exit code 2 for a missing ref would read as a broken remote');
        assert.ok(!args.includes('HEAD'), 'a fresh repository advertises no HEAD');
        assert.deepStrictEqual(args, ['-c', 'credential.helper=', 'ls-remote', 'origin']);
    });

    test('neutralises the prompts without discarding the inherited environment', async () => {
        const service = new GitService();
        const runGit = sandbox.stub(service, 'runGit').resolves({ stdout: '', stderr: '' });

        await service.probeRemoteAccess('/tmp/repo');

        const options = runGit.firstCall.args[1] as { env?: NodeJS.ProcessEnv; timeout?: number };
        assert.strictEqual(options.env?.GIT_TERMINAL_PROMPT, '0');
        assert.strictEqual(options.env?.GIT_ASKPASS, 'echo');
        // A probe that ran without the student's proxy or PATH would answer a
        // different question than the one `git push` asks.
        assert.ok(options.timeout && options.timeout > 0, 'an unreachable host must not hang the page');
    });

    test('probes an explicit URL when given one, which is how the push URL gets checked', async () => {
        const service = new GitService();
        const runGit = sandbox.stub(service, 'runGit').resolves({ stdout: '', stderr: '' });

        await service.probeRemoteAccess('/tmp/repo', 'https://artemis.example.com/git/x.git');

        assert.strictEqual(probeArgs(runGit).at(-1), 'https://artemis.example.com/git/x.git');
    });

    test('separates a refusal from a transport failure, because only one is worth a repair', async () => {
        const refusals = [
            "fatal: Authentication failed for 'https://artemis.example.com/git/x.git/'",
            'remote: Invalid username or token. Password authentication is not supported',
            'remote: HTTP Basic: Access denied',
            'fatal: repository not found',
            'error: The requested URL returned error: 403',
        ];
        for (const message of refusals) {
            const service = new GitService();
            sandbox.stub(service, 'runGit').rejects(new Error(message));
            assert.strictEqual(await service.probeRemoteAccess('/tmp/repo'), 'refused', message);
        }

        const transport = [
            "fatal: unable to access 'https://artemis.example.com/': Could not resolve host",
            'error: command timed out',
        ];
        for (const message of transport) {
            const service = new GitService();
            sandbox.stub(service, 'runGit').rejects(new Error(message));
            assert.strictEqual(await service.probeRemoteAccess('/tmp/repo'), 'unreachable', message);
        }
    });

    test('reads every configured push URL, so a hand-built multi-target remote is visible', async () => {
        const service = new GitService();
        sandbox.stub(service, 'runGit').resolves({ stdout: 'https://a.example/x.git\nhttps://b.example/x.git\n', stderr: '' });

        assert.deepStrictEqual(await service.getPushUrls('/tmp/repo'), [
            'https://a.example/x.git',
            'https://b.example/x.git',
        ]);
    });

    test('reports a detached HEAD as no branch rather than as the literal "HEAD"', async () => {
        const service = new GitService();
        sandbox.stub(service, 'runGit').resolves({ stdout: 'HEAD\n', stderr: '' });

        assert.strictEqual(await service.getCurrentBranch('/tmp/repo'), undefined);
    });
});

suite('GitService.setRemoteUrl', () => {
    let sandbox: sinon.SinonSandbox;

    setup(() => { sandbox = sinon.createSandbox(); });
    teardown(() => { sandbox.restore(); });

    const NEW_URL = 'https://user:token@artemis.example.com/git/x.git';

    test('writes only the fetch URL when no push URL is configured', async () => {
        const service = new GitService();
        sandbox.stub(service, 'getRemoteUrl').resolves('https://old@artemis.example.com/git/x.git');
        const runGit = sandbox.stub(service, 'runGit').resolves({ stdout: '', stderr: '' });

        await service.setRemoteUrl('/tmp/repo', NEW_URL, { alsoPush: false });

        sinon.assert.calledOnceWithExactly(runGit, ['remote', 'set-url', 'origin', NEW_URL], { cwd: '/tmp/repo' });
    });

    test('writes both URLs when a push URL exists, because a push would otherwise keep the dead token', async () => {
        const service = new GitService();
        sandbox.stub(service, 'getRemoteUrl').resolves('https://old@artemis.example.com/git/x.git');
        const runGit = sandbox.stub(service, 'runGit').resolves({ stdout: '', stderr: '' });

        await service.setRemoteUrl('/tmp/repo', NEW_URL, { alsoPush: true });

        assert.deepStrictEqual(runGit.getCalls().map(c => c.args[0]), [
            ['remote', 'set-url', 'origin', NEW_URL],
            ['remote', 'set-url', '--push', 'origin', NEW_URL],
        ]);
    });

    test('puts the fetch URL back when the push write fails, so no caller sees a half-updated remote', async () => {
        const service = new GitService();
        const previous = 'https://old@artemis.example.com/git/x.git';
        sandbox.stub(service, 'getRemoteUrl').resolves(previous);
        const runGit = sandbox.stub(service, 'runGit');
        runGit.onFirstCall().resolves({ stdout: '', stderr: '' });
        runGit.onSecondCall().rejects(new Error('fatal: could not set push url'));
        runGit.onThirdCall().resolves({ stdout: '', stderr: '' });

        await assert.rejects(() => service.setRemoteUrl('/tmp/repo', NEW_URL, { alsoPush: true }));

        assert.deepStrictEqual(runGit.thirdCall.args[0], ['remote', 'set-url', 'origin', previous]);
    });

    test('surfaces a failed rollback instead of swallowing it, and redacts the credentials in both errors', async () => {
        const service = new GitService();
        sandbox.stub(service, 'getRemoteUrl').resolves('https://old:secret@artemis.example.com/git/x.git');
        const runGit = sandbox.stub(service, 'runGit');
        runGit.onFirstCall().resolves({ stdout: '', stderr: '' });
        runGit.onSecondCall().rejects(new Error(`fatal: cannot set https://user:token@artemis.example.com/git/x.git`));
        runGit.onThirdCall().rejects(new Error('fatal: cannot restore https://old:secret@artemis.example.com/git/x.git'));

        await assert.rejects(
            () => service.setRemoteUrl('/tmp/repo', NEW_URL, { alsoPush: true }),
            (error: Error) => {
                assert.ok(error.message.includes('could not be restored'), 'the student has to be told the remote is inconsistent');
                assert.ok(!error.message.includes('token'), error.message);
                assert.ok(!error.message.includes('secret'), error.message);
                return true;
            },
        );
    });
});
