import * as vscode from 'vscode';
import * as assert from 'assert';
import * as sinon from 'sinon';

import { ExtensionMsg, WebviewCmd } from '@shared/messageContracts';

import type { RepositorySubmitCommandsDeps } from '@extension/controller/commands/repositorySubmitCommands';
import { RepositorySubmitCommands } from '@extension/controller/commands/repositorySubmitCommands';
import type { CommandContext } from '@extension/controller/commands/types';
import type { GitService } from '@extension/services/workspace';

interface GitServiceStubs {
    isGitAvailable: sinon.SinonStub;
    addAll: sinon.SinonStub;
    commit: sinon.SinonStub;
    pullWithRebase: sinon.SinonStub;
    push: sinon.SinonStub;
    getConfigValue: sinon.SinonStub;
    getIdentity: sinon.SinonStub;
    setGlobalIdentity: sinon.SinonStub;
}

suite('RepositorySubmitCommands', () => {
    let sandbox: sinon.SinonSandbox;
    let showErrorMessage: sinon.SinonStub;
    let showWarningMessage: sinon.SinonStub;
    let showInformationMessage: sinon.SinonStub;
    let withProgress: sinon.SinonStub;
    let checkWorkspaceFiles: sinon.SinonStub;
    let configValues: Map<string, unknown>;

    function makeGitService(overrides: Partial<GitServiceStubs> = {}): { svc: GitService; stubs: GitServiceStubs } {
        const stubs: GitServiceStubs = {
            isGitAvailable: overrides.isGitAvailable ?? sandbox.stub().resolves(true),
            addAll: overrides.addAll ?? sandbox.stub().resolves(undefined),
            commit: overrides.commit ?? sandbox.stub().resolves(undefined),
            pullWithRebase: overrides.pullWithRebase ?? sandbox.stub().resolves(undefined),
            push: overrides.push ?? sandbox.stub().resolves(undefined),
            getConfigValue: overrides.getConfigValue ?? sandbox.stub().resolves(undefined),
            getIdentity: overrides.getIdentity ?? sandbox.stub().resolves({ name: 'Alice', email: 'alice@example.com' }),
            setGlobalIdentity: overrides.setGlobalIdentity ?? sandbox.stub().resolves(undefined),
        };
        return { svc: stubs as unknown as GitService, stubs };
    }

    function makeDeps(): Partial<RepositorySubmitCommandsDeps> {
        return {
            checkWorkspaceFiles: checkWorkspaceFiles as unknown as RepositorySubmitCommandsDeps['checkWorkspaceFiles'],
        };
    }

    function buildContext(overrides: {
        sendMessage?: sinon.SinonStub;
        recheckRepoStatus?: sinon.SinonStub;
        getWebsocketService?: () => unknown;
        showGitCredentials?: sinon.SinonStub;
    } = {}): {
        ctx: CommandContext;
        sendMessage: sinon.SinonStub;
        showGitCredentials: sinon.SinonStub;
        recheckRepoStatus: sinon.SinonStub;
        fireSubmission: sinon.SinonStub;
    } {
        const sendMessage = overrides.sendMessage ?? sandbox.stub();
        const recheckRepoStatus = overrides.recheckRepoStatus ?? sandbox.stub().resolves();
        const showGitCredentials = overrides.showGitCredentials ?? sandbox.stub();
        const fireSubmission = sandbox.stub();
        const ctx = {
            actionHandler: { showGitCredentials },
            sendMessage,
            recheckRepoStatus,
            getWebsocketService: overrides.getWebsocketService,
            providerRegistry: {
                getArtemisWebviewProvider: () => ({ fireSubmission }),
            },
        } as unknown as CommandContext;
        return { ctx, sendMessage, showGitCredentials, recheckRepoStatus, fireSubmission };
    }

    setup(() => {
        sandbox = sinon.createSandbox();
        showErrorMessage = sandbox.stub(vscode.window, 'showErrorMessage').resolves(undefined as never);
        showWarningMessage = sandbox.stub(vscode.window, 'showWarningMessage').resolves(undefined as never);
        showInformationMessage = sandbox.stub(vscode.window, 'showInformationMessage').resolves(undefined as never);

        // Default workspace folder so submitExercise proceeds past the open-folder check.
        sandbox.stub(vscode.workspace, 'workspaceFolders').value([
            { uri: vscode.Uri.file('/ws'), name: 'ws', index: 0 } as vscode.WorkspaceFolder,
        ]);

        // Configuration stub for the default commit message lookup.
        configValues = new Map<string, unknown>();
        sandbox.stub(vscode.workspace, 'getConfiguration').callsFake(((_section?: string) => ({
            get: (key: string, fallback?: unknown) => (configValues.has(key) ? configValues.get(key) : fallback),
            has: sandbox.stub(),
            inspect: sandbox.stub(),
            update: sandbox.stub().resolves(undefined),
        }) as unknown as vscode.WorkspaceConfiguration));

        // withProgress runs its task immediately with a no-op progress object.
        withProgress = sandbox.stub(vscode.window, 'withProgress').callsFake(async (_opts, task) => {
            return task({ report: sandbox.stub() } as unknown as vscode.Progress<{ message?: string; increment?: number }>, {
                isCancellationRequested: false,
                onCancellationRequested: sandbox.stub(),
            } as unknown as vscode.CancellationToken);
        });

        checkWorkspaceFiles = sandbox.stub().resolves({ hasChanges: true, files: [] });
    });

    teardown(() => {
        sandbox.restore();
    });

    test('getHandlers returns exactly submitExercise, saveGitIdentity, requestGitIdentity', () => {
        const { ctx } = buildContext();
        const { svc } = makeGitService();
        const mod = new RepositorySubmitCommands(ctx, svc, makeDeps());

        const keys = Object.keys(mod.getHandlers()).sort();

        assert.deepStrictEqual(
            keys,
            [
                WebviewCmd.SubmitExercise,
                WebviewCmd.SaveGitIdentity,
                WebviewCmd.RequestGitIdentity,
            ].sort(),
        );
    });

    test('submitExercise aborts with an error message when no workspace folder is open', async () => {
        // Override the default to "no workspace folders".
        sandbox.restore();
        sandbox = sinon.createSandbox();
        showErrorMessage = sandbox.stub(vscode.window, 'showErrorMessage').resolves(undefined as never);
        showWarningMessage = sandbox.stub(vscode.window, 'showWarningMessage').resolves(undefined as never);
        showInformationMessage = sandbox.stub(vscode.window, 'showInformationMessage').resolves(undefined as never);
        sandbox.stub(vscode.workspace, 'workspaceFolders').value(undefined);
        withProgress = sandbox.stub(vscode.window, 'withProgress');
        checkWorkspaceFiles = sandbox.stub();

        const { ctx } = buildContext();
        const { svc, stubs } = makeGitService();
        const mod = new RepositorySubmitCommands(ctx, svc, makeDeps());

        await mod.getHandlers()[WebviewCmd.SubmitExercise]({
            type: 'command',
            command: WebviewCmd.SubmitExercise,
            payload: { exerciseTitle: 'Ex', commitMessage: '' },
        } as never);

        sinon.assert.calledOnceWithExactly(
            showErrorMessage,
            'Open the exercise repository in VS Code before submitting.',
        );
        sinon.assert.notCalled(withProgress);
        sinon.assert.notCalled(stubs.addAll);
    });

    test('submitExercise surfaces "No local changes detected to submit." when checkWorkspaceFiles returns hasChanges: false', async () => {
        checkWorkspaceFiles.resolves({ hasChanges: false, files: [] });

        const { ctx } = buildContext();
        const { svc, stubs } = makeGitService();
        const mod = new RepositorySubmitCommands(ctx, svc, makeDeps());

        await mod.getHandlers()[WebviewCmd.SubmitExercise]({
            type: 'command',
            command: WebviewCmd.SubmitExercise,
            payload: { exerciseTitle: 'Ex', commitMessage: '' },
        } as never);

        sinon.assert.notCalled(stubs.addAll);
        const errorCall = showErrorMessage.getCalls().find(c => (c.args[0] as string) === 'No local changes detected to submit.');
        assert.ok(errorCall, 'Expected "No local changes detected to submit." error message');
    });

    test('happy path: submitExercise calls gitService methods in order addAll -> commit -> pullWithRebase -> push and shows success', async () => {
        const { ctx, recheckRepoStatus } = buildContext();
        const { svc, stubs } = makeGitService();
        const mod = new RepositorySubmitCommands(ctx, svc, makeDeps());

        await mod.getHandlers()[WebviewCmd.SubmitExercise]({
            type: 'command',
            command: WebviewCmd.SubmitExercise,
            payload: { exerciseTitle: 'Foo', commitMessage: 'My change' },
        } as never);

        sinon.assert.callOrder(stubs.addAll, stubs.commit, stubs.pullWithRebase, stubs.push);
        sinon.assert.calledOnce(stubs.addAll);
        sinon.assert.calledOnce(stubs.commit);
        sinon.assert.calledOnce(stubs.pullWithRebase);
        sinon.assert.calledOnce(stubs.push);

        // Success information message
        const successCall = showInformationMessage.getCalls().find(c => {
            const arg = c.args[0] as string;
            return typeof arg === 'string' && arg.includes('Successfully submitted "Foo"');
        });
        assert.ok(successCall, 'Expected success information message mentioning "Foo"');

        // recheckRepoStatus invoked (fire-and-forget). The implementation uses `void ctx.recheckRepoStatus?.();`
        // so we only assert it was called, not awaited.
        sinon.assert.calledOnce(recheckRepoStatus);
    });

    test('submitExercise awaits websocket.connect when isConnected() is false; logs but does not surface user error if connect throws', async () => {
        const isConnected = sandbox.stub().returns(false);
        const connect = sandbox.stub().rejects(new Error('ws boom'));
        const wsService = { isConnected, connect };

        const { ctx } = buildContext({ getWebsocketService: () => wsService });
        const { svc } = makeGitService();
        const mod = new RepositorySubmitCommands(ctx, svc, makeDeps());

        await mod.getHandlers()[WebviewCmd.SubmitExercise]({
            type: 'command',
            command: WebviewCmd.SubmitExercise,
            payload: { exerciseTitle: 'Foo', commitMessage: '' },
        } as never);

        sinon.assert.calledOnce(isConnected);
        sinon.assert.calledOnce(connect);

        // The catch block in the outer try should NOT have shown an error message,
        // because the websocket reconnect logic runs AFTER the success notification and
        // its failure is logger.error()'d, not surfaced to the user.
        const userFacingErrorCalls = showErrorMessage.getCalls().filter(c => {
            const arg = c.args[0] as string;
            return typeof arg === 'string' && (arg.toLowerCase().includes('ws boom') || arg.toLowerCase().includes('websocket'));
        });
        assert.strictEqual(userFacingErrorCalls.length, 0, 'WebSocket connect failure must not surface a user-facing error message');
    });

    test('submitExercise shows "Merge conflict detected" when pullWithRebase throws an error containing "CONFLICT"', async () => {
        const conflictError = new Error('CONFLICT (content): Merge conflict in foo.ts');
        const { ctx } = buildContext();
        const { svc, stubs } = makeGitService({
            pullWithRebase: sandbox.stub().rejects(conflictError),
        });
        const mod = new RepositorySubmitCommands(ctx, svc, makeDeps());

        await mod.getHandlers()[WebviewCmd.SubmitExercise]({
            type: 'command',
            command: WebviewCmd.SubmitExercise,
            payload: { exerciseTitle: 'Foo', commitMessage: '' },
        } as never);

        // push must NOT run after a conflict error
        sinon.assert.notCalled(stubs.push);

        const conflictMessage = 'Merge conflict detected. Please resolve conflicts manually using git and try again.';
        const conflictCall = showErrorMessage.getCalls().find(c => (c.args[0] as string) === conflictMessage);
        assert.ok(conflictCall, 'Expected the merge conflict error message to be shown');
    });

    test('submitExercise continues to push (no error message) when pullWithRebase throws a non-conflict error', async () => {
        const networkError = new Error('fatal: unable to access remote: network down');
        const { ctx } = buildContext();
        const { svc, stubs } = makeGitService({
            pullWithRebase: sandbox.stub().rejects(networkError),
        });
        const mod = new RepositorySubmitCommands(ctx, svc, makeDeps());

        await mod.getHandlers()[WebviewCmd.SubmitExercise]({
            type: 'command',
            command: WebviewCmd.SubmitExercise,
            payload: { exerciseTitle: 'Foo', commitMessage: '' },
        } as never);

        // push MUST still run after a non-conflict pull failure
        sinon.assert.calledOnce(stubs.push);

        // No user-facing error message: the non-conflict pull failure is logged as a warning only.
        sinon.assert.notCalled(showErrorMessage);
    });

    test('submitExercise does NOT show an error message when the inner pipeline throws GIT_IDENTITY_NOT_CONFIGURED', async () => {
        // Identity not present -> ensureGitIdentityConfigured throws the sentinel
        const { ctx, showGitCredentials } = buildContext();
        const { svc } = makeGitService({
            getIdentity: sandbox.stub().resolves(undefined),
        });
        // User accepts the warning so showGitCredentials is invoked
        showWarningMessage.resolves('Configure Git Identity' as never);

        const mod = new RepositorySubmitCommands(ctx, svc, makeDeps());

        await mod.getHandlers()[WebviewCmd.SubmitExercise]({
            type: 'command',
            command: WebviewCmd.SubmitExercise,
            payload: { exerciseTitle: 'Foo', commitMessage: '' },
        } as never);

        sinon.assert.calledOnce(showGitCredentials);
        // The outer catch suppresses error messages when the inner error is the sentinel.
        sinon.assert.notCalled(showErrorMessage);
    });

    test('identity-not-configured path: when user selects "Configure Git Identity", actionHandler.showGitCredentials is invoked and the pipeline aborts', async () => {
        const { ctx, showGitCredentials } = buildContext();
        const { svc, stubs } = makeGitService({
            getIdentity: sandbox.stub().resolves(undefined),
        });
        showWarningMessage.resolves('Configure Git Identity' as never);

        const mod = new RepositorySubmitCommands(ctx, svc, makeDeps());

        await mod.getHandlers()[WebviewCmd.SubmitExercise]({
            type: 'command',
            command: WebviewCmd.SubmitExercise,
            payload: { exerciseTitle: 'Foo', commitMessage: '' },
        } as never);

        sinon.assert.calledOnce(showGitCredentials);
        // commit is called AFTER ensureGitIdentityConfigured in the production flow, so when the identity
        // check throws, commit/pull/push must not run.
        sinon.assert.notCalled(stubs.commit);
        sinon.assert.notCalled(stubs.pullWithRebase);
        sinon.assert.notCalled(stubs.push);
    });

    test('saveGitIdentity rejects empty name with a "warning" GitCredentialsResult and an error popup', async () => {
        const { ctx, sendMessage } = buildContext();
        const { svc, stubs } = makeGitService();
        const mod = new RepositorySubmitCommands(ctx, svc, makeDeps());

        await mod.getHandlers()[WebviewCmd.SaveGitIdentity]({
            type: 'command',
            command: WebviewCmd.SaveGitIdentity,
            payload: { name: '   ', email: 'alice@example.com' },
        } as never);

        sinon.assert.notCalled(stubs.setGlobalIdentity);

        const warningMessage = sendMessage.getCalls().find(c => {
            const arg = c.args[0] as { type: string; status?: string };
            return arg.type === ExtensionMsg.GitCredentialsResult && arg.status === 'warning';
        });
        assert.ok(warningMessage, 'Expected a "warning" GitCredentialsResult');

        const popup = showErrorMessage.getCalls().find(c => {
            const arg = c.args[0] as string;
            return typeof arg === 'string' && arg.toLowerCase().includes('provide a name');
        });
        assert.ok(popup, 'Expected an error popup mentioning "provide a name"');
    });

    test('saveGitIdentity rejects invalid email with a "warning" GitCredentialsResult and an error popup', async () => {
        const { ctx, sendMessage } = buildContext();
        const { svc, stubs } = makeGitService();
        const mod = new RepositorySubmitCommands(ctx, svc, makeDeps());

        await mod.getHandlers()[WebviewCmd.SaveGitIdentity]({
            type: 'command',
            command: WebviewCmd.SaveGitIdentity,
            payload: { name: 'Alice', email: 'not-an-email' },
        } as never);

        sinon.assert.notCalled(stubs.setGlobalIdentity);

        const warningMessage = sendMessage.getCalls().find(c => {
            const arg = c.args[0] as { type: string; status?: string };
            return arg.type === ExtensionMsg.GitCredentialsResult && arg.status === 'warning';
        });
        assert.ok(warningMessage, 'Expected a "warning" GitCredentialsResult for invalid email');

        const popup = showErrorMessage.getCalls().find(c => {
            const arg = c.args[0] as string;
            return typeof arg === 'string' && arg.toLowerCase().includes('valid email');
        });
        assert.ok(popup, 'Expected an error popup mentioning a valid email');
    });

    test('saveGitIdentity calls gitService.setGlobalIdentity, sends a success result, and shows an information popup', async () => {
        const { ctx, sendMessage } = buildContext();
        const { svc, stubs } = makeGitService();
        const mod = new RepositorySubmitCommands(ctx, svc, makeDeps());

        await mod.getHandlers()[WebviewCmd.SaveGitIdentity]({
            type: 'command',
            command: WebviewCmd.SaveGitIdentity,
            payload: { name: 'Alice', email: 'alice@example.com' },
        } as never);

        sinon.assert.calledOnceWithExactly(stubs.setGlobalIdentity, { name: 'Alice', email: 'alice@example.com' });

        const successMessage = sendMessage.getCalls().find(c => {
            const arg = c.args[0] as { type: string; status?: string };
            return arg.type === ExtensionMsg.GitCredentialsResult && arg.status === 'success';
        });
        assert.ok(successMessage, 'Expected a "success" GitCredentialsResult');

        sinon.assert.calledOnce(showInformationMessage);
    });

    test('requestGitIdentity reads local config first then global; sends GitIdentityInfo with empty-string fallbacks when neither has a value', async () => {
        const { ctx, sendMessage } = buildContext();
        // Always return undefined so we exercise both local AND global lookups
        const getConfigValue = sandbox.stub().resolves(undefined);
        const { svc } = makeGitService({ getConfigValue });
        const mod = new RepositorySubmitCommands(ctx, svc, makeDeps());

        await mod.getHandlers()[WebviewCmd.RequestGitIdentity]({
            type: 'command',
            command: WebviewCmd.RequestGitIdentity,
            payload: {},
        } as never);

        // For each of user.name and user.email: local (globalScope=false) is tried first,
        // then global (globalScope=true) when local is empty. So 4 calls total, in this order:
        //   (user.name, _, false), (user.name, _, true), (user.email, _, false), (user.email, _, true)
        sinon.assert.callCount(getConfigValue, 4);
        assert.strictEqual(getConfigValue.getCall(0).args[0], 'user.name');
        assert.strictEqual(getConfigValue.getCall(0).args[2], false);
        assert.strictEqual(getConfigValue.getCall(1).args[0], 'user.name');
        assert.strictEqual(getConfigValue.getCall(1).args[2], true);
        assert.strictEqual(getConfigValue.getCall(2).args[0], 'user.email');
        assert.strictEqual(getConfigValue.getCall(2).args[2], false);
        assert.strictEqual(getConfigValue.getCall(3).args[0], 'user.email');
        assert.strictEqual(getConfigValue.getCall(3).args[2], true);

        const identityInfo = sendMessage.getCalls().find(c => (c.args[0] as { type: string }).type === ExtensionMsg.GitIdentityInfo);
        assert.ok(identityInfo, 'Expected a GitIdentityInfo message');
        assert.deepStrictEqual(identityInfo.args[0], {
            type: ExtensionMsg.GitIdentityInfo,
            name: '',
            email: '',
        });
    });

    test('happy path emits started then succeeded (exactly one terminal)', async () => {
        const { ctx, fireSubmission } = buildContext();
        const { svc } = makeGitService();
        const mod = new RepositorySubmitCommands(ctx, svc, makeDeps());

        await mod.getHandlers()[WebviewCmd.SubmitExercise]({
            type: 'command', command: WebviewCmd.SubmitExercise,
            payload: { participationId: 42, exerciseTitle: 'Foo', commitMessage: 'My change' },
        } as never);

        assert.strictEqual(fireSubmission.callCount, 2);
        assert.deepStrictEqual(fireSubmission.getCall(0).args[0].status, 'started');
        assert.deepStrictEqual(fireSubmission.getCall(0).args[0].participationId, 42);
        assert.deepStrictEqual(fireSubmission.getCall(1).args[0].status, 'succeeded');
        assert.deepStrictEqual(fireSubmission.getCall(1).args[0].participationId, 42);
        // commitMessage is the field that distinguishes the lifecycle states (raw on started,
        // resolved on succeeded); here both carry the provided text verbatim.
        assert.strictEqual(fireSubmission.getCall(0).args[0].commitMessage, 'My change');
        assert.strictEqual(fireSubmission.getCall(1).args[0].commitMessage, 'My change');
    });

    test('blank commitMessage: started carries undefined, succeeded carries the configured default', async () => {
        const { ctx, fireSubmission } = buildContext();
        const { svc } = makeGitService();
        const mod = new RepositorySubmitCommands(ctx, svc, makeDeps());

        await mod.getHandlers()[WebviewCmd.SubmitExercise]({
            type: 'command', command: WebviewCmd.SubmitExercise,
            payload: { participationId: 42, exerciseTitle: 'Foo', commitMessage: '' },
        } as never);

        assert.strictEqual(fireSubmission.callCount, 2);
        // Raw (started) text is blank -> undefined; resolved (succeeded) falls back to the configured default.
        // This is the only case where the raw and resolved values diverge.
        assert.strictEqual(fireSubmission.getCall(0).args[0].commitMessage, undefined);
        assert.strictEqual(fireSubmission.getCall(1).args[0].commitMessage, 'Solution submission via Iris extension');
    });

    test('recorded commitMessage is capped to 512 chars without truncating the real git commit', async () => {
        const longMessage = 'a'.repeat(1000);
        const { ctx, fireSubmission } = buildContext();
        const { svc, stubs } = makeGitService();
        const mod = new RepositorySubmitCommands(ctx, svc, makeDeps());

        await mod.getHandlers()[WebviewCmd.SubmitExercise]({
            type: 'command', command: WebviewCmd.SubmitExercise,
            payload: { participationId: 42, exerciseTitle: 'Foo', commitMessage: longMessage },
        } as never);

        // The actual git commit must receive the FULL message — the cap is recording-only.
        sinon.assert.calledOnceWithExactly(stubs.commit, longMessage, { cwd: '/ws' });

        // Both recorded events carry the capped (512-char) copy.
        assert.strictEqual(fireSubmission.getCall(0).args[0].commitMessage.length, 512);
        assert.strictEqual(fireSubmission.getCall(1).args[0].commitMessage.length, 512);
        assert.strictEqual(fireSubmission.getCall(0).args[0].commitMessage, longMessage.slice(0, 512));
    });

    test('no-changes emits started then failed with reason no-changes', async () => {
        checkWorkspaceFiles.resolves({ hasChanges: false, files: [] });
        const { ctx, fireSubmission } = buildContext();
        const { svc } = makeGitService();
        const mod = new RepositorySubmitCommands(ctx, svc, makeDeps());

        await mod.getHandlers()[WebviewCmd.SubmitExercise]({
            type: 'command', command: WebviewCmd.SubmitExercise,
            payload: { participationId: 42, exerciseTitle: 'Ex', commitMessage: '' },
        } as never);

        assert.strictEqual(fireSubmission.callCount, 2);
        assert.strictEqual(fireSubmission.getCall(0).args[0].status, 'started');
        assert.strictEqual(fireSubmission.getCall(1).args[0].status, 'failed');
        assert.strictEqual(fireSubmission.getCall(1).args[0].failureReason, 'no-changes');
    });

    test('merge-conflict emits failed with reason merge-conflict', async () => {
        const { ctx, fireSubmission } = buildContext();
        const { svc } = makeGitService({ pullWithRebase: sandbox.stub().rejects(new Error('CONFLICT (content): Merge conflict in foo.ts')) });
        const mod = new RepositorySubmitCommands(ctx, svc, makeDeps());

        await mod.getHandlers()[WebviewCmd.SubmitExercise]({
            type: 'command', command: WebviewCmd.SubmitExercise,
            payload: { participationId: 42, exerciseTitle: 'Foo', commitMessage: '' },
        } as never);

        assert.strictEqual(fireSubmission.callCount, 2);
        assert.strictEqual(fireSubmission.getCall(0).args[0].status, 'started');
        assert.strictEqual(fireSubmission.getCall(1).args[0].status, 'failed');
        assert.strictEqual(fireSubmission.getCall(1).args[0].failureReason, 'merge-conflict');
    });

    test('push failure emits failed with reason push-failed', async () => {
        const { ctx, fireSubmission } = buildContext();
        const { svc } = makeGitService({ push: sandbox.stub().rejects(new Error('fatal: push rejected')) });
        const mod = new RepositorySubmitCommands(ctx, svc, makeDeps());

        await mod.getHandlers()[WebviewCmd.SubmitExercise]({
            type: 'command', command: WebviewCmd.SubmitExercise,
            payload: { participationId: 42, exerciseTitle: 'Foo', commitMessage: '' },
        } as never);

        assert.strictEqual(fireSubmission.callCount, 2);
        assert.strictEqual(fireSubmission.getCall(0).args[0].status, 'started');
        assert.strictEqual(fireSubmission.getCall(1).args[0].status, 'failed');
        assert.strictEqual(fireSubmission.getCall(1).args[0].failureReason, 'push-failed');
    });

    test('git-identity-not-configured emits failed with reason git-identity-missing', async () => {
        const { ctx, fireSubmission } = buildContext();
        const { svc } = makeGitService({ getIdentity: sandbox.stub().resolves(undefined) });
        showWarningMessage.resolves('Configure Git Identity' as never);
        const mod = new RepositorySubmitCommands(ctx, svc, makeDeps());

        await mod.getHandlers()[WebviewCmd.SubmitExercise]({
            type: 'command', command: WebviewCmd.SubmitExercise,
            payload: { participationId: 42, exerciseTitle: 'Foo', commitMessage: '' },
        } as never);

        assert.strictEqual(fireSubmission.callCount, 2);
        assert.strictEqual(fireSubmission.getCall(0).args[0].status, 'started');
        assert.strictEqual(fireSubmission.getCall(1).args[0].status, 'failed');
        assert.strictEqual(fireSubmission.getCall(1).args[0].failureReason, 'git-identity-missing');
    });

    test('no-workspace emits started then failed with reason no-workspace', async () => {
        // The default setup stubs workspaceFolders to a present folder, so override it to undefined
        // for this test. Mirror the existing "no workspace folder" abort test's sandbox-reset approach.
        sandbox.restore();
        sandbox = sinon.createSandbox();
        showErrorMessage = sandbox.stub(vscode.window, 'showErrorMessage').resolves(undefined as never);
        showWarningMessage = sandbox.stub(vscode.window, 'showWarningMessage').resolves(undefined as never);
        showInformationMessage = sandbox.stub(vscode.window, 'showInformationMessage').resolves(undefined as never);
        sandbox.stub(vscode.workspace, 'workspaceFolders').value(undefined);
        withProgress = sandbox.stub(vscode.window, 'withProgress');
        checkWorkspaceFiles = sandbox.stub();

        // buildContext() is called AFTER the fresh sandbox is set up so its fireSubmission stub
        // belongs to the active sandbox and is the one the handler actually calls.
        const { ctx, fireSubmission } = buildContext();
        const { svc } = makeGitService();
        const mod = new RepositorySubmitCommands(ctx, svc, makeDeps());

        await mod.getHandlers()[WebviewCmd.SubmitExercise]({
            type: 'command', command: WebviewCmd.SubmitExercise,
            payload: { participationId: 42, exerciseTitle: 'Ex', commitMessage: '' },
        } as never);

        assert.strictEqual(fireSubmission.callCount, 2);
        assert.strictEqual(fireSubmission.getCall(0).args[0].status, 'started');
        assert.strictEqual(fireSubmission.getCall(1).args[0].status, 'failed');
        assert.strictEqual(fireSubmission.getCall(1).args[0].failureReason, 'no-workspace');
    });

    test('generic failure emits failed with reason other', async () => {
        // Default setup (workspace present, hasChanges true). An early git step throws a generic
        // error (non-conflict, non-sentinel) so the catch falls through to the default 'other'.
        const { ctx, fireSubmission } = buildContext();
        const { svc } = makeGitService({ addAll: sandbox.stub().rejects(new Error('disk full')) });
        const mod = new RepositorySubmitCommands(ctx, svc, makeDeps());

        await mod.getHandlers()[WebviewCmd.SubmitExercise]({
            type: 'command', command: WebviewCmd.SubmitExercise,
            payload: { participationId: 42, exerciseTitle: 'Foo', commitMessage: 'x' },
        } as never);

        assert.strictEqual(fireSubmission.callCount, 2);
        assert.strictEqual(fireSubmission.getCall(0).args[0].status, 'started');
        assert.strictEqual(fireSubmission.getCall(1).args[0].status, 'failed');
        assert.strictEqual(fireSubmission.getCall(1).args[0].failureReason, 'other');
    });

    test('emits nothing when the payload has no participationId', async () => {
        const { ctx, fireSubmission } = buildContext();
        const { svc } = makeGitService();
        const mod = new RepositorySubmitCommands(ctx, svc, makeDeps());

        await mod.getHandlers()[WebviewCmd.SubmitExercise]({
            type: 'command', command: WebviewCmd.SubmitExercise,
            payload: { exerciseTitle: 'Foo', commitMessage: 'x' },
        } as never);

        assert.strictEqual(fireSubmission.callCount, 0);
    });
});
