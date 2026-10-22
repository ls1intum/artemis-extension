import * as vscode from 'vscode';
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as sinon from 'sinon';

import { WebviewCmd } from '@shared/messageContracts';

import type { RepositoryCloneCommandsDeps } from '@extension/controller/commands/repositoryCloneCommands';
import { RepositoryCloneCommands } from '@extension/controller/commands/repositoryCloneCommands';
import type { CommandContext } from '@extension/controller/commands/types';
import type { GitService } from '@extension/services/workspace';

suite('RepositoryCloneCommands', () => {
    let sandbox: sinon.SinonSandbox;
    let showErrorMessage: sinon.SinonStub;
    let showWarningMessage: sinon.SinonStub;
    let showInformationMessage: sinon.SinonStub;
    let showOpenDialog: sinon.SinonStub;
    let executeCommand: sinon.SinonStub;
    let openExternal: sinon.SinonStub;
    let clipboardWrite: sinon.SinonStub;
    let cloneRepositoryProgrammatic: sinon.SinonStub;
    let getTheiaEnvironment: sinon.SinonStub;
    let getWorkspaceRepositoryUrl: sinon.SinonStub;
    let normalizeRepositoryUrl: sinon.SinonStub;
    let statAsync: sinon.SinonStub;
    let configValues: Map<string, unknown>;

    function makeGitService(isAvailable: boolean): GitService {
        return { isGitAvailable: sandbox.stub().resolves(isAvailable) } as unknown as GitService;
    }

    function makeDeps(): Partial<RepositoryCloneCommandsDeps> {
        return {
            getWorkspaceRepositoryUrl,
            normalizeRepositoryUrl,
            cloneRepositoryProgrammatic,
            getTheiaEnvironment,
            statAsync: statAsync as unknown as RepositoryCloneCommandsDeps['statAsync'],
        };
    }

    function buildContext(overrides: {
        getOrCreateVcsAccessToken?: sinon.SinonStub;
        getCurrentUser?: sinon.SinonStub;
        sendMessage?: sinon.SinonStub;
        findLocalClone?: sinon.SinonStub;
    } = {}): {
        ctx: CommandContext;
        sendMessage: sinon.SinonStub;
        remember: sinon.SinonStub;
        recheckRepoStatus: sinon.SinonStub;
    } {
        const sendMessage = overrides.sendMessage ?? sandbox.stub();
        const remember = sandbox.stub().resolves();
        const recheckRepoStatus = sandbox.stub().resolves();
        const ctx = {
            artemisApi: {
                getOrCreateVcsAccessToken: overrides.getOrCreateVcsAccessToken ?? sandbox.stub().resolves('vcs-token-xyz'),
                getCurrentUser: overrides.getCurrentUser ?? sandbox.stub().resolves({ login: 'alice' }),
            },
            sendMessage,
            localClones: { remember, find: overrides.findLocalClone ?? sandbox.stub().resolves(undefined) },
            recheckRepoStatus,
        } as unknown as CommandContext;
        return { ctx, sendMessage, remember, recheckRepoStatus };
    }

    setup(() => {
        sandbox = sinon.createSandbox();
        showErrorMessage = sandbox.stub(vscode.window, 'showErrorMessage').resolves(undefined as never);
        showWarningMessage = sandbox.stub(vscode.window, 'showWarningMessage').resolves(undefined as never);
        showInformationMessage = sandbox.stub(vscode.window, 'showInformationMessage').resolves(undefined as never);
        showOpenDialog = sandbox.stub(vscode.window, 'showOpenDialog').resolves(undefined);
        executeCommand = sandbox.stub(vscode.commands, 'executeCommand').resolves(undefined as never);
        openExternal = sandbox.stub(vscode.env, 'openExternal').resolves(true as never);
        clipboardWrite = sandbox.stub().resolves(undefined);
        sandbox.replaceGetter(vscode.env, 'clipboard', () => ({
            writeText: clipboardWrite,
            readText: sandbox.stub().resolves(''),
        } as unknown as vscode.Clipboard));

        configValues = new Map<string, unknown>();
        sandbox.stub(vscode.workspace, 'getConfiguration').returns({
            get: (key: string, fallback?: unknown) => (configValues.has(key) ? configValues.get(key) : fallback),
            update: sandbox.stub().resolves(undefined),
        } as unknown as vscode.WorkspaceConfiguration);

        cloneRepositoryProgrammatic = sandbox.stub().resolves(undefined);
        getTheiaEnvironment = sandbox.stub().returns({ isTheia: false });
        getWorkspaceRepositoryUrl = sandbox.stub().resolves(undefined);
        normalizeRepositoryUrl = sandbox.stub().callsFake((u: string) => u);
        statAsync = sandbox.stub();
    });

    teardown(() => {
        sandbox.restore();
    });

    test('getHandlers returns exactly cloneRepository, copyAuthenticatedCloneUrl, openRepository, openClonedRepository', () => {
        const { ctx } = buildContext();
        const mod = new RepositoryCloneCommands(ctx, makeGitService(true), makeDeps());

        const keys = Object.keys(mod.getHandlers()).sort();

        assert.deepStrictEqual(
            keys,
            [
                WebviewCmd.CloneRepository,
                WebviewCmd.CopyAuthenticatedCloneUrl,
                WebviewCmd.OpenClonedRepository,
                WebviewCmd.OpenRepository,
            ].sort(),
        );
    });

    test('copyAuthenticatedCloneUrl builds URL with VCS token + current user login and writes it to clipboard', async () => {
        const { ctx } = buildContext({
            getOrCreateVcsAccessToken: sandbox.stub().resolves('secret-token'),
            getCurrentUser: sandbox.stub().resolves({ login: 'bob' }),
        });
        const mod = new RepositoryCloneCommands(ctx, makeGitService(true), makeDeps());

        await mod.getHandlers()[WebviewCmd.CopyAuthenticatedCloneUrl]({
            type: 'command',
            command: WebviewCmd.CopyAuthenticatedCloneUrl,
            payload: { participationId: 7, repositoryUri: 'https://artemis.example.com/git/repo.git' },
        } as never);

        sinon.assert.calledOnce(clipboardWrite);
        const written = clipboardWrite.firstCall.args[0] as string;
        assert.ok(
            written.includes('bob:secret-token@artemis.example.com'),
            `Expected clipboard URL to embed "bob:secret-token@artemis.example.com"; got: ${written}`,
        );
    });

    test('copyAuthenticatedCloneUrl surfaces an error message when getOrCreateVcsAccessToken throws', async () => {
        const { ctx } = buildContext({
            getOrCreateVcsAccessToken: sandbox.stub().rejects(new Error('API request failed: 400: Bad Request')),
        });
        const mod = new RepositoryCloneCommands(ctx, makeGitService(true), makeDeps());

        await mod.getHandlers()[WebviewCmd.CopyAuthenticatedCloneUrl]({
            type: 'command',
            command: WebviewCmd.CopyAuthenticatedCloneUrl,
            payload: { participationId: 7, repositoryUri: 'https://artemis.example.com/git/repo.git' },
        } as never);

        sinon.assert.notCalled(clipboardWrite);
        sinon.assert.calledOnceWithExactly(
            showErrorMessage,
            'Failed to obtain VCS access token: API request failed: 400: Bad Request',
        );
    });

    test('copyAuthenticatedCloneUrl keeps URL credentials out of the token error', async () => {
        const { ctx } = buildContext({
            getOrCreateVcsAccessToken: sandbox.stub().rejects(
                new Error('fetch failed for https://alice:secret-token@artemis.example.com/git/repo.git'),
            ),
        });
        const mod = new RepositoryCloneCommands(ctx, makeGitService(true), makeDeps());

        await mod.getHandlers()[WebviewCmd.CopyAuthenticatedCloneUrl]({
            type: 'command',
            command: WebviewCmd.CopyAuthenticatedCloneUrl,
            payload: { participationId: 7, repositoryUri: 'https://artemis.example.com/git/repo.git' },
        } as never);

        sinon.assert.calledOnce(showErrorMessage);
        const msg = showErrorMessage.firstCall.args[0] as string;
        assert.ok(!msg.includes('secret-token'), `Expected the token to be redacted; got: ${msg}`);
    });

    test('copyAuthenticatedCloneUrl stops with the reason when the account lookup throws', async () => {
        const { ctx } = buildContext({
            getCurrentUser: sandbox.stub().rejects(new Error('API request failed: 500')),
        });
        const mod = new RepositoryCloneCommands(ctx, makeGitService(true), makeDeps());

        await mod.getHandlers()[WebviewCmd.CopyAuthenticatedCloneUrl]({
            type: 'command',
            command: WebviewCmd.CopyAuthenticatedCloneUrl,
            payload: { participationId: 7, repositoryUri: 'https://artemis.example.com/git/repo.git' },
        } as never);

        sinon.assert.notCalled(clipboardWrite);
        sinon.assert.calledOnceWithExactly(showErrorMessage, 'Could not read your Artemis account: API request failed: 500');
    });

    test('cloneRepository does not clone with a guessed username when the account has no login', async () => {
        configValues.set('defaultClonePath', '/tmp/clones');
        configValues.set('showSetDefaultClonePathPrompt', false);
        statAsync.resolves({ isDirectory: () => true } as fs.Stats);
        const { ctx } = buildContext({ getCurrentUser: sandbox.stub().resolves({ login: '' }) });
        const mod = new RepositoryCloneCommands(ctx, makeGitService(true), makeDeps());

        await mod.getHandlers()[WebviewCmd.CloneRepository]({
            type: 'command',
            command: WebviewCmd.CloneRepository,
            payload: { participationId: 1, repositoryUri: 'https://artemis.example.com/git/repo.git', exerciseTitle: 'T' },
        } as never);

        sinon.assert.notCalled(cloneRepositoryProgrammatic);
        sinon.assert.calledOnceWithExactly(showErrorMessage, 'Could not read your Artemis account. Sign in again, then retry.');
    });

    test('cloneRepository aborts (no clone) when gitService.isGitAvailable is false', async () => {
        const { ctx } = buildContext();
        const mod = new RepositoryCloneCommands(ctx, makeGitService(false), makeDeps());

        await mod.getHandlers()[WebviewCmd.CloneRepository]({
            type: 'command',
            command: WebviewCmd.CloneRepository,
            payload: { participationId: 1, repositoryUri: 'https://x/y.git', exerciseTitle: 'T' },
        } as never);

        sinon.assert.notCalled(cloneRepositoryProgrammatic);
        sinon.assert.calledOnce(showErrorMessage);
        const msg = showErrorMessage.firstCall.args[0] as string;
        assert.ok(msg.toLowerCase().includes('git'), `Expected error to mention git; got: ${msg}`);
    });

    test('cloneRepository aborts with an error message when payload lacks participationId or repositoryUri', async () => {
        const { ctx } = buildContext();
        const mod = new RepositoryCloneCommands(ctx, makeGitService(true), makeDeps());

        await mod.getHandlers()[WebviewCmd.CloneRepository]({
            type: 'command',
            command: WebviewCmd.CloneRepository,
            payload: { participationId: 0, repositoryUri: '', exerciseTitle: 'T' },
        } as never);

        sinon.assert.notCalled(cloneRepositoryProgrammatic);
        sinon.assert.calledOnce(showErrorMessage);
    });

    test('cloneRepository remembers where it cloned and rechecks the status on success', async () => {
        // Configure a default clone path so destination resolution succeeds without modal interaction.
        configValues.set('defaultClonePath', '/tmp/clones');
        configValues.set('showSetDefaultClonePathPrompt', false);
        statAsync.resolves({ isDirectory: () => true } as fs.Stats);
        // Make the post-clone "Open Folder?" prompt resolve to 'Skip'.
        showInformationMessage.resolves('Skip' as never);

        const { ctx, remember, recheckRepoStatus } = buildContext();
        const mod = new RepositoryCloneCommands(ctx, makeGitService(true), makeDeps());

        await mod.getHandlers()[WebviewCmd.CloneRepository]({
            type: 'command',
            command: WebviewCmd.CloneRepository,
            payload: { participationId: 42, repositoryUri: 'https://artemis.example.com/git/foo.git', exerciseTitle: 'Foo' },
        } as never);

        sinon.assert.calledOnce(cloneRepositoryProgrammatic);
        sinon.assert.calledOnceWithExactly(remember, 'https://artemis.example.com/git/foo.git', path.join('/tmp/clones', 'foo'));
        sinon.assert.calledOnce(recheckRepoStatus);
        assert.ok(remember.calledBefore(recheckRepoStatus), 'the recheck must see the remembered clone');
    });

    test('cloneRepository neither remembers nor rechecks when git clone fails', async () => {
        configValues.set('defaultClonePath', '/tmp/clones');
        configValues.set('showSetDefaultClonePathPrompt', false);
        statAsync.resolves({ isDirectory: () => true } as fs.Stats);
        cloneRepositoryProgrammatic.rejects(new Error('destination path already exists'));

        const { ctx, remember, recheckRepoStatus } = buildContext();
        const mod = new RepositoryCloneCommands(ctx, makeGitService(true), makeDeps());

        await mod.getHandlers()[WebviewCmd.CloneRepository]({
            type: 'command',
            command: WebviewCmd.CloneRepository,
            payload: { participationId: 42, repositoryUri: 'https://artemis.example.com/git/foo.git', exerciseTitle: 'Foo' },
        } as never);

        sinon.assert.notCalled(remember);
        sinon.assert.notCalled(recheckRepoStatus);
        sinon.assert.calledOnce(showErrorMessage);
    });

    test('openClonedRepository opens the local clone of the given repository in the same window', async () => {
        const findLocalClone = sandbox.stub().resolves('/tmp/clones/foo');
        const { ctx } = buildContext({ findLocalClone });
        const mod = new RepositoryCloneCommands(ctx, makeGitService(true), makeDeps());

        await mod.getHandlers()[WebviewCmd.OpenClonedRepository]({
            type: 'command',
            command: WebviewCmd.OpenClonedRepository,
            payload: { repositoryUri: 'https://artemis.example.com/git/foo.git' },
        } as never);

        sinon.assert.calledOnceWithExactly(findLocalClone, 'https://artemis.example.com/git/foo.git');
        sinon.assert.calledOnce(executeCommand);
        assert.strictEqual(executeCommand.firstCall.args[0], 'vscode.openFolder');
        assert.strictEqual((executeCommand.firstCall.args[1] as vscode.Uri).fsPath, vscode.Uri.file('/tmp/clones/foo').fsPath);
        assert.deepStrictEqual(executeCommand.firstCall.args[2], { forceReuseWindow: true }, 'the clone replaces this window');
    });

    test('choosing Open Folder after a clone opens it in the same window', async () => {
        configValues.set('defaultClonePath', '/tmp/clones');
        configValues.set('showSetDefaultClonePathPrompt', false);
        statAsync.resolves({ isDirectory: () => true } as fs.Stats);
        showInformationMessage.resolves('Open Folder' as never);

        const { ctx } = buildContext();
        const mod = new RepositoryCloneCommands(ctx, makeGitService(true), makeDeps());

        await mod.getHandlers()[WebviewCmd.CloneRepository]({
            type: 'command',
            command: WebviewCmd.CloneRepository,
            payload: { participationId: 42, repositoryUri: 'https://artemis.example.com/git/foo.git', exerciseTitle: 'Foo' },
        } as never);

        await new Promise(resolve => setImmediate(resolve));

        sinon.assert.calledOnce(executeCommand);
        assert.strictEqual(executeCommand.firstCall.args[0], 'vscode.openFolder');
        assert.strictEqual((executeCommand.firstCall.args[1] as vscode.Uri).fsPath, vscode.Uri.file(path.join('/tmp/clones', 'foo')).fsPath);
        assert.deepStrictEqual(executeCommand.firstCall.args[2], { forceReuseWindow: true });
    });

    test('cloneRepository finishes the status recheck before it returns', async () => {
        configValues.set('defaultClonePath', '/tmp/clones');
        configValues.set('showSetDefaultClonePathPrompt', false);
        statAsync.resolves({ isDirectory: () => true } as fs.Stats);
        showInformationMessage.resolves('Skip' as never);
        const { ctx, recheckRepoStatus } = buildContext();
        let finishRecheck!: () => void;
        recheckRepoStatus.returns(new Promise<void>(resolve => { finishRecheck = resolve; }));
        const mod = new RepositoryCloneCommands(ctx, makeGitService(true), makeDeps());

        let returned = false;
        const handled = mod.getHandlers()[WebviewCmd.CloneRepository]({
            type: 'command',
            command: WebviewCmd.CloneRepository,
            payload: { participationId: 42, repositoryUri: 'https://artemis.example.com/git/foo.git', exerciseTitle: 'Foo' },
        } as never).then(() => { returned = true; });
        await new Promise(resolve => setImmediate(resolve));

        // The webview's sender is swapped back once the handler returns, so a later status would
        // reach whichever view is current instead of the one that cloned.
        assert.strictEqual(returned, false);
        finishRecheck();
        await handled;
        assert.strictEqual(returned, true);
    });

    test('a failing open from the clone notice is logged, not left unhandled', async () => {
        configValues.set('defaultClonePath', '/tmp/clones');
        configValues.set('showSetDefaultClonePathPrompt', false);
        statAsync.resolves({ isDirectory: () => true } as fs.Stats);
        showInformationMessage.resolves('Open Folder' as never);
        executeCommand.rejects(new Error('window refused'));
        const unhandled = sandbox.stub();
        process.on('unhandledRejection', unhandled);
        try {
            const { ctx } = buildContext();
            const mod = new RepositoryCloneCommands(ctx, makeGitService(true), makeDeps());

            await mod.getHandlers()[WebviewCmd.CloneRepository]({
                type: 'command',
                command: WebviewCmd.CloneRepository,
                payload: { participationId: 42, repositoryUri: 'https://artemis.example.com/git/foo.git', exerciseTitle: 'Foo' },
            } as never);
            await new Promise(resolve => setTimeout(resolve, 20));

            sinon.assert.calledOnce(executeCommand);
            sinon.assert.notCalled(unhandled);
        } finally {
            process.off('unhandledRejection', unhandled);
        }
    });

    test('cloneRepository returns while the "Open cloned repository?" toast is still open', async () => {
        configValues.set('defaultClonePath', '/tmp/clones');
        configValues.set('showSetDefaultClonePathPrompt', false);
        statAsync.resolves({ isDirectory: () => true } as fs.Stats);
        // A toast nobody answers: webview commands queue behind the handler, so it must not wait for it.
        showInformationMessage.returns(new Promise(() => undefined) as never);

        const { ctx } = buildContext();
        const mod = new RepositoryCloneCommands(ctx, makeGitService(true), makeDeps());

        const handled = mod.getHandlers()[WebviewCmd.CloneRepository]({
            type: 'command',
            command: WebviewCmd.CloneRepository,
            payload: { participationId: 42, repositoryUri: 'https://artemis.example.com/git/foo.git', exerciseTitle: 'Foo' },
        } as never).then(() => 'returned');
        const settled = await Promise.race([
            handled,
            new Promise(resolve => setTimeout(() => resolve('still waiting'), 200)),
        ]);

        assert.strictEqual(settled, 'returned');
    });

    test('openClonedRepository reveals the explorer when the clone is already the workspace', async () => {
        const repoPath = vscode.Uri.file('/tmp/clones/foo').fsPath;
        sandbox.stub(vscode.workspace, 'workspaceFolders').value([{ uri: vscode.Uri.file(repoPath), name: 'foo', index: 0 }]);
        const { ctx } = buildContext({ findLocalClone: sandbox.stub().resolves(repoPath) });
        const mod = new RepositoryCloneCommands(ctx, makeGitService(true), makeDeps());

        await mod.getHandlers()[WebviewCmd.OpenClonedRepository]({
            type: 'command',
            command: WebviewCmd.OpenClonedRepository,
            payload: { repositoryUri: 'https://artemis.example.com/git/foo.git' },
        } as never);

        sinon.assert.calledOnceWithExactly(executeCommand, 'workbench.view.explorer');
    });

    test('openClonedRepository warns and rechecks when the clone is gone', async () => {
        const { ctx, recheckRepoStatus } = buildContext({ findLocalClone: sandbox.stub().resolves(undefined) });
        const mod = new RepositoryCloneCommands(ctx, makeGitService(true), makeDeps());

        await mod.getHandlers()[WebviewCmd.OpenClonedRepository]({
            type: 'command',
            command: WebviewCmd.OpenClonedRepository,
            payload: { repositoryUri: 'https://artemis.example.com/git/foo.git' },
        } as never);

        sinon.assert.notCalled(executeCommand);
        sinon.assert.calledOnce(showWarningMessage);
        assert.ok((showWarningMessage.firstCall.args[0] as string).toLowerCase().includes('not found'));
        sinon.assert.calledOnce(recheckRepoStatus);
    });

    test('openRepository reveals the explorer when the workspace already matches the requested repositoryUri', async () => {
        const repoUri = 'https://artemis.example.com/git/match.git';
        getWorkspaceRepositoryUrl.resolves(repoUri);
        normalizeRepositoryUrl.callsFake((u: string) => u);
        sandbox.stub(vscode.workspace, 'workspaceFolders').value([
            { uri: vscode.Uri.file('/ws'), name: 'ws', index: 0 } as vscode.WorkspaceFolder,
        ]);

        const { ctx } = buildContext();
        const mod = new RepositoryCloneCommands(ctx, makeGitService(true), makeDeps());

        await mod.getHandlers()[WebviewCmd.OpenRepository]({
            type: 'command',
            command: WebviewCmd.OpenRepository,
            payload: { repositoryUri: repoUri },
        } as never);

        const explorerCalls = executeCommand.getCalls().filter(c => c.args[0] === 'workbench.view.explorer');
        assert.strictEqual(explorerCalls.length, 1, 'Expected one workbench.view.explorer execution');
        sinon.assert.notCalled(openExternal);
    });

    test('openRepository falls back to vscode.env.openExternal when no workspace match', async () => {
        getWorkspaceRepositoryUrl.resolves(undefined);

        const { ctx } = buildContext();
        const mod = new RepositoryCloneCommands(ctx, makeGitService(true), makeDeps());

        await mod.getHandlers()[WebviewCmd.OpenRepository]({
            type: 'command',
            command: WebviewCmd.OpenRepository,
            payload: { repositoryUri: 'https://x/y.git' },
        } as never);

        sinon.assert.calledOnce(openExternal);
    });

    test('Theia branch in _selectFolder: when running under Theia, the clone destination is workspaceFolders[0].uri.fsPath and showOpenDialog is NOT called', async () => {
        getTheiaEnvironment.returns({ isTheia: true });
        // No defaultClonePath, no prompt -> falls through to _pickFolderOrCancelClone -> _selectFolder
        configValues.set('showSetDefaultClonePathPrompt', false);
        sandbox.stub(vscode.workspace, 'workspaceFolders').value([
            { uri: vscode.Uri.file('/theia-ws'), name: 'ws', index: 0 } as vscode.WorkspaceFolder,
        ]);
        showInformationMessage.resolves('Skip' as never);

        const { ctx } = buildContext();
        const mod = new RepositoryCloneCommands(ctx, makeGitService(true), makeDeps());

        await mod.getHandlers()[WebviewCmd.CloneRepository]({
            type: 'command',
            command: WebviewCmd.CloneRepository,
            payload: { participationId: 1, repositoryUri: 'https://x/y.git', exerciseTitle: 'T' },
        } as never);

        sinon.assert.notCalled(showOpenDialog);
        sinon.assert.calledOnce(cloneRepositoryProgrammatic);
        const repoPathArg = cloneRepositoryProgrammatic.firstCall.args[1] as string;
        assert.ok(repoPathArg.startsWith('/theia-ws'), `Expected repoPath to start with /theia-ws; got: ${repoPathArg}`);
    });

    test('_resolveCloneDestination expands a leading tilde in the configured default-clone-path', async () => {
        // `~/artemis-exercises` is the example the clone modal itself suggests, so it has to work.
        configValues.set('defaultClonePath', '~/artemis-exercises');
        configValues.set('showSetDefaultClonePathPrompt', false);
        statAsync.resolves({ isDirectory: () => true } as fs.Stats);
        showInformationMessage.resolves('Skip' as never);

        const { ctx } = buildContext();
        const mod = new RepositoryCloneCommands(ctx, makeGitService(true), makeDeps());

        await mod.getHandlers()[WebviewCmd.CloneRepository]({
            type: 'command',
            command: WebviewCmd.CloneRepository,
            payload: { participationId: 7, repositoryUri: 'https://x/y.git', exerciseTitle: 'Ex' },
        } as never);

        const expandedRoot = path.join(os.homedir(), 'artemis-exercises');
        sinon.assert.calledWith(statAsync, expandedRoot);
        sinon.assert.notCalled(showOpenDialog);
        sinon.assert.calledOnce(cloneRepositoryProgrammatic);
        const repoPathArg = cloneRepositoryProgrammatic.firstCall.args[1] as string;
        assert.ok(
            repoPathArg.startsWith(expandedRoot),
            `Expected the clone to land under the expanded home path; got: ${repoPathArg}`,
        );
    });

    test('_resolveCloneDestination names the expanded path when a tilde path does not exist, and expands after trimming', async () => {
        // The warning has to name the path that was actually checked, not what was typed.
        // The padding also pins the order: expanding before trimming would leave the `~` in place.
        configValues.set('defaultClonePath', '  ~/does-not-exist  ');
        configValues.set('showSetDefaultClonePathPrompt', true);
        statAsync.rejects(new Error('ENOENT'));
        showOpenDialog.resolves(undefined);

        const { ctx } = buildContext();
        const mod = new RepositoryCloneCommands(ctx, makeGitService(true), makeDeps());

        await mod.getHandlers()[WebviewCmd.CloneRepository]({
            type: 'command',
            command: WebviewCmd.CloneRepository,
            payload: { participationId: 8, repositoryUri: 'https://x/y.git', exerciseTitle: 'Ex' },
        } as never);

        sinon.assert.calledOnce(showWarningMessage);
        const warnMsg = showWarningMessage.firstCall.args[0] as string;
        assert.ok(
            warnMsg.includes(path.join(os.homedir(), 'does-not-exist')),
            `Expected the warning to name the expanded path; got: ${warnMsg}`,
        );
        assert.ok(!warnMsg.includes('~'), `Expected no raw tilde in the warning; got: ${warnMsg}`);
    });

    test('_resolveCloneDestination warns and falls back to picker when the configured default-clone-path does not exist', async () => {
        configValues.set('defaultClonePath', '/does/not/exist');
        configValues.set('showSetDefaultClonePathPrompt', true);
        statAsync.rejects(new Error('ENOENT'));
        // The fallback picker calls showOpenDialog; we make it return undefined (user cancels) so the clone aborts cleanly.
        showOpenDialog.resolves(undefined);

        const { ctx } = buildContext();
        const mod = new RepositoryCloneCommands(ctx, makeGitService(true), makeDeps());

        await mod.getHandlers()[WebviewCmd.CloneRepository]({
            type: 'command',
            command: WebviewCmd.CloneRepository,
            payload: { participationId: 5, repositoryUri: 'https://x/y.git', exerciseTitle: 'Ex' },
        } as never);

        sinon.assert.calledOnce(showWarningMessage);
        const warnMsg = showWarningMessage.firstCall.args[0] as string;
        assert.ok(
            warnMsg.includes('/does/not/exist'),
            `Expected warning to mention the invalid path; got: ${warnMsg}`,
        );
        sinon.assert.calledOnce(showOpenDialog);
        sinon.assert.notCalled(cloneRepositoryProgrammatic);
    });

    test('_resolveCloneDestination returns undefined (and shows a Clone cancelled notice) when the user dismisses the modal', async () => {
        configValues.set('showSetDefaultClonePathPrompt', true);
        // No defaultClonePath set. Modal dismiss -> showInformationMessage returns undefined.
        showInformationMessage.resolves(undefined as never);

        const { ctx } = buildContext();
        const mod = new RepositoryCloneCommands(ctx, makeGitService(true), makeDeps());

        await mod.getHandlers()[WebviewCmd.CloneRepository]({
            type: 'command',
            command: WebviewCmd.CloneRepository,
            payload: { participationId: 5, repositoryUri: 'https://x/y.git', exerciseTitle: 'Ex' },
        } as never);

        sinon.assert.notCalled(cloneRepositoryProgrammatic);
        const cancelledNotice = showInformationMessage.getCalls().find(c => {
            const arg = c.args[0] as string;
            return typeof arg === 'string' && arg.toLowerCase().includes('clone cancelled');
        });
        assert.ok(cancelledNotice, 'Expected a "Clone cancelled" information message');
    });
});
