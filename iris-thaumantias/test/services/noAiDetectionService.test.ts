import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import { NoAiDetectionService } from '../../src/services/noAiDetectionService';

suite('NoAiDetectionService', () => {
    let sandbox: sinon.SinonSandbox;
    let mockWorkspaceFolders: vscode.WorkspaceFolder[];

    setup(() => {
        sandbox = sinon.createSandbox();
        mockWorkspaceFolders = [];
        
        // Reset the singleton instance before each test
        NoAiDetectionService.resetInstance();
        
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
        NoAiDetectionService.resetInstance();
        sandbox.restore();
    });

    suite('Singleton Pattern', () => {
        test('should return the same instance', () => {
            // Mock createFileSystemWatcher and fs.stat
            sandbox.stub(vscode.workspace, 'createFileSystemWatcher').returns({
                onDidCreate: () => ({ dispose: () => {} }),
                onDidDelete: () => ({ dispose: () => {} }),
                onDidChange: () => ({ dispose: () => {} }),
                dispose: () => {}
            } as any);

            const instance1 = NoAiDetectionService.getInstance();
            const instance2 = NoAiDetectionService.getInstance();
            assert.strictEqual(instance1, instance2);
        });

        test('should create new instance after reset', () => {
            // Mock createFileSystemWatcher
            sandbox.stub(vscode.workspace, 'createFileSystemWatcher').returns({
                onDidCreate: () => ({ dispose: () => {} }),
                onDidDelete: () => ({ dispose: () => {} }),
                onDidChange: () => ({ dispose: () => {} }),
                dispose: () => {}
            } as any);

            const instance1 = NoAiDetectionService.getInstance();
            NoAiDetectionService.resetInstance();
            const instance2 = NoAiDetectionService.getInstance();
            assert.notStrictEqual(instance1, instance2);
        });
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

            const service = NoAiDetectionService.getInstance();
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

            // Mock file exists check
            const fsStatStub = sandbox.stub(vscode.workspace.fs, 'stat');
            fsStatStub.callsFake((uri: vscode.Uri) => {
                if (uri.fsPath === '/test/workspace/.noai') {
                    return Promise.resolve({ type: vscode.FileType.File } as vscode.FileStat);
                }
                return Promise.reject(new Error('File not found'));
            });

            // Mock createFileSystemWatcher
            sandbox.stub(vscode.workspace, 'createFileSystemWatcher').returns({
                onDidCreate: () => ({ dispose: () => {} }),
                onDidDelete: () => ({ dispose: () => {} }),
                onDidChange: () => ({ dispose: () => {} }),
                dispose: () => {}
            } as any);

            const service = NoAiDetectionService.getInstance();
            
            // Wait for async initialization
            await new Promise(resolve => setTimeout(resolve, 100));

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

            // Mock file exists check - always reject
            sandbox.stub(vscode.workspace.fs, 'stat').rejects(new Error('File not found'));

            // Mock createFileSystemWatcher
            sandbox.stub(vscode.workspace, 'createFileSystemWatcher').returns({
                onDidCreate: () => ({ dispose: () => {} }),
                onDidDelete: () => ({ dispose: () => {} }),
                onDidChange: () => ({ dispose: () => {} }),
                dispose: () => {}
            } as any);

            const service = NoAiDetectionService.getInstance();
            
            // Wait for async initialization
            await new Promise(resolve => setTimeout(resolve, 100));

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

            // Mock file exists check - only second workspace has .noai
            sandbox.stub(vscode.workspace.fs, 'stat').callsFake((uri: vscode.Uri) => {
                if (uri.fsPath === '/test/workspace2/.noai') {
                    return Promise.resolve({ type: vscode.FileType.File } as vscode.FileStat);
                }
                return Promise.reject(new Error('File not found'));
            });

            // Mock createFileSystemWatcher
            sandbox.stub(vscode.workspace, 'createFileSystemWatcher').returns({
                onDidCreate: () => ({ dispose: () => {} }),
                onDidDelete: () => ({ dispose: () => {} }),
                onDidChange: () => ({ dispose: () => {} }),
                dispose: () => {}
            } as any);

            const service = NoAiDetectionService.getInstance();
            
            // Wait for async initialization
            await new Promise(resolve => setTimeout(resolve, 100));

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

            // Mock file exists check - both have .noai
            sandbox.stub(vscode.workspace.fs, 'stat').callsFake((uri: vscode.Uri) => {
                if (uri.fsPath === '/test/workspace1/.noai' || uri.fsPath === '/test/workspace2/.noai') {
                    return Promise.resolve({ type: vscode.FileType.File } as vscode.FileStat);
                }
                return Promise.reject(new Error('File not found'));
            });

            // Mock createFileSystemWatcher
            sandbox.stub(vscode.workspace, 'createFileSystemWatcher').returns({
                onDidCreate: () => ({ dispose: () => {} }),
                onDidDelete: () => ({ dispose: () => {} }),
                onDidChange: () => ({ dispose: () => {} }),
                dispose: () => {}
            } as any);

            const service = NoAiDetectionService.getInstance();
            
            // Wait for async initialization
            await new Promise(resolve => setTimeout(resolve, 100));

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

            let fileExists = false;
            sandbox.stub(vscode.workspace.fs, 'stat').callsFake((uri: vscode.Uri) => {
                if (uri.fsPath === '/test/workspace/.noai' && fileExists) {
                    return Promise.resolve({ type: vscode.FileType.File } as vscode.FileStat);
                }
                return Promise.reject(new Error('File not found'));
            });

            // Mock createFileSystemWatcher
            sandbox.stub(vscode.workspace, 'createFileSystemWatcher').returns({
                onDidCreate: () => ({ dispose: () => {} }),
                onDidDelete: () => ({ dispose: () => {} }),
                onDidChange: () => ({ dispose: () => {} }),
                dispose: () => {}
            } as any);

            const service = NoAiDetectionService.getInstance();
            
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

            let fileExists = true;
            sandbox.stub(vscode.workspace.fs, 'stat').callsFake((uri: vscode.Uri) => {
                if (uri.fsPath === '/test/workspace/.noai' && fileExists) {
                    return Promise.resolve({ type: vscode.FileType.File } as vscode.FileStat);
                }
                return Promise.reject(new Error('File not found'));
            });

            // Mock createFileSystemWatcher
            sandbox.stub(vscode.workspace, 'createFileSystemWatcher').returns({
                onDidCreate: () => ({ dispose: () => {} }),
                onDidDelete: () => ({ dispose: () => {} }),
                onDidChange: () => ({ dispose: () => {} }),
                dispose: () => {}
            } as any);

            const service = NoAiDetectionService.getInstance();
            
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

            sandbox.stub(vscode.workspace.fs, 'stat').rejects(new Error('File not found'));

            // Mock createFileSystemWatcher
            sandbox.stub(vscode.workspace, 'createFileSystemWatcher').returns({
                onDidCreate: () => ({ dispose: () => {} }),
                onDidDelete: () => ({ dispose: () => {} }),
                onDidChange: () => ({ dispose: () => {} }),
                dispose: () => {}
            } as any);

            const service = NoAiDetectionService.getInstance();
            
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

            sandbox.stub(vscode.workspace.fs, 'stat').callsFake((uri: vscode.Uri) => {
                if (uri.fsPath === '/test/workspace/.noai') {
                    return Promise.resolve({ type: vscode.FileType.File } as vscode.FileStat);
                }
                return Promise.reject(new Error('File not found'));
            });

            // Mock createFileSystemWatcher
            sandbox.stub(vscode.workspace, 'createFileSystemWatcher').returns({
                onDidCreate: () => ({ dispose: () => {} }),
                onDidDelete: () => ({ dispose: () => {} }),
                onDidChange: () => ({ dispose: () => {} }),
                dispose: () => {}
            } as any);

            const executeCommandStub = vscode.commands.executeCommand as sinon.SinonStub;
            
            const service = NoAiDetectionService.getInstance();
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

            const service = NoAiDetectionService.getInstance();
            service.dispose();

            assert.ok(disposeSpy.called, 'File watcher should be disposed');
        });
    });
});
