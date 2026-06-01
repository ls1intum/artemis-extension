import * as vscode from 'vscode';
import * as assert from 'assert';
import * as sinon from 'sinon';

import { WebviewCmd } from '@shared/messageContracts/webviewCommands';

import { BuildLogCommands } from '@extension/controller/commands/buildLogCommands';
import type { CommandContext } from '@extension/controller/commands/types';
import { BuildLogParser } from '@extension/utils';

suite('BuildLogCommands', () => {
    let sandbox: sinon.SinonSandbox;
    let showErrorMessage: sinon.SinonStub;
    let showInformationMessage: sinon.SinonStub;
    let openTextDocument: sinon.SinonStub;
    let showTextDocument: sinon.SinonStub;
    let executeCommand: sinon.SinonStub;

    setup(() => {
        sandbox = sinon.createSandbox();
        showErrorMessage = sandbox.stub(vscode.window, 'showErrorMessage').resolves(undefined as never);
        showInformationMessage = sandbox.stub(vscode.window, 'showInformationMessage').resolves(undefined as never);
        openTextDocument = sandbox.stub(vscode.workspace, 'openTextDocument').resolves({ uri: vscode.Uri.parse('untitled:logs') } as never);
        showTextDocument = sandbox.stub(vscode.window, 'showTextDocument').resolves(undefined as never);
        executeCommand = sandbox.stub(vscode.commands, 'executeCommand').resolves(undefined as never);
    });

    teardown(() => {
        sandbox.restore();
    });

    function buildContext(getBuildLogs: sinon.SinonStub): CommandContext {
        return {
            artemisApi: { getBuildLogs },
        } as unknown as CommandContext;
    }

    test('getHandlers returns exactly viewBuildLog and goToSource keys', () => {
        const ctx = buildContext(sandbox.stub().resolves([]));
        const mod = new BuildLogCommands(ctx);

        const keys = Object.keys(mod.getHandlers()).sort();

        assert.deepStrictEqual(keys, [WebviewCmd.GoToSource, WebviewCmd.ViewBuildLog].sort());
    });

    test('viewBuildLog fetches logs, opens a text document with joined log lines, and shows it', async () => {
        const logs = [
            { id: 1, time: '2024-01-01T00:00:00Z', log: 'compile error line 1' },
            { id: 2, time: '2024-01-01T00:00:01Z', log: 'compile error line 2' },
        ];
        const getBuildLogs = sandbox.stub().resolves(logs);
        const ctx = buildContext(getBuildLogs);
        const mod = new BuildLogCommands(ctx);

        await mod.getHandlers()[WebviewCmd.ViewBuildLog]({
            type: 'command',
            command: WebviewCmd.ViewBuildLog,
            payload: { participationId: 42, resultId: 7 },
        } as never);

        sinon.assert.calledOnceWithExactly(getBuildLogs, 42, 7);
        sinon.assert.calledOnce(openTextDocument);
        const openArgs = openTextDocument.firstCall.args[0];
        assert.strictEqual(
            openArgs.content,
            '[2024-01-01T00:00:00Z] compile error line 1\n[2024-01-01T00:00:01Z] compile error line 2',
        );
        assert.strictEqual(openArgs.language, 'log');
        sinon.assert.calledOnce(showTextDocument);
    });

    test('viewBuildLog surfaces an error toast when getBuildLogs throws', async () => {
        const getBuildLogs = sandbox.stub().rejects(new Error('network down'));
        const ctx = buildContext(getBuildLogs);
        const mod = new BuildLogCommands(ctx);

        await mod.getHandlers()[WebviewCmd.ViewBuildLog]({
            type: 'command',
            command: WebviewCmd.ViewBuildLog,
            payload: { participationId: 1, resultId: 2 },
        } as never);

        sinon.assert.notCalled(openTextDocument);
        sinon.assert.notCalled(showTextDocument);
        sinon.assert.calledOnceWithExactly(showErrorMessage, 'Failed to fetch build logs.');
    });

    test('goToSource executes artemis.goToSourceError with parsed error coordinates when a source error is found', async () => {
        const logs = [{ id: 1, time: 't', log: 'irrelevant' }];
        const parsedError = { filePath: 'src/Foo.java', line: 12, column: 3, message: 'cannot find symbol' };
        const getBuildLogs = sandbox.stub().resolves(logs);
        sandbox.stub(BuildLogParser, 'parseFirstError').returns(parsedError);
        const ctx = buildContext(getBuildLogs);
        const mod = new BuildLogCommands(ctx);

        await mod.getHandlers()[WebviewCmd.GoToSource]({
            type: 'command',
            command: WebviewCmd.GoToSource,
            payload: { participationId: 11, resultId: 22 },
        } as never);

        sinon.assert.calledOnceWithExactly(getBuildLogs, 11, 22);
        sinon.assert.calledOnceWithExactly(
            executeCommand,
            'artemis.goToSourceError',
            'src/Foo.java',
            12,
            3,
            'cannot find symbol',
        );
        sinon.assert.notCalled(showInformationMessage);
    });

    test('goToSource shows an information toast when no error is found in the logs', async () => {
        const logs = [{ id: 1, time: 't', log: 'no error here' }];
        const getBuildLogs = sandbox.stub().resolves(logs);
        sandbox.stub(BuildLogParser, 'parseFirstError').returns(null);
        const ctx = buildContext(getBuildLogs);
        const mod = new BuildLogCommands(ctx);

        await mod.getHandlers()[WebviewCmd.GoToSource]({
            type: 'command',
            command: WebviewCmd.GoToSource,
            payload: { participationId: 1, resultId: 2 },
        } as never);

        sinon.assert.notCalled(executeCommand);
        sinon.assert.calledOnceWithExactly(showInformationMessage, 'No source error location found in build logs');
    });

    test('goToSource surfaces an error toast when an exception is thrown', async () => {
        const getBuildLogs = sandbox.stub().rejects(new Error('boom'));
        const ctx = buildContext(getBuildLogs);
        const mod = new BuildLogCommands(ctx);

        await mod.getHandlers()[WebviewCmd.GoToSource]({
            type: 'command',
            command: WebviewCmd.GoToSource,
            payload: { participationId: 1, resultId: 2 },
        } as never);

        sinon.assert.notCalled(executeCommand);
        sinon.assert.calledOnceWithExactly(showErrorMessage, 'Failed to navigate to source error.');
    });
});
