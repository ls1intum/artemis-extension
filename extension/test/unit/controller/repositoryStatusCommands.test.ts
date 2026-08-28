import * as vscode from 'vscode';
import * as assert from 'assert';
import * as sinon from 'sinon';

import { ExtensionMsg, WebviewCmd } from '@shared/messageContracts';

import { AppStateManager } from '@extension/controller/appStateManager';
import type { RepositoryStatusCommandsDeps } from '@extension/controller/commands/repositoryStatusCommands';
import { RepositoryStatusCommands } from '@extension/controller/commands/repositoryStatusCommands';
import type { CommandContext } from '@extension/controller/commands/types';
import type { ExerciseDetailsResponse } from '@extension/types';

type SaveListener = (document: vscode.TextDocument) => void;
type CreateDeleteListener = (event: vscode.FileCreateEvent | vscode.FileDeleteEvent) => void;
type RenameListener = (event: vscode.FileRenameEvent) => void;
type ChangeListener = (event: vscode.TextDocumentChangeEvent) => void;

interface ListenerHolder {
    save?: SaveListener;
    create?: CreateDeleteListener;
    delete?: CreateDeleteListener;
    rename?: RenameListener;
    change?: ChangeListener;
    disposables: sinon.SinonStub[];
}

suite('RepositoryStatusCommands', () => {
    let sandbox: sinon.SinonSandbox;
    let showErrorMessage: sinon.SinonStub;
    let getWorkspaceStatus: sinon.SinonStub;
    let listeners: ListenerHolder;
    let configValues: Map<string, unknown>;
    let textDocuments: vscode.TextDocument[];

    function makeDeps(): Partial<RepositoryStatusCommandsDeps> {
        return {
            getWorkspaceStatus: getWorkspaceStatus as unknown as RepositoryStatusCommandsDeps['getWorkspaceStatus'],
        };
    }

    function buildContext(overrides: {
        sendMessage?: sinon.SinonStub;
        currentExerciseData?: unknown;
    } = {}): { ctx: CommandContext; sendMessage: sinon.SinonStub; appStateManager: AppStateManager } {
        const sendMessage = overrides.sendMessage ?? sandbox.stub();
        // A real arbitrator rather than a pair of stubs: every conclusion this module draws is gated
        // on it, so stubbing it to always accept would test a module that cannot be superseded.
        const appStateManager = new AppStateManager();
        if (overrides.currentExerciseData) {
            appStateManager.showCourseDetail({ course: { id: 1, title: 'Course' } });
            appStateManager.showExerciseDetail(overrides.currentExerciseData as ExerciseDetailsResponse);
        }
        const ctx = { appStateManager, sendMessage } as unknown as CommandContext;
        return { ctx, sendMessage, appStateManager };
    }

    function stubWorkspaceListeners(): ListenerHolder {
        const holder: ListenerHolder = { disposables: [] };
        const makeDisposable = (): vscode.Disposable => {
            const dispose = sandbox.stub();
            holder.disposables.push(dispose);
            return { dispose } as unknown as vscode.Disposable;
        };
        sandbox.stub(vscode.workspace, 'onDidSaveTextDocument').callsFake(((l: SaveListener) => {
            holder.save = l;
            return makeDisposable();
        }) as never);
        sandbox.stub(vscode.workspace, 'onDidCreateFiles').callsFake(((l: CreateDeleteListener) => {
            holder.create = l;
            return makeDisposable();
        }) as never);
        sandbox.stub(vscode.workspace, 'onDidDeleteFiles').callsFake(((l: CreateDeleteListener) => {
            holder.delete = l;
            return makeDisposable();
        }) as never);
        sandbox.stub(vscode.workspace, 'onDidRenameFiles').callsFake(((l: RenameListener) => {
            holder.rename = l;
            return makeDisposable();
        }) as never);
        sandbox.stub(vscode.workspace, 'onDidChangeTextDocument').callsFake(((l: ChangeListener) => {
            holder.change = l;
            return makeDisposable();
        }) as never);
        return holder;
    }

    setup(() => {
        sandbox = sinon.createSandbox();
        showErrorMessage = sandbox.stub(vscode.window, 'showErrorMessage').resolves(undefined as never);

        sandbox.stub(vscode.workspace, 'workspaceFolders').value([
            { uri: vscode.Uri.file('/ws'), name: 'ws', index: 0 } as vscode.WorkspaceFolder,
        ]);

        configValues = new Map<string, unknown>();
        configValues.set('showUnsavedChangesWarning', true);
        configValues.set('autoSave', 'off');
        sandbox.stub(vscode.workspace, 'getConfiguration').callsFake(((_section?: string) => ({
            get: (key: string, fallback?: unknown) => (configValues.has(key) ? configValues.get(key) : fallback),
            has: sandbox.stub(),
            inspect: sandbox.stub(),
            update: sandbox.stub().resolves(undefined),
        })) as unknown as typeof vscode.workspace.getConfiguration);

        textDocuments = [];
        sandbox.stub(vscode.workspace, 'textDocuments').get(() => textDocuments);

        getWorkspaceStatus = sandbox.stub();
        listeners = stubWorkspaceListeners();
    });

    teardown(() => {
        sandbox.restore();
    });

    test('getHandlers returns exactly checkRepositoryStatus', () => {
        const { ctx } = buildContext();
        const mod = new RepositoryStatusCommands(ctx, makeDeps());

        const keys = Object.keys(mod.getHandlers());

        assert.deepStrictEqual(keys, [WebviewCmd.CheckRepositoryStatus]);
    });

    test('setRepositoryContext stores context and debounced save listener triggers getWorkspaceStatus after 500ms', async () => {
        const clock = sandbox.useFakeTimers();
        getWorkspaceStatus.resolves({ isConnected: true, hasChanges: false, isPracticeRepo: false });

        const { ctx } = buildContext();
        const mod = new RepositoryStatusCommands(ctx, makeDeps());

        mod.setRepositoryContext('https://artemis.example.com/git/repo.git', 42);
        assert.ok(listeners.save, 'save listener should be registered');

        listeners.save({ uri: vscode.Uri.file('/ws/Main.java') } as vscode.TextDocument);

        await clock.tickAsync(499);
        sinon.assert.notCalled(getWorkspaceStatus);

        await clock.tickAsync(1);
        sinon.assert.called(getWorkspaceStatus);
        assert.strictEqual(getWorkspaceStatus.firstCall.args[0], 'https://artemis.example.com/git/repo.git');
    });

    test('outside-workspace save: debounce is NOT scheduled when saved doc is outside currentWorkspacePath', async () => {
        const clock = sandbox.useFakeTimers();
        getWorkspaceStatus.resolves({ isConnected: false, hasChanges: false, isPracticeRepo: false });

        const { ctx } = buildContext();
        const mod = new RepositoryStatusCommands(ctx, makeDeps());
        mod.setRepositoryContext('https://x/y.git', 7);

        // Saved doc lives outside the workspace -> path.relative -> '..'
        listeners.save?.({ uri: vscode.Uri.file('/some/other/place/Foo.java') } as vscode.TextDocument);

        await clock.tickAsync(1000);

        sinon.assert.notCalled(getWorkspaceStatus);
    });

    test('clearRepositoryContext: subsequent saves do not trigger status checks', async () => {
        const clock = sandbox.useFakeTimers();
        getWorkspaceStatus.resolves({ isConnected: true, hasChanges: false, isPracticeRepo: false });

        const { ctx } = buildContext();
        const mod = new RepositoryStatusCommands(ctx, makeDeps());

        mod.setRepositoryContext('https://x/y.git', 1);
        mod.clearRepositoryContext();

        listeners.save?.({ uri: vscode.Uri.file('/ws/A.java') } as vscode.TextDocument);

        await clock.tickAsync(1000);

        sinon.assert.notCalled(getWorkspaceStatus);
    });

    test('dispose: registered disposables are disposed and pending debounce timers do not fire', async () => {
        const clock = sandbox.useFakeTimers();
        getWorkspaceStatus.resolves({ isConnected: true, hasChanges: false, isPracticeRepo: false });

        const { ctx } = buildContext();
        const mod = new RepositoryStatusCommands(ctx, makeDeps());

        assert.strictEqual(listeners.disposables.length, 5);

        mod.setRepositoryContext('https://x/y.git', 1);
        // Schedule a debounced check
        listeners.save?.({ uri: vscode.Uri.file('/ws/A.java') } as vscode.TextDocument);

        mod.dispose();

        for (const d of listeners.disposables) {
            sinon.assert.calledOnce(d);
        }

        await clock.tickAsync(1000);
        sinon.assert.notCalled(getWorkspaceStatus);
    });

    test('checkRepositoryStatus sends UpdateRepoStatus { isConnected:false,... } when no URI matches', async () => {
        getWorkspaceStatus.resolves({ isConnected: false, hasChanges: false, isPracticeRepo: false });

        const exerciseData = {
            exercise: {
                id: 11,
                studentParticipations: [
                    { repositoryUri: 'https://a/repo1.git' },
                    { repositoryUri: 'https://b/repo2.git' },
                ],
            },
        };
        const { ctx, sendMessage } = buildContext({ currentExerciseData: exerciseData });
        const mod = new RepositoryStatusCommands(ctx, makeDeps());

        await mod.getHandlers()[WebviewCmd.CheckRepositoryStatus]({
            type: 'command', command: WebviewCmd.CheckRepositoryStatus,
        } as never);

        sinon.assert.callCount(getWorkspaceStatus, 2);
        const updateCalls = sendMessage.getCalls().filter(c => (c.args[0] as { type: string }).type === ExtensionMsg.UpdateRepoStatus);
        assert.strictEqual(updateCalls.length, 1);
        assert.deepStrictEqual(updateCalls[0].args[0], {
            type: ExtensionMsg.UpdateRepoStatus,
            isConnected: false,
            hasChanges: false,
            isPracticeRepo: false,
        });
    });

    test('checkRepositoryStatus sends UpdateRepoStatus { isConnected:true,... } when a URI matches', async () => {
        getWorkspaceStatus
            .onFirstCall().resolves({ isConnected: false, hasChanges: false, isPracticeRepo: false })
            .onSecondCall().resolves({ isConnected: true, hasChanges: true, isPracticeRepo: false });

        const exerciseData = {
            exercise: {
                id: 12,
                studentParticipations: [
                    { repositoryUri: 'https://a/repo1.git' },
                    { repositoryUri: 'https://b/repo2.git' },
                ],
            },
        };
        const { ctx, sendMessage } = buildContext({ currentExerciseData: exerciseData });
        const mod = new RepositoryStatusCommands(ctx, makeDeps());

        await mod.getHandlers()[WebviewCmd.CheckRepositoryStatus]({
            type: 'command', command: WebviewCmd.CheckRepositoryStatus,
        } as never);

        const updateCalls = sendMessage.getCalls().filter(c => (c.args[0] as { type: string }).type === ExtensionMsg.UpdateRepoStatus);
        assert.strictEqual(updateCalls.length, 1);
        assert.deepStrictEqual(updateCalls[0].args[0], {
            type: ExtensionMsg.UpdateRepoStatus,
            isConnected: true,
            hasChanges: true,
            isPracticeRepo: false,
        });
        sinon.assert.notCalled(showErrorMessage);
    });

    test('says nothing about an exercise the student has already left', async () => {
        // UpdateRepoStatus carries no exercise id, so a probe that outlived its exercise would
        // rewrite the repository state of whichever one is on screen now.
        getWorkspaceStatus.resolves({ isConnected: true, hasChanges: true, isPracticeRepo: true });

        const { ctx, sendMessage } = buildContext({ currentExerciseData: { exercise: { id: 12 } } });
        const mod = new RepositoryStatusCommands(ctx, makeDeps());
        mod.setRepositoryContext('https://artemis.example.com/git/other.git', 99);

        await mod.recheckCurrentRepoStatus();

        const updateCalls = sendMessage.getCalls().filter(c => (c.args[0] as { type: string }).type === ExtensionMsg.UpdateRepoStatus);
        assert.strictEqual(updateCalls.length, 0);
    });

    test('a check that throws still leaves a context for later saves to re-check against', async () => {
        // The context is what the save, create and rename listeners re-check against. Writing it only
        // once the answer is known would stop tracking the workspace whenever the answer never comes.
        getWorkspaceStatus.rejects(new Error('git unavailable'));

        const exerciseData = {
            exercise: { id: 12, studentParticipations: [{ repositoryUri: 'https://a/repo1.git' }] },
        };
        const { ctx } = buildContext({ currentExerciseData: exerciseData });
        const mod = new RepositoryStatusCommands(ctx, makeDeps());

        await mod.getHandlers()[WebviewCmd.CheckRepositoryStatus]({
            type: 'command', command: WebviewCmd.CheckRepositoryStatus,
        } as never);
        getWorkspaceStatus.resetHistory();
        getWorkspaceStatus.resolves({ isConnected: true, hasChanges: false, isPracticeRepo: false });
        await mod.recheckCurrentRepoStatus();

        sinon.assert.calledOnce(getWorkspaceStatus);
        assert.strictEqual(getWorkspaceStatus.firstCall.args[0], 'https://a/repo1.git');
    });

    test('a probe that threw after its exercise was left says nothing to the user', async () => {
        // "Error checking repository status" over a view the student has already moved on from is
        // noise at best, and a claim about the wrong exercise at worst.
        const exerciseData = {
            exercise: { id: 12, studentParticipations: [{ repositoryUri: 'https://a/repo1.git' }] },
        };
        const { ctx, appStateManager } = buildContext({ currentExerciseData: exerciseData });
        const mod = new RepositoryStatusCommands(ctx, makeDeps());
        getWorkspaceStatus.callsFake(async () => {
            appStateManager.showCourseList();
            throw new Error('git unavailable');
        });

        await mod.getHandlers()[WebviewCmd.CheckRepositoryStatus]({
            type: 'command', command: WebviewCmd.CheckRepositoryStatus,
        } as never);

        sinon.assert.notCalled(showErrorMessage);
    });

    test('recheckCurrentRepoStatus is a no-op when no context is set', async () => {
        const { ctx } = buildContext();
        const mod = new RepositoryStatusCommands(ctx, makeDeps());

        await mod.recheckCurrentRepoStatus();

        sinon.assert.notCalled(getWorkspaceStatus);
    });

    test('recheckCurrentRepoStatus triggers a fresh status check using the stored context', async () => {
        getWorkspaceStatus.resolves({ isConnected: true, hasChanges: false, isPracticeRepo: false });

        // The exercise the stored context belongs to has to be the one on screen. A context is only
        // ever set while its exercise is open, and a probe is not allowed to report about an
        // exercise the student has since left.
        const { ctx, sendMessage } = buildContext({ currentExerciseData: { exercise: { id: 99 } } });
        const mod = new RepositoryStatusCommands(ctx, makeDeps());

        mod.setRepositoryContext('https://artemis.example.com/git/stored.git', 99);

        await mod.recheckCurrentRepoStatus();

        sinon.assert.calledOnce(getWorkspaceStatus);
        assert.strictEqual(getWorkspaceStatus.firstCall.args[0], 'https://artemis.example.com/git/stored.git');
        const updateCalls = sendMessage.getCalls().filter(c => (c.args[0] as { type: string }).type === ExtensionMsg.UpdateRepoStatus);
        assert.strictEqual(updateCalls.length, 1);
    });

    test('dirty-page warning disabled: checkDirtyPages sends empty status without inspecting any text documents', async () => {
        const clock = sandbox.useFakeTimers();
        configValues.set('showUnsavedChangesWarning', false);

        // Even if a dirty doc exists, it should NOT be inspected.
        textDocuments = [
            { uri: vscode.Uri.file('/ws/dirty.java'), isDirty: true } as vscode.TextDocument,
        ];

        const { ctx, sendMessage } = buildContext();
        const mod = new RepositoryStatusCommands(ctx, makeDeps());

        // Trigger scheduleDirtyPagesCheck via the change listener (file-scheme doc).
        listeners.change?.({
            document: { uri: vscode.Uri.file('/ws/dirty.java') } as vscode.TextDocument,
        } as unknown as vscode.TextDocumentChangeEvent);

        await clock.tickAsync(300);

        const dirtyCalls = sendMessage.getCalls().filter(c => (c.args[0] as { type: string }).type === ExtensionMsg.UpdateDirtyPagesStatus);
        assert.strictEqual(dirtyCalls.length, 1, 'Expected exactly one UpdateDirtyPagesStatus message');
        assert.deepStrictEqual(dirtyCalls[0].args[0], {
            type: ExtensionMsg.UpdateDirtyPagesStatus,
            hasDirtyPages: false,
            dirtyFileCount: 0,
            autoSaveEnabled: false,
        });

        mod.dispose();
    });

    test('dirty-page detection: when warning enabled, dirty workspace doc results in hasDirtyPages=true with autoSaveEnabled reflecting files.autoSave', async () => {
        const clock = sandbox.useFakeTimers();
        configValues.set('showUnsavedChangesWarning', true);
        configValues.set('autoSave', 'afterDelay');

        textDocuments = [
            { uri: vscode.Uri.file('/ws/A.java'), isDirty: true } as vscode.TextDocument,
            { uri: vscode.Uri.file('/ws/B.java'), isDirty: false } as vscode.TextDocument,
            // Outside-workspace doc is filtered out
            { uri: vscode.Uri.file('/other/C.java'), isDirty: true } as vscode.TextDocument,
            // Non-file scheme is filtered out
            { uri: vscode.Uri.parse('untitled:Foo.java'), isDirty: true } as vscode.TextDocument,
        ];

        const { ctx, sendMessage } = buildContext();
        const mod = new RepositoryStatusCommands(ctx, makeDeps());

        listeners.change?.({
            document: { uri: vscode.Uri.file('/ws/A.java') } as vscode.TextDocument,
        } as unknown as vscode.TextDocumentChangeEvent);

        await clock.tickAsync(300);

        const dirtyCalls = sendMessage.getCalls().filter(c => (c.args[0] as { type: string }).type === ExtensionMsg.UpdateDirtyPagesStatus);
        assert.strictEqual(dirtyCalls.length, 1);
        assert.deepStrictEqual(dirtyCalls[0].args[0], {
            type: ExtensionMsg.UpdateDirtyPagesStatus,
            hasDirtyPages: true,
            dirtyFileCount: 1,
            autoSaveEnabled: true,
        });

        mod.dispose();
    });
});
