import * as vscode from 'vscode';
import * as assert from 'assert';
import * as sinon from 'sinon';

import type { ExtensionToWebviewMessage, WebviewToExtensionMessage } from '@shared/messageContracts';

import { ArtemisApiService } from '@extension/api';
import { AppStateManager } from '@extension/controller/appStateManager';
import { WebViewMessageHandler } from '@extension/controller/webViewMessageHandler';
import { AuthManager } from '@extension/services/auth';
import { MockExtensionContext } from '@test/unit/mocks/vscodeMocks';

class MockAuthManager extends AuthManager {
    constructor(context: vscode.ExtensionContext) {
        super(context);
    }
}

class MockArtemisApiService extends ArtemisApiService {
    constructor(authManager: AuthManager) {
        super(authManager);
    }
}

suite('WebViewMessageHandler - handleMessageWithSender', () => {
    let sandbox: sinon.SinonSandbox;
    let handler: WebViewMessageHandler;
    let mockContext: MockExtensionContext;
    let mockAuthManager: MockAuthManager;
    let mockApiService: MockArtemisApiService;
    let mockStateManager: AppStateManager;
    let actionHandler: {
        showDashboard: sinon.SinonStub;
        render: sinon.SinonStub;
        openJsonInEditor: sinon.SinonStub;
        showCourseList: sinon.SinonStub;
        showCourseDetail: sinon.SinonStub;
        showExerciseDetail: sinon.SinonStub;
        showAiConfig: sinon.SinonStub;
        showServiceStatus: sinon.SinonStub;
        showStruggleDetection: sinon.SinonStub;
        showRecommendedExtensions: sinon.SinonStub;
        showGitCredentials: sinon.SinonStub;
        openExerciseDetails: sinon.SinonStub;
        openExerciseFullscreen: sinon.SinonStub;
        openCourseFullscreen: sinon.SinonStub;
        openCourseListFullscreen: sinon.SinonStub;
        sendInitData: sinon.SinonStub;
        backgroundRenderProblemStatement: sinon.SinonStub;
        navigateBack: sinon.SinonStub;
        navigateToStartPage: sinon.SinonStub;
    };

    setup(() => {
        sandbox = sinon.createSandbox();

        // Stub vscode.window.showErrorMessage to prevent UI side effects
        sandbox.stub(vscode.window, 'showErrorMessage').resolves(undefined as any);

        // Stub vscode.window.showInformationMessage to prevent UI side effects
        sandbox.stub(vscode.window, 'showInformationMessage').resolves(undefined as any);

        // Stub vscode.commands.executeCommand to prevent side effects
        sandbox.stub(vscode.commands, 'executeCommand').resolves(undefined);

        mockContext = new MockExtensionContext();
        mockAuthManager = new MockAuthManager(mockContext);
        mockApiService = new MockArtemisApiService(mockAuthManager);
        mockStateManager = new AppStateManager();

        actionHandler = {
            showDashboard: sandbox.stub().resolves(),
            render: sandbox.stub().resolves(),
            openJsonInEditor: sandbox.stub().resolves(),
            showCourseList: sandbox.stub().resolves(),
            showCourseDetail: sandbox.stub().resolves(),
            showExerciseDetail: sandbox.stub().resolves(),
            showAiConfig: sandbox.stub(),
            showServiceStatus: sandbox.stub(),
            showStruggleDetection: sandbox.stub(),
            showRecommendedExtensions: sandbox.stub(),
            showGitCredentials: sandbox.stub(),
            openExerciseDetails: sandbox.stub().resolves(),
            openExerciseFullscreen: sandbox.stub().resolves(),
            openCourseFullscreen: sandbox.stub().resolves(),
            openCourseListFullscreen: sandbox.stub().resolves(),
            sendInitData: sandbox.stub(),
            backgroundRenderProblemStatement: sandbox.stub(),
            navigateBack: sandbox.stub().resolves(),
            navigateToStartPage: sandbox.stub().resolves(),
        };

        handler = new WebViewMessageHandler(
            mockAuthManager,
            mockApiService,
            mockStateManager,
            actionHandler,
            mockContext,
            {} as any,  // exerciseRegistry
            {} as any,  // providerRegistry
        );
    });

    teardown(() => {
        sandbox.restore();
    });

    suite('sender swap mechanism', () => {
        test('uses provided sender during call', async () => {
            // Inject a test handler that calls sendMessage
            const overrideSender = sandbox.stub();
            const originalSender = sandbox.stub();
            handler.setMessageSender(originalSender);

            // Inject a custom handler that captures which sender was active during the call
            let senderAtCallTime: ((msg: ExtensionToWebviewMessage) => void) | null = null;
            (handler as any).commandHandlers.set('testSenderCapture', async (_msg: WebviewToExtensionMessage) => {
                // Grab current _sendMessage and call it
                senderAtCallTime = (handler as any)._sendMessage;
                (handler as any)._sendMessage({ type: 'sendMessageInit' } as any);
            });

            await handler.handleMessageWithSender(
                { type: 'command', command: 'testSenderCapture' } as any,
                overrideSender
            );

            // The override sender should have been used during the call
            assert.ok(overrideSender.calledOnce, 'Override sender should be called once during handleMessageWithSender');
            assert.ok(!originalSender.called, 'Original sender should not be called during the override');
            assert.strictEqual(senderAtCallTime, overrideSender, 'The active sender during call should be the override sender');
        });

        test('restores original sender after call completes', async () => {
            const originalSender = sandbox.stub();
            const overrideSender = sandbox.stub();
            handler.setMessageSender(originalSender);

            // Inject a no-op handler
            (handler as any).commandHandlers.set('noop', async () => { });

            await handler.handleMessageWithSender(
                { type: 'command', command: 'noop' } as any,
                overrideSender
            );

            // After the call, _sendMessage should be restored to the original
            assert.strictEqual(
                (handler as any)._sendMessage,
                originalSender,
                'Original sender should be restored after handleMessageWithSender completes'
            );
        });

        test('serializes concurrent calls so senders do not interleave', async () => {
            const originalSender = sandbox.stub();
            const senderA = sandbox.stub();
            const senderB = sandbox.stub();
            handler.setMessageSender(originalSender);

            // Track which sender was active during each handler
            const activeSenders: string[] = [];
            let resolveA: () => void;
            const blockA = new Promise<void>(r => { resolveA = r; });

            (handler as any).commandHandlers.set('slowCmd', async () => {
                activeSenders.push((handler as any)._sendMessage === senderA ? 'A' : 'B');
                await blockA;
                activeSenders.push((handler as any)._sendMessage === senderA ? 'A' : 'B');
            });
            (handler as any).commandHandlers.set('fastCmd', async () => {
                activeSenders.push((handler as any)._sendMessage === senderB ? 'B' : 'A');
            });

            // Start both concurrently
            const promiseA = handler.handleMessageWithSender(
                { type: 'command', command: 'slowCmd' } as any,
                senderA
            );
            const promiseB = handler.handleMessageWithSender(
                { type: 'command', command: 'fastCmd' } as any,
                senderB
            );

            // Unblock A
            resolveA!();
            await Promise.all([promiseA, promiseB]);

            // A should run fully before B starts (serialized)
            assert.deepStrictEqual(activeSenders, ['A', 'A', 'B'],
                'Calls should be serialized: A runs to completion, then B');

            // Original sender restored
            assert.strictEqual(
                (handler as any)._sendMessage,
                originalSender,
                'Original sender should be restored after both calls'
            );
        });

        test('restores original sender even when handler throws', async () => {
            const originalSender = sandbox.stub();
            const overrideSender = sandbox.stub();
            handler.setMessageSender(originalSender);

            // Inject a failing handler
            (handler as any).commandHandlers.set('failCmd', async () => {
                throw new Error('test error');
            });

            // handleMessageWithSender -> handleMessage catches the error internally
            await handler.handleMessageWithSender(
                { type: 'command', command: 'failCmd' } as any,
                overrideSender
            );

            // After the call (error was swallowed by handleMessage), _sendMessage should be restored
            assert.strictEqual(
                (handler as any)._sendMessage,
                originalSender,
                'Original sender should be restored in finally block even when handler throws'
            );
        });
    });

    suite('command dispatch', () => {
        test('routes command-type messages via the command field', async () => {
            const routeHandlerStub = sandbox.stub().resolves();
            (handler as any).commandHandlers.set('testRoute', routeHandlerStub);

            await handler.handleMessageWithSender(
                { type: 'command', command: 'testRoute' } as any,
                sandbox.stub()
            );

            assert.ok(routeHandlerStub.calledOnce, 'Handler for testRoute should be called once');
        });

        test('routes non-command messages via the type field', async () => {
            const customTypeHandlerStub = sandbox.stub().resolves();
            (handler as any).commandHandlers.set('customType', customTypeHandlerStub);

            await handler.handleMessageWithSender(
                { type: 'customType' } as any,
                sandbox.stub()
            );

            assert.ok(customTypeHandlerStub.calledOnce, 'Handler for customType should be called once via type field');
        });

        test('unknown command does not crash — logs warning and returns gracefully', async () => {
            // This should not throw even though the command does not exist
            let threw = false;
            try {
                await handler.handleMessageWithSender(
                    { type: 'command', command: 'nonexistentCommand' } as any,
                    sandbox.stub()
                );
            } catch (e) {
                threw = true;
            }

            assert.strictEqual(threw, false, 'handleMessageWithSender should not throw for unknown commands');
        });
    });

    suite('reload error recovery', () => {
        test('reloadCourses calls sendInitData on error', async () => {
            const sender = sandbox.stub();
            sandbox.stub(mockApiService, 'getCoursesForDashboard').rejects(new Error('API failure'));

            await handler.handleMessageWithSender(
                { type: 'command', command: 'reloadCourses' } as any,
                sender
            );

            assert.ok(actionHandler.sendInitData.calledOnce,
                'sendInitData should be called in the catch block to reset loading state');
        });

        test('reloadDashboard calls sendInitData on error', async () => {
            const sender = sandbox.stub();
            // Set userInfo so the handler enters the if-branch
            (mockStateManager as any)._userInfo = { login: 'testuser', serverUrl: 'https://example.com' };
            actionHandler.showDashboard = sandbox.stub().rejects(new Error('API failure'));

            await handler.handleMessageWithSender(
                { type: 'command', command: 'reloadDashboard' } as any,
                sender
            );

            assert.ok(actionHandler.sendInitData.calledOnce,
                'sendInitData should be called in the catch block to reset loading state');
        });
    });

    suite('real command module integration', () => {
        test('registered handlers include representative commands from all 11 modules', () => {
            const registeredHandlers = (handler as any).commandHandlers as Map<string, unknown>;

            // Must have entries
            assert.ok(registeredHandlers.size > 0, 'Command handler map should not be empty');

            // Auth module commands
            assert.ok(registeredHandlers.has('login'), 'Should have "login" handler (AuthCommandModule)');
            assert.ok(registeredHandlers.has('logout'), 'Should have "logout" handler (AuthCommandModule)');

            // Navigation module commands
            assert.ok(registeredHandlers.has('showAllCourses'), 'Should have "showAllCourses" handler (NavigationCommandModule)');
            assert.ok(registeredHandlers.has('viewCourseDetails'), 'Should have "viewCourseDetails" handler (NavigationCommandModule)');

            // Repository module commands
            assert.ok(registeredHandlers.has('cloneRepository'), 'Should have "cloneRepository" handler (RepositoryCloneCommands)');
            assert.ok(registeredHandlers.has('submitExercise'), 'Should have "submitExercise" handler (RepositorySubmitCommands)');

            // Iris module commands
            assert.ok(registeredHandlers.has('askIrisAboutExercise'), 'Should have "askIrisAboutExercise" handler (IrisCommandModule)');
        });

        test('context.recheckRepoStatus is wired to the status module and routes setRepositoryContext through it', async () => {
            // The handler builds the context, constructs the status module, then assigns
            // context.recheckRepoStatus = () => statusModule.recheckCurrentRepoStatus().
            // We verify two things in one test:
            //   1. context.recheckRepoStatus is non-null (callback wired)
            //   2. Calling it actually reaches the status module (routes via setRepositoryContext)

            const statusModule = (handler as any).repositoryStatusModule;
            assert.ok(statusModule, 'WebViewMessageHandler should expose repositoryStatusModule');

            // Status module's handler must be registered in the command map
            // (catches the failure mode where the module is constructed but omitted from modules[]).
            const registeredHandlers = (handler as any).commandHandlers as Map<string, unknown>;
            assert.ok(registeredHandlers.has('checkRepositoryStatus'),
                'Should have "checkRepositoryStatus" handler (RepositoryStatusCommands)');

            // Grab the shared context that was passed to the status module on construction
            const sharedContext = (statusModule as any).context;
            assert.ok(sharedContext, 'Status module should have a stored context');
            assert.strictEqual(
                typeof sharedContext.recheckRepoStatus,
                'function',
                'context.recheckRepoStatus must be wired',
            );

            // Replace the status module's recheckCurrentRepoStatus with a spy to assert routing
            const recheckSpy = sandbox.stub().resolves();
            (statusModule as any).recheckCurrentRepoStatus = recheckSpy;

            // Invoke the wired callback as the submit shell would
            await sharedContext.recheckRepoStatus();

            sinon.assert.calledOnce(recheckSpy);

            // Sanity: setRepositoryContext on the handler reaches the same status module
            const setSpy = sandbox.stub();
            (statusModule as any).setRepositoryContext = setSpy;
            handler.setRepositoryContext('https://artemis.example.com/git/x.git', 7);
            sinon.assert.calledOnceWithExactly(setSpy, 'https://artemis.example.com/git/x.git', 7);
        });
    });
});
