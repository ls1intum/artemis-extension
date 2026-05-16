import * as vscode from 'vscode';
import * as assert from 'assert';
import * as sinon from 'sinon';

import { NoAiDetectionService } from '@extension/services/workspace/noAiDetectionService';

suite('NoAiDetectionService', () => {
    let sandbox: sinon.SinonSandbox;
    let mockWorkspaceFolders: vscode.WorkspaceFolder[];
    let fileExistsChecker: (uri: vscode.Uri) => Promise<boolean>;
    let service: NoAiDetectionService;

    function createService(): NoAiDetectionService {
        service = new NoAiDetectionService();
        return service;
    }

    setup(() => {
        sandbox = sinon.createSandbox();
        mockWorkspaceFolders = [];

        // Default file exists checker (returns false for all files)
        fileExistsChecker = async () => false;

        // Mock workspace folders
        sandbox.stub(vscode.workspace, 'workspaceFolders').get(() => mockWorkspaceFolders);

        // Mock workspace.onDidChangeWorkspaceFolders
        sandbox.stub(vscode.workspace, 'onDidChangeWorkspaceFolders').returns({
            dispose: () => {}
        } as vscode.Disposable);

        // Mock commands.executeCommand
        sandbox.stub(vscode.commands, 'executeCommand').resolves();
    });

    teardown(() => {
        service?.dispose();
        sandbox.restore();
    });

    suite('Initial State', () => {
        test('should have isNoAiEnabled as false when no workspace folders', () => {
            // Mock createFileSystemWatcher
            sandbox.stub(vscode.workspace, 'createFileSystemWatcher').returns({
                onDidCreate: () => ({ dispose: () => {} }),
                onDidDelete: () => ({ dispose: () => {} }),
                onDidChange: () => ({ dispose: () => {} }),
                dispose: () => {}
            } as any);

            service = createService();
            assert.strictEqual(service.isNoAiEnabled, false);
            assert.strictEqual(service.noAiFilePath, undefined);
        });
    });

    suite('File Detection', () => {
        test('should detect .noai file in workspace root', async () => {
            // Setup mock workspace folder
            mockWorkspaceFolders = [{
                uri: vscode.Uri.file('/test/workspace'),
                name: 'workspace',
                index: 0
            }];

            // Mock createFileSystemWatcher
            sandbox.stub(vscode.workspace, 'createFileSystemWatcher').returns({
                onDidCreate: () => ({ dispose: () => {} }),
                onDidDelete: () => ({ dispose: () => {} }),
                onDidChange: () => ({ dispose: () => {} }),
                dispose: () => {}
            } as any);

            service = createService();

            // Set custom file exists checker
            service.setFileExistsChecker(async (uri: vscode.Uri) => {
                return uri.fsPath === '/test/workspace/.noai';
            });

            // Wait for async initialization
            await service.waitForInitialization();

            const result = await service.checkForNoAiFile();
            assert.strictEqual(result, true);
            assert.strictEqual(service.isNoAiEnabled, true);
            assert.strictEqual(service.noAiFilePath, '/test/workspace/.noai');
        });

        test('should return false when no .noai file exists', async () => {
            // Setup mock workspace folder
            mockWorkspaceFolders = [{
                uri: vscode.Uri.file('/test/workspace'),
                name: 'workspace',
                index: 0
            }];

            // Mock createFileSystemWatcher
            sandbox.stub(vscode.workspace, 'createFileSystemWatcher').returns({
                onDidCreate: () => ({ dispose: () => {} }),
                onDidDelete: () => ({ dispose: () => {} }),
                onDidChange: () => ({ dispose: () => {} }),
                dispose: () => {}
            } as any);

            service = createService();

            // Set custom file exists checker that always returns false
            service.setFileExistsChecker(async () => false);

            // Wait for async initialization
            await service.waitForInitialization();

            const result = await service.checkForNoAiFile();
            assert.strictEqual(result, false);
            assert.strictEqual(service.isNoAiEnabled, false);
            assert.strictEqual(service.noAiFilePath, undefined);
        });
    });

    suite('Multi-Workspace', () => {
        test('should detect .noai file in any workspace folder', async () => {
            // Setup multiple mock workspace folders
            mockWorkspaceFolders = [
                {
                    uri: vscode.Uri.file('/test/workspace1'),
                    name: 'workspace1',
                    index: 0
                },
                {
                    uri: vscode.Uri.file('/test/workspace2'),
                    name: 'workspace2',
                    index: 1
                }
            ];

            // Mock createFileSystemWatcher
            sandbox.stub(vscode.workspace, 'createFileSystemWatcher').returns({
                onDidCreate: () => ({ dispose: () => {} }),
                onDidDelete: () => ({ dispose: () => {} }),
                onDidChange: () => ({ dispose: () => {} }),
                dispose: () => {}
            } as any);

            service = createService();

            // Set custom file exists checker - only second workspace has .noai
            service.setFileExistsChecker(async (uri: vscode.Uri) => {
                return uri.fsPath === '/test/workspace2/.noai';
            });

            // Wait for async initialization
            await service.waitForInitialization();

            const result = await service.checkForNoAiFile();
            assert.strictEqual(result, true);
            assert.strictEqual(service.isNoAiEnabled, true);
            assert.strictEqual(service.noAiFilePath, '/test/workspace2/.noai');
        });

        test('should stop checking after first .noai file found', async () => {
            // Setup multiple mock workspace folders
            mockWorkspaceFolders = [
                {
                    uri: vscode.Uri.file('/test/workspace1'),
                    name: 'workspace1',
                    index: 0
                },
                {
                    uri: vscode.Uri.file('/test/workspace2'),
                    name: 'workspace2',
                    index: 1
                }
            ];

            // Mock createFileSystemWatcher
            sandbox.stub(vscode.workspace, 'createFileSystemWatcher').returns({
                onDidCreate: () => ({ dispose: () => {} }),
                onDidDelete: () => ({ dispose: () => {} }),
                onDidChange: () => ({ dispose: () => {} }),
                dispose: () => {}
            } as any);

            service = createService();

            // Set custom file exists checker - both have .noai
            service.setFileExistsChecker(async (uri: vscode.Uri) => {
                return uri.fsPath === '/test/workspace1/.noai' || uri.fsPath === '/test/workspace2/.noai';
            });

            // Wait for async initialization
            await service.waitForInitialization();

            const result = await service.checkForNoAiFile();
            assert.strictEqual(result, true);
            // Should find the first one
            assert.strictEqual(service.noAiFilePath, '/test/workspace1/.noai');
        });
    });

    suite('Event Emission', () => {
        test('should fire event when status changes from false to true', async () => {
            mockWorkspaceFolders = [{
                uri: vscode.Uri.file('/test/workspace'),
                name: 'workspace',
                index: 0
            }];

            // Mock createFileSystemWatcher
            sandbox.stub(vscode.workspace, 'createFileSystemWatcher').returns({
                onDidCreate: () => ({ dispose: () => {} }),
                onDidDelete: () => ({ dispose: () => {} }),
                onDidChange: () => ({ dispose: () => {} }),
                dispose: () => {}
            } as any);

            service = createService();

            let fileExists = false;
            service.setFileExistsChecker(async (uri: vscode.Uri) => {
                return uri.fsPath === '/test/workspace/.noai' && fileExists;
            });

            // Wait for initial check
            await new Promise(resolve => setTimeout(resolve, 100));

            let eventFired = false;
            let eventValue: boolean | undefined;
            service.onNoAiStatusChanged(value => {
                eventFired = true;
                eventValue = value;
            });

            // Simulate .noai file creation
            fileExists = true;
            await service.checkForNoAiFile();

            assert.strictEqual(eventFired, true);
            assert.strictEqual(eventValue, true);
        });

        test('should fire event when status changes from true to false', async () => {
            mockWorkspaceFolders = [{
                uri: vscode.Uri.file('/test/workspace'),
                name: 'workspace',
                index: 0
            }];

            // Mock createFileSystemWatcher
            sandbox.stub(vscode.workspace, 'createFileSystemWatcher').returns({
                onDidCreate: () => ({ dispose: () => {} }),
                onDidDelete: () => ({ dispose: () => {} }),
                onDidChange: () => ({ dispose: () => {} }),
                dispose: () => {}
            } as any);

            service = createService();

            let fileExists = true;
            service.setFileExistsChecker(async (uri: vscode.Uri) => {
                return uri.fsPath === '/test/workspace/.noai' && fileExists;
            });

            // First check - should find .noai
            await service.checkForNoAiFile();
            assert.strictEqual(service.isNoAiEnabled, true);

            let eventFired = false;
            let eventValue: boolean | undefined;
            service.onNoAiStatusChanged(value => {
                eventFired = true;
                eventValue = value;
            });

            // Simulate .noai file deletion
            fileExists = false;
            await service.checkForNoAiFile();

            assert.strictEqual(eventFired, true);
            assert.strictEqual(eventValue, false);
        });

        test('should not fire event when status does not change', async () => {
            mockWorkspaceFolders = [{
                uri: vscode.Uri.file('/test/workspace'),
                name: 'workspace',
                index: 0
            }];

            // Mock createFileSystemWatcher
            sandbox.stub(vscode.workspace, 'createFileSystemWatcher').returns({
                onDidCreate: () => ({ dispose: () => {} }),
                onDidDelete: () => ({ dispose: () => {} }),
                onDidChange: () => ({ dispose: () => {} }),
                dispose: () => {}
            } as any);

            service = createService();

            // Set file exists checker that always returns false
            service.setFileExistsChecker(async () => false);

            // Wait for initial check
            await new Promise(resolve => setTimeout(resolve, 100));

            let eventCount = 0;
            service.onNoAiStatusChanged(() => {
                eventCount++;
            });

            // Check multiple times - status stays false
            await service.checkForNoAiFile();
            await service.checkForNoAiFile();
            await service.checkForNoAiFile();

            assert.strictEqual(eventCount, 0);
        });
    });

    suite('VS Code Context', () => {
        test('should set iris:noAiDetected context when .noai detected', async () => {
            mockWorkspaceFolders = [{
                uri: vscode.Uri.file('/test/workspace'),
                name: 'workspace',
                index: 0
            }];

            // Mock createFileSystemWatcher
            sandbox.stub(vscode.workspace, 'createFileSystemWatcher').returns({
                onDidCreate: () => ({ dispose: () => {} }),
                onDidDelete: () => ({ dispose: () => {} }),
                onDidChange: () => ({ dispose: () => {} }),
                dispose: () => {}
            } as any);

            const executeCommandStub = vscode.commands.executeCommand as sinon.SinonStub;

            service = createService();

            // Set custom file exists checker
            service.setFileExistsChecker(async (uri: vscode.Uri) => {
                return uri.fsPath === '/test/workspace/.noai';
            });

            await service.checkForNoAiFile();

            // Verify setContext was called with correct values
            const setContextCall = executeCommandStub.getCalls().find(
                call => call.args[0] === 'setContext' && call.args[1] === 'iris:noAiDetected'
            );
            assert.ok(setContextCall, 'setContext should be called for iris:noAiDetected');
            assert.strictEqual(setContextCall.args[2], true);
        });
    });

    suite('Disposal', () => {
        test('should dispose resources correctly', () => {
            // Mock createFileSystemWatcher with spy
            const disposeSpy = sandbox.spy();
            sandbox.stub(vscode.workspace, 'createFileSystemWatcher').returns({
                onDidCreate: () => ({ dispose: () => {} }),
                onDidDelete: () => ({ dispose: () => {} }),
                onDidChange: () => ({ dispose: () => {} }),
                dispose: disposeSpy
            } as any);

            service = createService();
            service.dispose();

            assert.ok(disposeSpy.called, 'File watcher should be disposed');
        });
    });
});
