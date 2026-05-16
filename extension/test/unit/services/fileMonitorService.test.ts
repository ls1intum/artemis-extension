import * as vscode from 'vscode';
import * as assert from 'assert';
import * as sinon from 'sinon';

import type { FileMonitorUpdate } from '@extension/services/workspace/fileMonitorService';
import { FileMonitorService } from '@extension/services/workspace/fileMonitorService';
import * as workspaceFileChecker from '@extension/services/workspace/workspaceFileChecker';

suite('FileMonitorService', () => {
    let sandbox: sinon.SinonSandbox;
    let clock: sinon.SinonFakeTimers;
    let service: FileMonitorService;
    let checkWorkspaceFilesStub: sinon.SinonStub;
    let saveCallback: (doc: vscode.TextDocument) => void;
    let changeCallback: (e: vscode.TextDocumentChangeEvent) => void;
    let configGetStub: sinon.SinonStub;
    let mockWorkspaceFolders: vscode.WorkspaceFolder[] | undefined;

    const defaultResult: workspaceFileChecker.FileCheckResult = {
        hasChanges: true,
        files: [
            { path: 'src/foo.ts', status: 'included' },
            { path: 'node_modules/bar.js', status: 'excluded', reason: 'In excluded directory' },
        ],
        totalCount: 2,
        includedCount: 1,
        excludedCount: 1,
    };

    function createService(): FileMonitorService {
        service = new FileMonitorService();
        return service;
    }

    setup(() => {
        sandbox = sinon.createSandbox();
        clock = sinon.useFakeTimers({ shouldAdvanceTime: false });

        checkWorkspaceFilesStub = sandbox.stub(workspaceFileChecker, 'checkWorkspaceFiles').resolves(defaultResult);

        configGetStub = sandbox.stub();
        configGetStub.withArgs('sendUncommittedChanges', true).returns(true);
        sandbox.stub(vscode.workspace, 'getConfiguration').returns({
            get: configGetStub,
            has: sandbox.stub(),
            inspect: sandbox.stub(),
            update: sandbox.stub(),
        } as any);

        mockWorkspaceFolders = [{
            uri: vscode.Uri.file('/test/workspace'),
            name: 'workspace',
            index: 0,
        }];
        sandbox.stub(vscode.workspace, 'workspaceFolders').get(() => mockWorkspaceFolders);

        sandbox.stub(vscode.workspace, 'onDidSaveTextDocument').callsFake((listener: any) => {
            saveCallback = listener;
            return { dispose: () => {} };
        });

        sandbox.stub(vscode.workspace, 'onDidChangeTextDocument').callsFake((listener: any) => {
            changeCallback = listener;
            return { dispose: () => {} };
        });

        sandbox.stub(vscode.extensions, 'getExtension').returns(undefined);
    });

    teardown(() => {
        service?.dispose();
        clock.restore();
        sandbox.restore();
    });

    suite('Feature Toggle', () => {
        test('should skip checkWorkspaceFiles and fire empty update when disabled', async () => {
            configGetStub.withArgs('sendUncommittedChanges', true).returns(false);

            createService();
            await clock.tickAsync(0);

            const updates: FileMonitorUpdate[] = [];
            service.onDidUpdateFiles(u => updates.push(u));

            await service.triggerUpdate();

            assert.strictEqual(updates.length, 1);
            assert.deepStrictEqual(updates[0].includedFiles, []);
            assert.strictEqual(updates[0].totalCount, 0);
            assert.ok(checkWorkspaceFilesStub.notCalled);
        });

        test('should not fire event when no workspace folder exists', async () => {
            mockWorkspaceFolders = undefined;

            createService();
            await clock.tickAsync(0);

            const updates: FileMonitorUpdate[] = [];
            service.onDidUpdateFiles(u => updates.push(u));

            await service.triggerUpdate();

            assert.strictEqual(updates.length, 0);
            assert.ok(checkWorkspaceFilesStub.notCalled);
        });
    });

    suite('Event Payloads', () => {
        test('should default excluded reason to "Excluded" when reason is undefined', async () => {
            checkWorkspaceFilesStub.resolves({
                hasChanges: true,
                files: [
                    { path: 'big-file.bin', status: 'excluded', reason: undefined },
                ],
                totalCount: 1,
                includedCount: 0,
                excludedCount: 1,
            });

            createService();
            await clock.tickAsync(0);

            const updates: FileMonitorUpdate[] = [];
            service.onDidUpdateFiles(u => updates.push(u));

            await service.triggerUpdate();

            assert.strictEqual(updates[0].excludedFiles[0].reason, 'Excluded');
        });

        test('should silently handle errors from checkWorkspaceFiles', async () => {
            checkWorkspaceFilesStub.rejects(new Error('git crash'));

            createService();
            await clock.tickAsync(0);

            const updates: FileMonitorUpdate[] = [];
            service.onDidUpdateFiles(u => updates.push(u));

            await service.triggerUpdate();

            assert.strictEqual(updates.length, 0);
        });
    });

    suite('Document Change Throttling', () => {
        test('should throttle rapid changes within 2s window', async () => {
            createService();
            // Advance past the initial _lastFileUpdate=0 throttle window
            await clock.tickAsync(2001);
            const callsBefore = checkWorkspaceFilesStub.callCount;

            // First change goes through
            changeCallback({} as vscode.TextDocumentChangeEvent);
            await clock.tickAsync(0);
            assert.strictEqual(checkWorkspaceFilesStub.callCount, callsBefore + 1, 'First change should trigger');

            // Rapid second change within 2s should be throttled
            await clock.tickAsync(500);
            changeCallback({} as vscode.TextDocumentChangeEvent);
            await clock.tickAsync(0);
            assert.strictEqual(checkWorkspaceFilesStub.callCount, callsBefore + 1, 'Second rapid change should be throttled');
        });

        test('should allow update after 2s throttle expires', async () => {
            createService();
            await clock.tickAsync(2001);
            const callsBefore = checkWorkspaceFilesStub.callCount;

            changeCallback({} as vscode.TextDocumentChangeEvent);
            await clock.tickAsync(0);
            assert.strictEqual(checkWorkspaceFilesStub.callCount, callsBefore + 1);

            // Wait for throttle to expire then trigger again
            await clock.tickAsync(2001);
            changeCallback({} as vscode.TextDocumentChangeEvent);
            await clock.tickAsync(0);
            assert.strictEqual(checkWorkspaceFilesStub.callCount, callsBefore + 2);
        });
    });

    suite('Periodic Update & Dispose', () => {
        test('should stop periodic timer on dispose', async () => {
            createService();
            await clock.tickAsync(0);
            const callsAfterInit = checkWorkspaceFilesStub.callCount;

            service.dispose();

            await clock.tickAsync(10000);
            assert.strictEqual(checkWorkspaceFilesStub.callCount, callsAfterInit);
        });
    });
});
