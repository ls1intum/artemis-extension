import * as vscode from 'vscode';
import * as assert from 'assert';
import * as sinon from 'sinon';

import { ExtensionMsg, WebviewCmd } from '@shared/messageContracts';

import { SubmissionSetupCommands } from '@extension/controller/commands/submissionSetupCommands';
import type { CommandContext } from '@extension/controller/commands/types';
import type { GitService } from '@extension/services/workspace';
import { ApiError } from '@extension/types';

const REPO_URL = 'https://artemis.example.com/git/COURSE/exercise-ge38nac.git';
const TOKEN = 'vcs-token-9f3a';

suite('SubmissionSetupCommands.renewArtemisAccess', () => {
    let sandbox: sinon.SinonSandbox;

    setup(() => {
        sandbox = sinon.createSandbox();
        sandbox.stub(vscode.workspace, 'workspaceFolders').value([
            { uri: vscode.Uri.file('/ws'), name: 'ws', index: 0 } as vscode.WorkspaceFolder,
        ]);
    });

    teardown(() => { sandbox.restore(); });

    function build(overrides: {
        resolveParticipation?: sinon.SinonStub;
        createVcsAccessToken?: sinon.SinonStub;
        getCurrentUser?: sinon.SinonStub;
        probeRemoteAccess?: sinon.SinonStub;
        setRemoteUrl?: sinon.SinonStub;
        getPushUrls?: sinon.SinonStub;
    } = {}) {
        const sendMessage = sandbox.stub();
        const resolveParticipation = overrides.resolveParticipation ?? sandbox.stub().resolves({
            participationId: 99, repositoryUri: REPO_URL, exerciseTitle: 'Sorting Algorithms',
        });
        const buildSnapshot = sandbox.stub().resolves({
            git: { state: 'ok' },
            identity: { state: 'ok', name: 'A', email: 'a@b.de' },
            repository: { state: 'ok', participationId: 99 },
            access: { state: 'ok' },
        });
        const createVcsAccessToken = overrides.createVcsAccessToken ?? sandbox.stub().resolves(TOKEN);
        const getVcsAccessToken = sandbox.stub().resolves('dead-token');
        const getOrCreateVcsAccessToken = sandbox.stub().resolves('dead-token');
        const ctx = {
            sendMessage,
            artemisApi: {
                createVcsAccessToken,
                getVcsAccessToken,
                getOrCreateVcsAccessToken,
                getCurrentUser: overrides.getCurrentUser ?? sandbox.stub().resolves({ login: 'ge38nac' }),
            },
            submissionSetup: { buildSnapshot, resolveParticipation },
        } as unknown as CommandContext;

        const git = {
            probeRemoteAccess: overrides.probeRemoteAccess ?? sandbox.stub().resolves('ok'),
            setRemoteUrl: overrides.setRemoteUrl ?? sandbox.stub().resolves(),
            getPushUrls: overrides.getPushUrls ?? sandbox.stub().resolves([]),
        } as unknown as GitService;

        const mod = new SubmissionSetupCommands(ctx, git);
        const renew = () => mod.getHandlers()[WebviewCmd.RenewArtemisAccess]({
            type: 'command', command: WebviewCmd.RenewArtemisAccess,
        } as never);

        return { renew, mod, sendMessage, git, ctx, createVcsAccessToken, getOrCreateVcsAccessToken, buildSnapshot, resolveParticipation };
    }

    /** The last result line the page was given. */
    function lastResult(sendMessage: sinon.SinonStub): { status: string; message: string } | undefined {
        const call = sendMessage.getCalls().reverse().find(c =>
            (c.args[0] as { type: string }).type === ExtensionMsg.SubmissionSetupResult);
        return call?.args[0] as { status: string; message: string } | undefined;
    }

    test('mints a fresh token with PUT, never the get-or-create that would hand back the dead one', async () => {
        const { renew, createVcsAccessToken, getOrCreateVcsAccessToken, git } = build();

        await renew();

        sinon.assert.calledOnceWithExactly(createVcsAccessToken, 99);
        sinon.assert.notCalled(getOrCreateVcsAccessToken);
        const url = (git.setRemoteUrl as unknown as sinon.SinonStub).firstCall.args[1] as string;
        assert.ok(url.includes('ge38nac'), 'the URL must authenticate as the logged-in student');
        assert.ok(url.includes(TOKEN));
        assert.ok(url.startsWith('https://'), url);
    });

    test('proves the new credential before touching git config', async () => {
        const probeRemoteAccess = sandbox.stub().resolves('ok');
        const setRemoteUrl = sandbox.stub().resolves();
        const { renew } = build({ probeRemoteAccess, setRemoteUrl });

        await renew();

        sinon.assert.callOrder(probeRemoteAccess, setRemoteUrl);
        assert.strictEqual(probeRemoteAccess.firstCall.args[1], (setRemoteUrl.firstCall.args[1] as string));
    });

    test('leaves the remote alone when the new token is refused', async () => {
        const setRemoteUrl = sandbox.stub().resolves();
        const { renew, sendMessage } = build({
            probeRemoteAccess: sandbox.stub().resolves('refused'),
            setRemoteUrl,
        });

        await renew();

        sinon.assert.notCalled(setRemoteUrl);
        assert.match(lastResult(sendMessage)!.message, /nothing was changed/);
        assert.strictEqual(lastResult(sendMessage)!.status, 'error');
    });

    test('leaves the remote alone when Artemis cannot be reached', async () => {
        const setRemoteUrl = sandbox.stub().resolves();
        const { renew, sendMessage } = build({
            probeRemoteAccess: sandbox.stub().resolves('unreachable'),
            setRemoteUrl,
        });

        await renew();

        sinon.assert.notCalled(setRemoteUrl);
        assert.match(lastResult(sendMessage)!.message, /nothing was changed/);
    });

    test('updates the push URL too when one is configured', async () => {
        const setRemoteUrl = sandbox.stub().resolves();
        const { renew } = build({ getPushUrls: sandbox.stub().resolves([REPO_URL]), setRemoteUrl });

        await renew();

        assert.deepStrictEqual(setRemoteUrl.firstCall.args[2], { alsoPush: true });
    });

    test('reports an expired session rather than a token problem on a 401', async () => {
        const { renew, sendMessage, git } = build({
            createVcsAccessToken: sandbox.stub().rejects(new ApiError('Unauthorized', 401)),
        });

        await renew();

        assert.match(lastResult(sendMessage)!.message, /session expired/i);
        sinon.assert.notCalled(git.setRemoteUrl as unknown as sinon.SinonStub);
    });

    test('refuses to build a URL that authenticates as nobody when the login is unknown', async () => {
        // The clone path falls back to the literal "user" here; a renewal that
        // did the same would replace a dead remote with an unusable one.
        const { renew, sendMessage, createVcsAccessToken } = build({
            getCurrentUser: sandbox.stub().rejects(new Error('offline')),
        });

        await renew();

        sinon.assert.notCalled(createVcsAccessToken);
        assert.match(lastResult(sendMessage)!.message, /Sign in again/);
    });

    test('says so when the folder matches no participation, instead of asking Artemis for a token anyway', async () => {
        const { renew, sendMessage, createVcsAccessToken } = build({
            resolveParticipation: sandbox.stub().resolves(undefined),
        });

        await renew();

        sinon.assert.notCalled(createVcsAccessToken);
        assert.match(lastResult(sendMessage)!.message, /which Artemis participation/);
    });

    test('redacts the token when the git write fails', async () => {
        const { renew, sendMessage } = build({
            setRemoteUrl: sandbox.stub().rejects(
                new Error(`fatal: cannot set https://ge38nac:${TOKEN}@artemis.example.com/git/x.git`),
            ),
        });

        await renew();

        const message = lastResult(sendMessage)!.message;
        assert.ok(!message.includes(TOKEN), message);
        assert.match(message, /\*\*\*/);
    });

    test('aborts the repair when the repository configuration cannot be read', async () => {
        const setRemoteUrl = sandbox.stub().resolves();
        const { renew, sendMessage } = build({
            getPushUrls: sandbox.stub().rejects(new Error('fatal: bad config line 3')),
            setRemoteUrl,
        });

        await renew();

        sinon.assert.notCalled(setRemoteUrl);
        assert.strictEqual(lastResult(sendMessage)!.status, 'error');
    });

    test('pushes a fresh snapshot after a successful renewal', async () => {
        const { renew, sendMessage, buildSnapshot } = build();

        await renew();

        sinon.assert.calledOnce(buildSnapshot);
        const info = sendMessage.getCalls().find(c =>
            (c.args[0] as { type: string }).type === ExtensionMsg.SubmissionSetupInfo);
        assert.ok(info, 'the page must be told the new state, not left showing the failure');
        assert.strictEqual(lastResult(sendMessage)!.status, 'success');
    });

    test('refreshSubmissionSetup just recomputes and posts', async () => {
        const { mod, sendMessage, buildSnapshot } = build();

        await mod.getHandlers()[WebviewCmd.RefreshSubmissionSetup]({
            type: 'command', command: WebviewCmd.RefreshSubmissionSetup,
        } as never);

        sinon.assert.calledOnce(buildSnapshot);
        assert.ok(sendMessage.getCalls().some(c =>
            (c.args[0] as { type: string }).type === ExtensionMsg.SubmissionSetupInfo));
    });
});
