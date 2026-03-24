import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { IrisChatSessionService } from '../../../src/extension/services/iris/chatSessionService';
import { ContextStore } from '../../../src/extension/services/iris/contextStore';
import { ArtemisApiService } from '../../../src/extension/api';
import { IrisWebSocketSessionClient } from '../../../src/extension/services/iris/irisWebSocketSessionClient';
import { ActiveContext } from '../../../src/extension/types';
import { MockExtensionContext } from '../mocks/vscodeMocks';

suite('IrisChatSessionService Test Suite', () => {
    let chatSessionService: IrisChatSessionService;
    let contextStore: ContextStore;
    let mockApiService: sinon.SinonStubbedInstance<ArtemisApiService>;
    let mockIrisWebSocketSessionClient: sinon.SinonStubbedInstance<IrisWebSocketSessionClient>;
    let postMessageSpy: sinon.SinonSpy;
    let onPostSnapshotSpy: sinon.SinonSpy;
    // resetToWorkspaceSpy removed — workspace redirect moved to provider
    let mockContext: MockExtensionContext;

    setup(() => {
        mockContext = new MockExtensionContext();
        contextStore = new ContextStore(mockContext);

        // Create stubbed API service
        mockApiService = sinon.createStubInstance(ArtemisApiService);

        // Mock Iris profile check (required for all Iris settings checks)
        mockApiService.getProfileInfo.resolves({ activeProfiles: [], activeModuleFeatures: ['iris'] });
        mockApiService.isIrisProfileActive.returns(true);

        // Create stubbed IrisWebSocketSessionClient
        mockIrisWebSocketSessionClient = sinon.createStubInstance(IrisWebSocketSessionClient);

        // Create spies for callbacks
        postMessageSpy = sinon.spy();
        onPostSnapshotSpy = sinon.spy();
        chatSessionService = new IrisChatSessionService(
            {
                contextStore,
                artemisApiService: mockApiService as any,
                postMessage: postMessageSpy,
                postSnapshot: onPostSnapshotSpy,
            },
            () => mockIrisWebSocketSessionClient as any,
        );
    });

    teardown(() => {
        sinon.restore();
    });

    suite('Load Token Management', () => {
        test('should start with load token 0', () => {
            assert.strictEqual(chatSessionService.contextLoadToken, 0);
        });

        test('should increment load token', () => {
            const token1 = chatSessionService.incrementLoadToken();
            assert.strictEqual(token1, 1);
            assert.strictEqual(chatSessionService.contextLoadToken, 1);

            const token2 = chatSessionService.incrementLoadToken();
            assert.strictEqual(token2, 2);
            assert.strictEqual(chatSessionService.contextLoadToken, 2);
        });

        test('should check if context is current', () => {
            const context: ActiveContext = {
                type: 'exercise',
                id: 123,
                title: 'Test Exercise',
                source: 'user-selected',
                locked: false,
                selectedAt: Date.now()
            };

            contextStore.setActiveContext(context);
            const token = chatSessionService.incrementLoadToken();

            assert.strictEqual(chatSessionService.isCurrentContext(context, token), true);
        });

        test('should return false for outdated token', () => {
            const context: ActiveContext = {
                type: 'exercise',
                id: 123,
                title: 'Test Exercise',
                source: 'user-selected',
                locked: false,
                selectedAt: Date.now()
            };

            contextStore.setActiveContext(context);
            const oldToken = chatSessionService.incrementLoadToken();
            chatSessionService.incrementLoadToken(); // Advance token

            assert.strictEqual(chatSessionService.isCurrentContext(context, oldToken), false);
        });

        test('should return false for different context', () => {
            const context1: ActiveContext = {
                type: 'exercise',
                id: 123,
                title: 'Test Exercise',
                source: 'user-selected',
                locked: false,
                selectedAt: Date.now()
            };

            const context2: ActiveContext = {
                type: 'exercise',
                id: 456,
                title: 'Other Exercise',
                source: 'user-selected',
                locked: false,
                selectedAt: Date.now()
            };

            contextStore.setActiveContext(context1);
            const token = chatSessionService.incrementLoadToken();

            assert.strictEqual(chatSessionService.isCurrentContext(context2, token), false);
        });

        test('should return false when no active context', () => {
            const context: ActiveContext = {
                type: 'exercise',
                id: 123,
                title: 'Test Exercise',
                source: 'user-selected',
                locked: false,
                selectedAt: Date.now()
            };

            const token = chatSessionService.incrementLoadToken();

            assert.strictEqual(chatSessionService.isCurrentContext(context, token), false);
        });
    });

    suite('Iris Settings Check', () => {
        test('should return false when API service is not available', async () => {
            const serviceWithoutApi = new IrisChatSessionService(
                {
                    contextStore,
                    artemisApiService: undefined,
                    postMessage: postMessageSpy,
                    postSnapshot: onPostSnapshotSpy,
                },
                () => mockIrisWebSocketSessionClient as any,
            );

            const context: ActiveContext = {
                type: 'course',
                id: 101,
                title: 'Test Course',
                source: 'user-selected',
                locked: false,
                selectedAt: Date.now()
            };

            const result = await serviceWithoutApi.checkAndLoadIrisSettings(context);
            assert.strictEqual(result, false);
        });

        test('should check Iris settings for course context', async () => {
            const context: ActiveContext = {
                type: 'course',
                id: 101,
                title: 'Test Course',
                source: 'user-selected',
                locked: false,
                selectedAt: Date.now()
            };

            mockApiService.getIrisCourseChatSettings.resolves({
                settings: { enabled: true },
                effectiveRateLimit: { requests: 10, timeframeHours: 1 }
            });

            const result = await chatSessionService.checkAndLoadIrisSettings(context);

            assert.strictEqual(result, true);
            assert.ok(mockApiService.getIrisCourseChatSettings.calledOnceWith(101));
        });

        test('should return false when Iris is disabled', async () => {
            const context: ActiveContext = {
                type: 'course',
                id: 101,
                title: 'Test Course',
                source: 'user-selected',
                locked: false,
                selectedAt: Date.now()
            };

            mockApiService.getIrisCourseChatSettings.resolves({
                settings: { enabled: false }
            });

            const result = await chatSessionService.checkAndLoadIrisSettings(context);
            assert.strictEqual(result, false);
        });

        test('should check Iris settings for exercise context with courseId', async () => {
            const context: ActiveContext = {
                type: 'exercise',
                id: 123,
                title: 'Test Exercise',
                courseId: 101,
                source: 'user-selected',
                locked: false,
                selectedAt: Date.now()
            };

            mockApiService.getIrisCourseChatSettings.resolves({
                settings: { enabled: true }
            });

            const result = await chatSessionService.checkAndLoadIrisSettings(context);

            assert.strictEqual(result, true);
            assert.ok(mockApiService.getIrisCourseChatSettings.calledOnceWith(101));
        });

        test('should resolve courseId from tracked exercise', async () => {
            const context: ActiveContext = {
                type: 'exercise',
                id: 123,
                title: 'Test Exercise',
                source: 'user-selected',
                locked: false,
                selectedAt: Date.now()
            };

            contextStore.registerExercise({
                id: 123,
                title: 'Test Exercise',
                courseId: 101
            });

            mockApiService.getIrisCourseChatSettings.resolves({
                settings: { enabled: true }
            });

            const result = await chatSessionService.checkAndLoadIrisSettings(context);

            assert.strictEqual(result, true);
            assert.ok(mockApiService.getIrisCourseChatSettings.calledWith(101));
        });

        test('should resolve courseId from exercise details API', async () => {
            const context: ActiveContext = {
                type: 'exercise',
                id: 123,
                title: 'Test Exercise',
                source: 'user-selected',
                locked: false,
                selectedAt: Date.now()
            };

            mockApiService.getExerciseDetails.resolves({
                exercise: {
                    id: 123,
                    title: 'Test Exercise',
                    course: { id: 101, title: 'Test Course' }
                }
            });

            mockApiService.getIrisCourseChatSettings.resolves({
                settings: { enabled: true }
            });

            const result = await chatSessionService.checkAndLoadIrisSettings(context);

            assert.strictEqual(result, true);
            assert.ok(mockApiService.getExerciseDetails.calledOnceWith(123));
            assert.ok(mockApiService.getIrisCourseChatSettings.calledWith(101));
        });

        test('should return false when courseId cannot be resolved for exercise', async () => {
            const context: ActiveContext = {
                type: 'exercise',
                id: 123,
                title: 'Test Exercise',
                source: 'user-selected',
                locked: false,
                selectedAt: Date.now()
            };

            mockApiService.getExerciseDetails.resolves({
                exercise: { id: 123, title: 'Test Exercise' }
            });

            const result = await chatSessionService.checkAndLoadIrisSettings(context);
            assert.strictEqual(result, false);
        });

        test('should return false for unsupported context type', async () => {
            const context: ActiveContext = {
                type: 'lecture' as any,
                id: 999,
                title: 'Test Lecture',
                source: 'user-selected',
                locked: false,
                selectedAt: Date.now()
            };

            const result = await chatSessionService.checkAndLoadIrisSettings(context);
            assert.strictEqual(result, false);
        });

        test('should return false on 403 error', async () => {
            const context: ActiveContext = {
                type: 'course',
                id: 101,
                title: 'Test Course',
                source: 'user-selected',
                locked: false,
                selectedAt: Date.now()
            };

            const error: any = new Error('Forbidden');
            error.status = 403;
            mockApiService.getIrisCourseChatSettings.rejects(error);

            const result = await chatSessionService.checkAndLoadIrisSettings(context);
            assert.strictEqual(result, false);
        });

        test('should return false on other errors', async () => {
            const context: ActiveContext = {
                type: 'course',
                id: 101,
                title: 'Test Course',
                source: 'user-selected',
                locked: false,
                selectedAt: Date.now()
            };

            mockApiService.getIrisCourseChatSettings.rejects(new Error('Network error'));

            const result = await chatSessionService.checkAndLoadIrisSettings(context);
            assert.strictEqual(result, false);
        });
    });

    suite('Load All Sessions For Context', () => {
        test('should not load sessions when no active context', async () => {
            await chatSessionService.loadAllSessionsForContext();

            assert.ok(mockApiService.getCourseChatSessions.notCalled);
            assert.ok(mockApiService.getExerciseChatSessions.notCalled);
        });

        test('should not load sessions when API service is not available', async () => {
            const serviceWithoutApi = new IrisChatSessionService(
                {
                    contextStore,
                    artemisApiService: undefined,
                    postMessage: postMessageSpy,
                    postSnapshot: onPostSnapshotSpy,
                },
                () => mockIrisWebSocketSessionClient as any,
            );

            const context: ActiveContext = {
                type: 'course',
                id: 101,
                title: 'Test Course',
                source: 'user-selected',
                locked: false,
                selectedAt: Date.now()
            };

            contextStore.setActiveContext(context);

            await serviceWithoutApi.loadAllSessionsForContext();

            assert.ok(postMessageSpy.notCalled);
        });

        test('should show disabled state when Iris is not enabled', async () => {
            const context: ActiveContext = {
                type: 'course',
                id: 101,
                title: 'Test Course',
                source: 'user-selected',
                locked: false,
                selectedAt: Date.now()
            };

            contextStore.setActiveContext(context);

            mockApiService.getIrisCourseChatSettings.resolves({
                settings: { enabled: false }
            });

            await chatSessionService.loadAllSessionsForContext();

            assert.ok(postMessageSpy.calledWith(
                sinon.match({ type: 'clearChatMessages' })
            ));
            assert.ok(postMessageSpy.calledWith(
                sinon.match({ type: 'showDisabledState' })
            ));
        });

        test('should load course sessions successfully', async () => {
            const context: ActiveContext = {
                type: 'course',
                id: 101,
                title: 'Test Course',
                source: 'user-selected',
                locked: false,
                selectedAt: Date.now()
            };

            contextStore.setActiveContext(context);

            mockApiService.getIrisCourseChatSettings.resolves({
                settings: { enabled: true }
            });

            mockApiService.getCourseChatSessionsWithMessages.resolves([
                { id: 1, creationDate: '2024-01-01T10:00:00Z', messages: [{ sender: 'USER', content: [{ textContent: 'Hello' }] }] },
                { id: 2, creationDate: '2024-01-02T10:00:00Z', messages: [{ sender: 'USER', content: [{ textContent: 'Hi there' }] }] }
            ]);

            // Stub initializeSession for the _loadIrisMessages call
            mockIrisWebSocketSessionClient.initializeSession.resolves(1);
            mockApiService.getChatMessages.resolves([]);

            await chatSessionService.loadAllSessionsForContext();

            assert.ok(mockApiService.getCourseChatSessionsWithMessages.calledOnceWith(101));
            assert.ok(onPostSnapshotSpy.called);

            const snapshot = contextStore.snapshot();
            assert.strictEqual(snapshot.sessions.length, 2);
        });

        test('should load exercise sessions successfully', async () => {
            const context: ActiveContext = {
                type: 'exercise',
                id: 123,
                title: 'Test Exercise',
                courseId: 101,
                source: 'user-selected',
                locked: false,
                selectedAt: Date.now()
            };

            contextStore.setActiveContext(context);

            mockApiService.getIrisCourseChatSettings.resolves({
                settings: { enabled: true }
            });

            mockApiService.getExerciseChatSessionsWithMessages.resolves([
                { id: 1, creationDate: '2024-01-01T10:00:00Z', messages: [{ sender: 'USER', content: [{ textContent: 'Question' }] }] }
            ]);

            mockIrisWebSocketSessionClient.initializeSession.resolves(1);
            mockApiService.getChatMessages.resolves([]);

            await chatSessionService.loadAllSessionsForContext();

            assert.ok(mockApiService.getExerciseChatSessionsWithMessages.calledOnceWith(123));
        });

        test('should create new session when no sessions exist', async () => {
            const context: ActiveContext = {
                type: 'course',
                id: 101,
                title: 'Test Course',
                source: 'user-selected',
                locked: false,
                selectedAt: Date.now()
            };

            contextStore.setActiveContext(context);

            mockApiService.getIrisCourseChatSettings.resolves({
                settings: { enabled: true }
            });

            mockApiService.getCourseChatSessionsWithMessages.resolves([]);

            // Stub createNewSession for the fallback
            mockIrisWebSocketSessionClient.createNewSession.resolves(42);

            await chatSessionService.loadAllSessionsForContext();

            // Should have called resetSession (via createNewSession)
            assert.ok(mockIrisWebSocketSessionClient.resetSession.calledOnce);
            assert.ok(onPostSnapshotSpy.called);

            const snapshot = contextStore.snapshot();
            assert.strictEqual(snapshot.sessions.length, 1);
        });

        test('should sort sessions by creation date (newest first)', async () => {
            const context: ActiveContext = {
                type: 'course',
                id: 101,
                title: 'Test Course',
                source: 'user-selected',
                locked: false,
                selectedAt: Date.now()
            };

            contextStore.setActiveContext(context);

            mockApiService.getIrisCourseChatSettings.resolves({
                settings: { enabled: true }
            });

            mockApiService.getCourseChatSessionsWithMessages.resolves([
                { id: 1, creationDate: '2024-01-01T10:00:00Z', messages: [] },
                { id: 2, creationDate: '2024-01-03T10:00:00Z', messages: [] }, // Newest
                { id: 3, creationDate: '2024-01-02T10:00:00Z', messages: [] }
            ]);

            mockIrisWebSocketSessionClient.initializeSession.resolves(2);
            mockApiService.getChatMessages.resolves([]);

            await chatSessionService.loadAllSessionsForContext();

            const snapshot = contextStore.snapshot();
            assert.strictEqual(snapshot.sessions.length, 3);
            // Sessions are created in sorted order, so first in array is newest
            // artemisSessionId should be 2 (the newest)
            const sessionWithId2 = snapshot.sessions.find(s => s.artemisSessionId === 2);
            assert.ok(sessionWithId2, 'Should have session with artemisSessionId 2');
        });

        test('should abort loading if context changes during load', async () => {
            const context1: ActiveContext = {
                type: 'course',
                id: 101,
                title: 'Test Course',
                source: 'user-selected',
                locked: false,
                selectedAt: Date.now()
            };

            contextStore.setActiveContext(context1);

            mockApiService.getIrisCourseChatSettings.resolves({
                settings: { enabled: true }
            });

            mockApiService.getCourseChatSessionsWithMessages.callsFake(async () => {
                // Change context during loading
                const context2: ActiveContext = {
                    type: 'exercise',
                    id: 456,
                    title: 'Other Exercise',
                    courseId: 102,
                    source: 'user-selected',
                    locked: false,
                    selectedAt: Date.now()
                };
                contextStore.setActiveContext(context2);
                return [];
            });

            await chatSessionService.loadAllSessionsForContext();

            // Should not call createNewSession or resetSession if context changed
            assert.ok(mockIrisWebSocketSessionClient.resetSession.notCalled);
        });

        test('should handle errors and create fallback session', async () => {
            const context: ActiveContext = {
                type: 'course',
                id: 101,
                title: 'Test Course',
                source: 'user-selected',
                locked: false,
                selectedAt: Date.now()
            };

            contextStore.setActiveContext(context);

            mockApiService.getIrisCourseChatSettings.resolves({
                settings: { enabled: true }
            });

            mockApiService.getCourseChatSessionsWithMessages.rejects(new Error('API Error'));

            mockIrisWebSocketSessionClient.createNewSession.resolves(42);

            await chatSessionService.loadAllSessionsForContext();

            // Should create fallback session (via createNewSession -> resetSession)
            assert.ok(mockIrisWebSocketSessionClient.resetSession.calledOnce);
            assert.ok(onPostSnapshotSpy.called);
        });

        test('should clear existing sessions before loading fresh data', async () => {
            const context: ActiveContext = {
                type: 'course',
                id: 101,
                title: 'Test Course',
                source: 'user-selected',
                locked: false,
                selectedAt: Date.now()
            };

            contextStore.setActiveContext(context);

            // Create some existing sessions (beyond the one auto-created by setActiveContext)
            contextStore.createSession();
            contextStore.createSession();

            let snapshotBefore = contextStore.snapshot();
            // Should have 3 total (1 auto-created + 2 manual)
            assert.ok(snapshotBefore.sessions.length >= 2);

            mockApiService.getIrisCourseChatSettings.resolves({
                settings: { enabled: true }
            });

            mockApiService.getCourseChatSessionsWithMessages.resolves([
                { id: 1, creationDate: '2024-01-01T10:00:00Z', messages: [] }
            ]);

            mockIrisWebSocketSessionClient.initializeSession.resolves(1);
            mockApiService.getChatMessages.resolves([]);

            await chatSessionService.loadAllSessionsForContext();

            const snapshotAfter = contextStore.snapshot();
            // Should have the session from API (and potentially one auto-created session)
            const sessionFromApi = snapshotAfter.sessions.find(s => s.artemisSessionId === 1);
            assert.ok(sessionFromApi, 'Should have session from API');
            // Should not have more sessions than before clearing + new ones
            assert.ok(snapshotAfter.sessions.length <= 2, 'Should have cleared old sessions');
        });

        test('should hide disabled state when Iris is enabled', async () => {
            const context: ActiveContext = {
                type: 'course',
                id: 101,
                title: 'Test Course',
                source: 'user-selected',
                locked: false,
                selectedAt: Date.now()
            };

            contextStore.setActiveContext(context);

            mockApiService.getIrisCourseChatSettings.resolves({
                settings: { enabled: true }
            });

            mockApiService.getCourseChatSessionsWithMessages.resolves([]);
            mockIrisWebSocketSessionClient.createNewSession.resolves(42);

            await chatSessionService.loadAllSessionsForContext();

            assert.ok(postMessageSpy.calledWith(
                sinon.match({ type: 'hideDisabledState' })
            ));
        });
    });

    suite('createNewSession', () => {
        test('should reset session instead of just unsubscribing', () => {
            const context: ActiveContext = {
                type: 'course',
                id: 101,
                title: 'Test Course',
                source: 'user-selected',
                locked: false,
                selectedAt: Date.now()
            };
            contextStore.setActiveContext(context);

            mockIrisWebSocketSessionClient.createNewSession.resolves(42);

            chatSessionService.createNewSession();

            assert.ok(mockIrisWebSocketSessionClient.resetSession.calledOnce);
            assert.ok(postMessageSpy.calledWith(sinon.match({ type: 'clearChatMessages' })));
        });

        // Workspace redirect test removed — redirect logic moved to provider

        test('should create server session and store ID', async () => {
            const context: ActiveContext = {
                type: 'course',
                id: 101,
                title: 'Test Course',
                source: 'user-selected',
                locked: false,
                selectedAt: Date.now()
            };
            contextStore.setActiveContext(context);

            mockIrisWebSocketSessionClient.createNewSession.resolves(42);

            chatSessionService.createNewSession();

            // Wait for the async createNewSession promise
            await new Promise(resolve => setTimeout(resolve, 10));

            assert.ok(mockIrisWebSocketSessionClient.createNewSession.calledOnce);
        });
    });

    suite('switchToSession', () => {
        test('should reset session, switch, and load messages', async () => {
            const context: ActiveContext = {
                type: 'course',
                id: 101,
                title: 'Test Course',
                source: 'user-selected',
                locked: false,
                selectedAt: Date.now()
            };
            contextStore.setActiveContext(context);
            contextStore.createSession();
            const snapshot = contextStore.snapshot();
            const sessionId = snapshot.sessions[0].id;

            mockIrisWebSocketSessionClient.initializeSession.resolves(1);
            mockApiService.getChatMessages.resolves([]);

            chatSessionService.switchToSession(sessionId);

            assert.ok(mockIrisWebSocketSessionClient.resetSession.calledOnce);
            assert.ok(postMessageSpy.calledWith(sinon.match({ type: 'clearChatMessages' })));
        });
    });

    suite('resetAndReloadSessions', () => {
        test('should clear sessions and reload from Artemis', async () => {
            const context: ActiveContext = {
                type: 'course',
                id: 101,
                title: 'Test Course',
                source: 'user-selected',
                locked: false,
                selectedAt: Date.now()
            };
            contextStore.setActiveContext(context);

            mockApiService.getCourseChatSessionsWithMessages.resolves([
                { id: 1, creationDate: '2024-01-01T10:00:00Z', messages: [{ sender: 'USER', content: [{ textContent: 'Hi' }] }] }
            ]);

            mockIrisWebSocketSessionClient.initializeSession.resolves(1);
            mockApiService.getChatMessages.resolves([]);

            const count = await chatSessionService.resetAndReloadSessions();

            assert.strictEqual(count, 1);
            // Must post snapshot so UI reflects reloaded sessions
            assert.ok(onPostSnapshotSpy.called, 'Should post snapshot after reload');
            const snapshot = contextStore.snapshot();
            assert.strictEqual(snapshot.sessions.length, 1, 'Should have 1 reloaded session');
        });

        test('should call resetSession when clearing all sessions', async () => {
            const context: ActiveContext = {
                type: 'course',
                id: 101,
                title: 'Test Course',
                source: 'user-selected',
                locked: false,
                selectedAt: Date.now()
            };
            contextStore.setActiveContext(context);

            mockApiService.getCourseChatSessionsWithMessages.resolves([]);

            await chatSessionService.resetAndReloadSessions();

            // _clearAllSessions should call resetSession to avoid stale session IDs
            assert.ok(mockIrisWebSocketSessionClient.resetSession.calledOnce, 'Should reset session during clear');
        });

        test('should return 0 when no sessions found on server', async () => {
            const context: ActiveContext = {
                type: 'course',
                id: 101,
                title: 'Test Course',
                source: 'user-selected',
                locked: false,
                selectedAt: Date.now()
            };
            contextStore.setActiveContext(context);

            mockApiService.getCourseChatSessionsWithMessages.resolves([]);

            const count = await chatSessionService.resetAndReloadSessions();

            assert.strictEqual(count, 0);
        });

        test('should propagate error on API failure', async () => {
            const context: ActiveContext = {
                type: 'course',
                id: 101,
                title: 'Test Course',
                source: 'user-selected',
                locked: false,
                selectedAt: Date.now()
            };
            contextStore.setActiveContext(context);

            mockApiService.getCourseChatSessionsWithMessages.rejects(new Error('Server down'));

            await assert.rejects(
                () => chatSessionService.resetAndReloadSessions(),
                /Server down/
            );
        });
    });
});
