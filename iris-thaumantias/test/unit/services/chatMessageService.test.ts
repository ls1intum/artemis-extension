import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import { ChatMessageService } from '../../../src/services/iris/chatMessageService';
import { IrisChatSessionService } from '../../../src/services/iris/chatSessionService';
import { ContextStore } from '../../../src/services/iris/contextStore';
import { ArtemisApiService } from '../../../src/api';
import { MockExtensionContext } from '../mocks/vscodeMocks';
import * as workspaceFileChecker from '../../../src/services/workspace/workspaceFileChecker';
import type { ActiveContext } from '../../../src/types';

suite('ChatMessageService', () => {
    let sandbox: sinon.SinonSandbox;
    let contextStore: ContextStore;
    let mockApiService: sinon.SinonStubbedInstance<ArtemisApiService>;
    let postMessageSpy: sinon.SinonSpy;
    let mockChatSessionService: sinon.SinonStubbedInstance<IrisChatSessionService>;
    let postSnapshotSpy: sinon.SinonSpy;
    let checkWorkspaceFilesStub: sinon.SinonStub;
    let configGetStub: sinon.SinonStub;
    let configUpdateStub: sinon.SinonStub;
    let showWarningMessageStub: sinon.SinonStub;
    let showErrorMessageStub: sinon.SinonStub;
    let mockSessionManager: { currentSessionId: number | undefined };
    let service: ChatMessageService;

    const activeContext: ActiveContext = {
        type: 'exercise',
        id: 123,
        title: 'Test Exercise',
        courseId: 101,
        source: 'user-selected',
        locked: false,
        selectedAt: Date.now(),
    };

    const defaultFileResult: workspaceFileChecker.FileCheckResult = {
        hasChanges: true,
        files: [
            { path: 'src/main.ts', status: 'included', content: 'console.log("hello")' },
            { path: 'src/helper.ts', status: 'included', content: 'export function help() {}' },
            { path: 'dist/main.js', status: 'excluded', reason: 'Binary file' },
        ],
        totalCount: 3,
        includedCount: 2,
        excludedCount: 1,
    };

    function createService(apiService?: ArtemisApiService | undefined): ChatMessageService {
        service = new ChatMessageService(
            {
                contextStore,
                artemisApiService: apiService === undefined && arguments.length > 0 ? undefined : (mockApiService as any),
                postMessage: postMessageSpy,
                postSnapshot: postSnapshotSpy,
            },
            { isConnected: () => true, ensureConnection: sandbox.stub().resolves(true) } as any,
            () => mockSessionManager as any,
            mockChatSessionService as any,
        );
        return service;
    }

    setup(() => {
        sandbox = sinon.createSandbox();

        const mockContext = new MockExtensionContext();
        contextStore = new ContextStore(mockContext);

        mockApiService = sinon.createStubInstance(ArtemisApiService);
        mockApiService.sendChatMessage.resolves();

        postMessageSpy = sinon.spy();
        mockChatSessionService = sinon.createStubInstance(IrisChatSessionService);
        mockChatSessionService.initializeIrisSessionAndLoadMessages.resolves();
        postSnapshotSpy = sinon.spy();

        mockSessionManager = { currentSessionId: 42 };

        checkWorkspaceFilesStub = sandbox.stub(workspaceFileChecker, 'checkWorkspaceFiles').resolves(defaultFileResult);

        configGetStub = sandbox.stub();
        configGetStub.withArgs('sendUncommittedChanges', true).returns(true);
        configUpdateStub = sandbox.stub().resolves();
        sandbox.stub(vscode.workspace, 'getConfiguration').returns({
            get: configGetStub,
            has: sandbox.stub(),
            inspect: sandbox.stub(),
            update: configUpdateStub,
        } as any);

        sandbox.stub(vscode.workspace, 'workspaceFolders').get(() => [{
            uri: vscode.Uri.file('/test/workspace'),
            name: 'workspace',
            index: 0,
        }]);

        showWarningMessageStub = sandbox.stub(vscode.window, 'showWarningMessage').resolves(undefined as any);
        showErrorMessageStub = sandbox.stub(vscode.window, 'showErrorMessage').resolves(undefined as any);
    });

    teardown(() => {
        sandbox.restore();
        sinon.restore();
    });

    suite('Feature Toggle', () => {
        test('should not collect files when disabled — API still receives undefined', async () => {
            configGetStub.withArgs('sendUncommittedChanges', true).returns(false);
            createService();

            await service.handleChatMessage('Hello', activeContext);

            assert.ok(checkWorkspaceFilesStub.notCalled);
            assert.ok(mockApiService.sendChatMessage.calledOnce);
            assert.strictEqual(mockApiService.sendChatMessage.firstCall.args[2], undefined);
        });

        test('should return early for empty message text', async () => {
            createService();

            await service.handleChatMessage('', activeContext);

            assert.ok(mockApiService.sendChatMessage.notCalled);
            assert.ok(checkWorkspaceFilesStub.notCalled);
        });

        test('should show error when API service not available', async () => {
            createService(undefined);

            await service.handleChatMessage('Hello', activeContext);

            assert.ok(showErrorMessageStub.calledOnce);
            assert.ok((showErrorMessageStub.firstCall.args[0] as string).includes('Artemis API service not available'));
        });
    });

    suite('File Collection & Filtering', () => {
        test('should skip files without content', async () => {
            checkWorkspaceFilesStub.resolves({
                hasChanges: true,
                files: [
                    { path: 'src/no-content.ts', status: 'included', content: undefined },
                    { path: 'src/with-content.ts', status: 'included', content: 'data' },
                ],
                totalCount: 2,
                includedCount: 2,
                excludedCount: 0,
            });
            createService();

            await service.handleChatMessage('Hello', activeContext);

            const filesArg = mockApiService.sendChatMessage.firstCall.args[2] as Map<string, string>;
            assert.strictEqual(filesArg.size, 1);
            assert.ok(!filesArg.has('src/no-content.ts'));
            assert.strictEqual(filesArg.get('src/with-content.ts'), 'data');
        });

        test('should skip excluded files even when they have content', async () => {
            checkWorkspaceFilesStub.resolves({
                hasChanges: true,
                files: [
                    { path: 'dist/main.js', status: 'excluded', reason: 'Build output', content: 'compiled' },
                ],
                totalCount: 1,
                includedCount: 0,
                excludedCount: 1,
            });
            createService();

            await service.handleChatMessage('Hello', activeContext);

            const filesArg = mockApiService.sendChatMessage.firstCall.args[2] as Map<string, string>;
            assert.strictEqual(filesArg.size, 0);
        });
    });

    suite('Webview Update Message', () => {
        test('should post UpdateReferencedFiles with correct payload when files found', async () => {
            createService();

            await service.handleChatMessage('Hello', activeContext);

            const updateCall = postMessageSpy.getCalls().find(
                (c: sinon.SinonSpyCall) => c.args[0]?.type === 'updateReferencedFiles'
            );
            assert.ok(updateCall, 'Should post updateReferencedFiles');
            assert.deepStrictEqual(updateCall.args[0].includedFiles, ['src/main.ts', 'src/helper.ts']);
            assert.deepStrictEqual(updateCall.args[0].excludedFiles, [{ path: 'dist/main.js', reason: 'Binary file' }]);
            assert.strictEqual(updateCall.args[0].totalCount, 3);
        });

        test('should not post UpdateReferencedFiles when no included files', async () => {
            checkWorkspaceFilesStub.resolves({
                hasChanges: false,
                files: [],
                totalCount: 0,
                includedCount: 0,
                excludedCount: 0,
            });
            createService();

            await service.handleChatMessage('Hello', activeContext);

            const updateCall = postMessageSpy.getCalls().find(
                (c: sinon.SinonSpyCall) => c.args[0]?.type === 'updateReferencedFiles'
            );
            assert.ok(!updateCall);
        });

        test('should default excluded reason to "Excluded"', async () => {
            checkWorkspaceFilesStub.resolves({
                hasChanges: true,
                files: [
                    { path: 'src/a.ts', status: 'included', content: 'x' },
                    { path: 'src/b.ts', status: 'excluded', reason: undefined },
                ],
                totalCount: 2,
                includedCount: 1,
                excludedCount: 1,
            });
            createService();

            await service.handleChatMessage('Hello', activeContext);

            const updateCall = postMessageSpy.getCalls().find(
                (c: sinon.SinonSpyCall) => c.args[0]?.type === 'updateReferencedFiles'
            );
            assert.ok(updateCall);
            assert.strictEqual(updateCall.args[0].excludedFiles[0].reason, 'Excluded');
        });

        test('should post updateReferencedFiles without a preceding user addMessage', async () => {
            createService();

            await service.handleChatMessage('Hello', activeContext);

            const addMessageCall = postMessageSpy.getCalls().find(
                (c: sinon.SinonSpyCall) => c.args[0]?.type === 'addMessage' && c.args[0]?.message?.role === 'user'
            );
            const updateCall = postMessageSpy.getCalls().find(
                (c: sinon.SinonSpyCall) => c.args[0]?.type === 'updateReferencedFiles'
            );
            assert.ok(!addMessageCall, 'Should not post user addMessage from service');
            assert.ok(updateCall, 'Should post file update');
        });
    });

    suite('Error Handling', () => {
        test('should show Git-specific warning for Git errors', async () => {
            checkWorkspaceFilesStub.rejects(new Error('Git command failed'));
            createService();

            await service.handleChatMessage('Hello', activeContext);

            assert.ok(showWarningMessageStub.calledOnce);
            assert.ok(
                (showWarningMessageStub.firstCall.args[0] as string).includes('Failed to collect uncommitted files from Git'),
            );
        });

        test('should show ENOENT-specific warning for file-not-found errors', async () => {
            const error: any = new Error('File not found');
            error.code = 'ENOENT';
            checkWorkspaceFilesStub.rejects(error);
            createService();

            await service.handleChatMessage('Hello', activeContext);

            assert.ok(showWarningMessageStub.calledOnce);
            assert.ok(
                (showWarningMessageStub.firstCall.args[0] as string).includes('Some files could not be read'),
            );
        });

        test('should offer Disable Feature for generic errors and honor the choice', async () => {
            checkWorkspaceFilesStub.rejects(new Error('Unknown error'));
            showWarningMessageStub.resolves('Disable Feature');
            createService();

            await service.handleChatMessage('Hello', activeContext);

            const args = showWarningMessageStub.firstCall.args;
            assert.ok(args.includes('Disable Feature'));
            assert.ok(args.includes('OK'));

            // Wait for the .then() handler
            await new Promise(resolve => setTimeout(resolve, 0));

            assert.ok(configUpdateStub.calledWith('sendUncommittedChanges', false, true));
        });

        test('should still send message to API with undefined files on error', async () => {
            checkWorkspaceFilesStub.rejects(new Error('crash'));
            createService();

            await service.handleChatMessage('Hello', activeContext);

            assert.ok(mockApiService.sendChatMessage.calledOnce);
            assert.strictEqual(mockApiService.sendChatMessage.firstCall.args[2], undefined);
        });
    });
});
