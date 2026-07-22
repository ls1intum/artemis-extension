import * as vscode from 'vscode';
import * as assert from 'assert';
import * as sinon from 'sinon';

import { ArtemisApiService } from '@extension/api';
import { ChatMessageService } from '@extension/services/iris/chat/chatMessageService';
import { IrisChatSessionService } from '@extension/services/iris/chat/chatSessionService';
import { ContextStore } from '@extension/services/iris/context/contextStore';
import type { RunLifecycle } from '@extension/services/iris/irisRunStateMachine';
import * as workspaceFileChecker from '@extension/services/workspace/workspaceFileChecker';
import type { ActiveContext } from '@extension/types';
import { MockExtensionContext } from '@test/unit/mocks/vscodeMocks';

suite('ChatMessageService', () => {
    let sandbox: sinon.SinonSandbox;
    let contextStore: ContextStore;
    let mockApiService: sinon.SinonStubbedInstance<ArtemisApiService>;
    let postMessageSpy: sinon.SinonSpy;
    let mockChatSessionService: sinon.SinonStubbedInstance<IrisChatSessionService>;
    let postSnapshotSpy: sinon.SinonSpy;
    let checkWorkspaceFilesStub: sinon.SinonStub;
    let configGetStub: sinon.SinonStub;
    let mockSessionManager: { currentSessionId: number | undefined };
    let mockLifecycle: { beginGeneration: sinon.SinonStub; abortGeneration: sinon.SinonStub };
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

    function createService(
        apiService?: ArtemisApiService | undefined,
        overrides?: { websocketService?: unknown; lifecycle?: RunLifecycle },
    ): ChatMessageService {
        service = new ChatMessageService(
            {
                contextStore,
                artemisApiService: apiService === undefined && arguments.length > 0 ? undefined : (mockApiService as any),
                postMessage: postMessageSpy,
                postSnapshot: postSnapshotSpy,
            },
            (overrides?.websocketService ?? { isConnected: () => true, connect: sandbox.stub().resolves() }) as any,
            () => mockSessionManager as any,
            mockChatSessionService as any,
            (overrides?.lifecycle ?? mockLifecycle) as unknown as RunLifecycle,
        );
        return service;
    }

    /** Helper: calls sendMessage with defaults for tests that just need the Iris send path. */
    async function sendHello(): Promise<void> {
        const result = await service.sendMessage({ text: 'Hello', isNoAiEnabled: false });
        if (!result.sent) { throw new Error(`sendMessage returned not-sent: ${result.reason}`); }
    }

    setup(() => {
        sandbox = sinon.createSandbox();

        const mockContext = new MockExtensionContext();
        contextStore = new ContextStore(mockContext);

        // Set active context so sendMessage's no-context check passes
        contextStore.setActiveContext(activeContext);

        mockApiService = sinon.createStubInstance(ArtemisApiService);
        mockApiService.sendChatMessage.resolves();

        postMessageSpy = sinon.spy();
        mockChatSessionService = sinon.createStubInstance(IrisChatSessionService);
        mockChatSessionService.initializeIrisSessionAndLoadMessages.resolves();
        // Stub Iris settings check to return enabled by default
        mockChatSessionService.checkAndLoadIrisSettings.resolves({ kind: 'enabled' });
        postSnapshotSpy = sinon.spy();

        mockSessionManager = { currentSessionId: 42 };

        mockLifecycle = { beginGeneration: sandbox.stub().returns(1), abortGeneration: sandbox.stub() };

        checkWorkspaceFilesStub = sandbox.stub(workspaceFileChecker, 'checkWorkspaceFiles').resolves(defaultFileResult);

        configGetStub = sandbox.stub();
        configGetStub.withArgs('sendUncommittedChanges', true).returns(true);
        sandbox.stub(vscode.workspace, 'getConfiguration').returns({
            get: configGetStub,
            has: sandbox.stub(),
            inspect: sandbox.stub(),
            update: sandbox.stub().resolves(),
        } as any);

        sandbox.stub(vscode.workspace, 'workspaceFolders').get(() => [{
            uri: vscode.Uri.file('/test/workspace'),
            name: 'workspace',
            index: 0,
        }]);

        // Stubs kept to prevent unhandled vscode.window calls during tests
        sandbox.stub(vscode.window, 'showWarningMessage').resolves(undefined as any);
        sandbox.stub(vscode.window, 'showErrorMessage').resolves(undefined as any);
    });

    teardown(() => {
        sandbox.restore();
        sinon.restore();
    });

    suite('sendMessage workflow', () => {
        test('should return no-ai when .noai is enabled', async () => {
            createService();
            const result = await service.sendMessage({ text: 'Hello', isNoAiEnabled: true });
            assert.deepStrictEqual(result, { sent: false, reason: 'no-ai' });
        });

        test('should return no-context when no active context', async () => {
            contextStore.clearActiveContext();
            createService();
            const result = await service.sendMessage({ text: 'Hello', isNoAiEnabled: false });
            assert.deepStrictEqual(result, { sent: false, reason: 'no-context' });
        });

        test('should return iris-disabled when Iris is not enabled', async () => {
            mockChatSessionService.checkAndLoadIrisSettings.resolves({ kind: 'disabled' });
            createService();
            const result = await service.sendMessage({ text: 'Hello', isNoAiEnabled: false });
            assert.ok(!result.sent);
            if (!result.sent) {
                assert.strictEqual(result.reason, 'iris-disabled');
                assert.strictEqual(result.contextLabel, 'exercise');
                // capturedContext is the contract the provider uses to detect
                // a stale send-rejection after a mid-flight context switch;
                // pin it here so the contract cannot regress silently.
                assert.ok(result.capturedContext, 'capturedContext must be threaded through');
                assert.strictEqual(result.capturedContext.id, activeContext.id);
                assert.strictEqual(result.capturedContext.type, activeContext.type);
            }
        });

        test('returns iris-unavailable when settings check classifies as unavailable', async () => {
            mockChatSessionService.checkAndLoadIrisSettings.resolves({
                kind: 'unavailable',
                reason: 'Server returned 500',
            });
            createService();
            const result = await service.sendMessage({ text: 'Hello', isNoAiEnabled: false });
            assert.ok(!result.sent);
            if (!result.sent) {
                assert.strictEqual(result.reason, 'iris-unavailable');
                assert.strictEqual(result.contextLabel, 'exercise');
                // Same contract as iris-disabled: the captured context flows
                // through so the provider can drop stale rejections.
                assert.ok(result.capturedContext, 'capturedContext must be threaded through');
                assert.strictEqual(result.capturedContext.id, activeContext.id);
                assert.strictEqual(result.capturedContext.type, activeContext.type);
            }
        });

        test('should return sent:true on success', async () => {
            createService();
            const result = await service.sendMessage({ text: 'Hello', isNoAiEnabled: false });
            assert.deepStrictEqual(result, { sent: true });
            assert.ok(mockApiService.sendChatMessage.calledOnce);
        });
    });

    suite('Feature Toggle', () => {
        test('should not collect files when disabled — API still receives undefined', async () => {
            configGetStub.withArgs('sendUncommittedChanges', true).returns(false);
            createService();

            await sendHello();

            assert.ok(checkWorkspaceFilesStub.notCalled);
            assert.ok(mockApiService.sendChatMessage.calledOnce);
            assert.strictEqual(mockApiService.sendChatMessage.firstCall.args[2], undefined);
        });

        test('should throw when API service not available', async () => {
            createService(undefined);

            await assert.rejects(
                () => service.sendMessage({ text: 'Hello', isNoAiEnabled: false }),
                /Artemis API service not available/
            );
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

            await sendHello();

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

            await sendHello();

            const filesArg = mockApiService.sendChatMessage.firstCall.args[2] as Map<string, string>;
            assert.strictEqual(filesArg.size, 0);
        });
    });

    suite('Webview Update Message', () => {
        test('should post UpdateReferencedFiles with correct payload when files found', async () => {
            createService();

            await sendHello();

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

            await sendHello();

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

            await sendHello();

            const updateCall = postMessageSpy.getCalls().find(
                (c: sinon.SinonSpyCall) => c.args[0]?.type === 'updateReferencedFiles'
            );
            assert.ok(updateCall);
            assert.strictEqual(updateCall.args[0].excludedFiles[0].reason, 'Excluded');
        });

        test('should post updateReferencedFiles without a preceding user addMessage', async () => {
            createService();

            await sendHello();

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
        test('should continue without files on file collection error', async () => {
            checkWorkspaceFilesStub.rejects(new Error('Git command failed'));
            createService();

            await sendHello();

            // Service logs error but continues — no toast (provider handles UI)
            assert.ok(mockApiService.sendChatMessage.calledOnce);
            assert.strictEqual(mockApiService.sendChatMessage.firstCall.args[2], undefined);
        });

        test('should still send message to API with undefined files on error', async () => {
            checkWorkspaceFilesStub.rejects(new Error('crash'));
            createService();

            await sendHello();

            assert.ok(mockApiService.sendChatMessage.calledOnce);
            assert.strictEqual(mockApiService.sendChatMessage.firstCall.args[2], undefined);
        });
    });

    suite('Run-generation lifecycle', () => {
        test('aborts this send\'s generation when the POST throws', async () => {
            // The generation is opened before the send; a failing POST must
            // abort exactly it so the composer is released.
            const lifecycle = { beginGeneration: sandbox.stub().returns(7), abortGeneration: sandbox.stub() };
            createService(mockApiService as unknown as ArtemisApiService, { lifecycle });
            mockApiService.sendChatMessage.rejects(new Error('POST failed'));

            await assert.rejects(
                () => service.sendMessage({ text: 'Hello', isNoAiEnabled: false }),
                /POST failed/,
            );

            assert.ok(lifecycle.beginGeneration.calledOnce, 'generation must be opened');
            assert.ok(
                lifecycle.abortGeneration.calledOnceWithExactly(7),
                'abortGeneration must be called with this send\'s generation',
            );
        });

        test('aborts the generation when a pre-POST step throws (before the POST)', async () => {
            // The old plan missed this case: the generation is opened above the
            // preparation steps, so a throw in _ensureWebSocketConnection (here,
            // isConnected throwing) must still abort — the POST is never reached.
            const lifecycle = { beginGeneration: sandbox.stub().returns(7), abortGeneration: sandbox.stub() };
            const throwingWs = {
                isConnected: () => { throw new Error('ws down'); },
                connect: sandbox.stub().resolves(),
            };
            createService(mockApiService as unknown as ArtemisApiService, { websocketService: throwingWs, lifecycle });

            await assert.rejects(
                () => service.sendMessage({ text: 'Hello', isNoAiEnabled: false }),
                /ws down/,
            );

            assert.ok(
                lifecycle.abortGeneration.calledOnceWithExactly(7),
                'abortGeneration must fire even when the failure precedes the POST',
            );
            assert.ok(mockApiService.sendChatMessage.notCalled, 'the POST must never be reached');
        });
    });
});
