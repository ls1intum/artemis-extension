import * as assert from 'assert';
import * as sinon from 'sinon';

import { ArtemisApiService } from '@extension/api';
import { IrisChatSessionService } from '@extension/services/iris/chat/chatSessionService';
import { ContextStore } from '@extension/services/iris/context/contextStore';
import { IrisWebSocketSessionClient } from '@extension/services/iris/transport/irisWebSocketSessionClient';
import { ActiveContext } from '@extension/types';
import { MockExtensionContext } from '@test/unit/mocks/vscodeMocks';

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

            assert.ok(mockApiService.listChatSessionsForCourse.notCalled);
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

            mockApiService.listChatSessionsForCourse.resolves([
                { id: 1, entityId: 101, mode: 'COURSE_CHAT', creationDate: '2024-01-01T10:00:00Z' },
                { id: 2, entityId: 101, mode: 'COURSE_CHAT', creationDate: '2024-01-02T10:00:00Z' },
            ]);
            mockApiService.getChatMessages.withArgs(1).resolves([
                { id: 100, sender: 'USER', content: [{ textContent: 'Hello' }] },
            ]);
            mockApiService.getChatMessages.withArgs(2).resolves([
                { id: 200, sender: 'USER', content: [{ textContent: 'Hi there' }] },
            ]);

            // Stub initializeSession for the _loadIrisMessages call
            mockIrisWebSocketSessionClient.initializeSession.resolves(2);
            // Second call for hydration of the active session
            mockApiService.getChatMessages.withArgs(2).resolves([
                { id: 200, sender: 'USER', content: [{ textContent: 'Hi there' }] },
            ]);

            await chatSessionService.loadAllSessionsForContext();

            assert.ok(mockApiService.listChatSessionsForCourse.calledOnceWith(101));
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

            mockApiService.listChatSessionsForCourse.resolves([
                { id: 1, entityId: 123, mode: 'PROGRAMMING_EXERCISE_CHAT', creationDate: '2024-01-01T10:00:00Z' },
            ]);
            mockApiService.getChatMessages.withArgs(1).resolves([
                { id: 100, sender: 'USER', content: [{ textContent: 'Question' }] },
            ]);

            mockIrisWebSocketSessionClient.initializeSession.resolves(1);

            await chatSessionService.loadAllSessionsForContext();

            assert.ok(mockApiService.listChatSessionsForCourse.calledOnceWith(101));
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

            mockApiService.listChatSessionsForCourse.resolves([]);

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

            // Use non-empty sessions — empty ones are intentionally skipped
            // by importSessionsToStore (they would not contribute to the
            // session list, breaking the assertion below).
            mockApiService.listChatSessionsForCourse.resolves([
                { id: 1, entityId: 101, mode: 'COURSE_CHAT', creationDate: '2024-01-01T10:00:00Z' },
                { id: 2, entityId: 101, mode: 'COURSE_CHAT', creationDate: '2024-01-03T10:00:00Z' }, // Newest
                { id: 3, entityId: 101, mode: 'COURSE_CHAT', creationDate: '2024-01-02T10:00:00Z' },
            ]);
            mockApiService.getChatMessages.withArgs(1).resolves([
                { id: 10, sender: 'USER', content: [{ textContent: 'Q1' }] },
            ]);
            mockApiService.getChatMessages.withArgs(2).resolves([
                { id: 20, sender: 'USER', content: [{ textContent: 'Q2' }] },
            ]);
            mockApiService.getChatMessages.withArgs(3).resolves([
                { id: 30, sender: 'USER', content: [{ textContent: 'Q3' }] },
            ]);

            mockIrisWebSocketSessionClient.initializeSession.resolves(2);
            // Match the imported session's messageCount=1 so the stale
            // session-id cleanup branch in initializeIrisSessionAndLoadMessages
            // does not strip the active session's artemisSessionId.
            mockApiService.getChatMessages.withArgs(2).resolves([
                { id: 20, sender: 'USER', content: [{ textContent: 'Q2' }], sentAt: '2024-01-03T10:00:00Z' } as never
            ]);

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

            mockApiService.listChatSessionsForCourse.callsFake(async () => {
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

            mockApiService.listChatSessionsForCourse.rejects(new Error('API Error'));

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

            // Non-empty server session — empty ones are skipped by
            // importSessionsToStore, which would defeat the assertion that
            // the API session ends up in the store.
            mockApiService.listChatSessionsForCourse.resolves([
                { id: 1, entityId: 101, mode: 'COURSE_CHAT', creationDate: '2024-01-01T10:00:00Z' },
            ]);
            mockApiService.getChatMessages.withArgs(1).resolves([
                { id: 100, sender: 'USER', content: [{ textContent: 'Hi' }] },
            ]);

            mockIrisWebSocketSessionClient.initializeSession.resolves(1);
            // Return a message matching the imported session so the stale
            // cleanup branch does not strip the artemisSessionId.
            mockApiService.getChatMessages.withArgs(1).resolves([
                { id: 100, sender: 'USER', content: [{ textContent: 'Hi' }], sentAt: '2024-01-01T10:00:00Z' } as never
            ]);

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

            mockApiService.listChatSessionsForCourse.resolves([]);
            mockIrisWebSocketSessionClient.createNewSession.resolves(42);

            await chatSessionService.loadAllSessionsForContext();

            assert.ok(postMessageSpy.calledWith(
                sinon.match({ type: 'hideDisabledState' })
            ));
        });

        test('posts snapshot before LoadMessages so webview accepts the imported-session payload', async () => {
            // Reproduces the cold-start race the empty-state-flash fix
            // addresses: without an interim postSnapshot, the webview's
            // activeSessionId is still null/stale when LoadMessages arrives
            // and the localSessionId guard discards the payload.
            const context: ActiveContext = {
                type: 'course',
                id: 101,
                title: 'Test Course',
                source: 'user-selected',
                locked: false,
                selectedAt: Date.now()
            };
            contextStore.setActiveContext(context);

            mockApiService.getIrisCourseChatSettings.resolves({ settings: { enabled: true } });
            mockApiService.listChatSessionsForCourse.resolves([
                { id: 7, entityId: 101, mode: 'COURSE_CHAT', creationDate: '2024-02-01T10:00:00Z' },
            ]);
            // First call: import phase (in fetchSessionsWithMessages)
            // Second call: hydration phase (in initializeIrisSessionAndLoadMessages)
            mockApiService.getChatMessages.withArgs(7).resolves([
                { id: 70, sender: 'USER', content: [{ textContent: 'Hello' }] },
            ]);
            mockIrisWebSocketSessionClient.initializeSession.resolves(7);

            await chatSessionService.loadAllSessionsForContext();

            // Find LoadMessages call and the snapshot calls; assert at
            // least one snapshot landed before LoadMessages.
            const loadMessagesCall = postMessageSpy.getCalls().find(
                c => c.args[0]?.type === 'loadMessages'
            );
            assert.ok(loadMessagesCall, 'Should emit loadMessages');

            const snapshotBeforeLoad = onPostSnapshotSpy.getCalls().some(
                snap => snap.calledBefore(loadMessagesCall)
            );
            assert.ok(snapshotBeforeLoad,
                'postSnapshot must fire before LoadMessages so the webview has the new local session UUID');

            // Pin the bug shape: LoadMessages must be tagged with the
            // local session id that became active. A future refactor that
            // emits an unrelated earlier snapshot but skips the
            // imported-session snapshot would still satisfy the looser
            // ordering check above; this one would not.
            const activeSession = contextStore.snapshot().activeSession;
            assert.ok(activeSession, 'An active session should exist after loading');
            assert.strictEqual(
                (loadMessagesCall.args[0] as { localSessionId: string }).localSessionId,
                activeSession.id,
                'LoadMessages must carry the local session id that ended up active after import',
            );
        });

        test('falls back to createNewSession when all server sessions are empty', async () => {
            // importSessionsToStore returns the actually-imported count,
            // not sessions.length. With all empty server sessions, count
            // is 0, so loadAllSessionsForContext must fall back to
            // createNewSession instead of leaving the store empty.
            const context: ActiveContext = {
                type: 'course',
                id: 101,
                title: 'Test Course',
                source: 'user-selected',
                locked: false,
                selectedAt: Date.now()
            };
            contextStore.setActiveContext(context);

            mockApiService.getIrisCourseChatSettings.resolves({ settings: { enabled: true } });
            mockApiService.listChatSessionsForCourse.resolves([
                { id: 1, entityId: 101, mode: 'COURSE_CHAT', creationDate: '2024-01-01T10:00:00Z' },
                { id: 2, entityId: 101, mode: 'COURSE_CHAT', creationDate: '2024-01-02T10:00:00Z' },
            ]);
            // Both sessions return empty messages — import phase yields [], skipped by importSessionsToStore
            mockApiService.getChatMessages.withArgs(1).resolves([]);
            mockApiService.getChatMessages.withArgs(2).resolves([]);
            mockIrisWebSocketSessionClient.createNewSession.resolves(99);

            await chatSessionService.loadAllSessionsForContext();

            // Fallback path: createNewSession → resetSession.
            assert.ok(mockIrisWebSocketSessionClient.resetSession.called,
                'Should fall back to createNewSession when no real sessions imported');

            // Server sessions skipped, exactly one fresh session in store.
            const snapshot = contextStore.snapshot();
            const importedFromServer = snapshot.sessions.filter(
                s => s.artemisSessionId === 1 || s.artemisSessionId === 2
            );
            assert.strictEqual(importedFromServer.length, 0,
                'Empty server sessions must not be imported');
        });

        test('imports only non-empty sessions from a mixed payload', async () => {
            const context: ActiveContext = {
                type: 'course',
                id: 101,
                title: 'Test Course',
                source: 'user-selected',
                locked: false,
                selectedAt: Date.now()
            };
            contextStore.setActiveContext(context);

            mockApiService.getIrisCourseChatSettings.resolves({ settings: { enabled: true } });
            mockApiService.listChatSessionsForCourse.resolves([
                { id: 1, entityId: 101, mode: 'COURSE_CHAT', creationDate: '2024-01-01T10:00:00Z' },
                { id: 2, entityId: 101, mode: 'COURSE_CHAT', creationDate: '2024-01-02T10:00:00Z' },
                { id: 3, entityId: 101, mode: 'COURSE_CHAT', creationDate: '2024-01-03T10:00:00Z' },
            ]);
            mockApiService.getChatMessages.withArgs(1).resolves([
                { id: 10, sender: 'USER', content: [{ textContent: 'A' }] },
            ]);
            mockApiService.getChatMessages.withArgs(2).resolves([]);
            mockApiService.getChatMessages.withArgs(3).resolves([
                { id: 30, sender: 'USER', content: [{ textContent: 'B' }] },
            ]);
            mockIrisWebSocketSessionClient.initializeSession.resolves(3);
            // Match the active (newest, id=3) session's content to keep its
            // artemisSessionId mapping after hydration.
            mockApiService.getChatMessages.withArgs(3).resolves([
                { id: 30, sender: 'USER', content: [{ textContent: 'B' }], sentAt: '2024-01-03T10:00:00Z' } as never
            ]);

            await chatSessionService.loadAllSessionsForContext();

            const snapshot = contextStore.snapshot();
            const fromServer = snapshot.sessions.filter(
                s => s.artemisSessionId === 1 || s.artemisSessionId === 2 || s.artemisSessionId === 3
            );
            assert.strictEqual(fromServer.length, 2, 'Only non-empty sessions imported');
            assert.ok(fromServer.find(s => s.artemisSessionId === 1));
            assert.ok(!fromServer.find(s => s.artemisSessionId === 2),
                'Empty session #2 must not be imported');
            assert.ok(fromServer.find(s => s.artemisSessionId === 3));
        });

        test('emits LoadMessagesError after posting snapshot so the webview accepts the error', async () => {
            // Same race shape as the LoadMessages success path: if the
            // snapshot does not arrive first, the webview discards the
            // error too (the localSessionId guard at IrisChatView line
            // 116 rejects mismatches).
            const context: ActiveContext = {
                type: 'course',
                id: 101,
                title: 'Test Course',
                source: 'user-selected',
                locked: false,
                selectedAt: Date.now()
            };
            contextStore.setActiveContext(context);

            mockApiService.getIrisCourseChatSettings.resolves({ settings: { enabled: true } });
            mockApiService.listChatSessionsForCourse.resolves([
                { id: 5, entityId: 101, mode: 'COURSE_CHAT', creationDate: '2024-01-05T10:00:00Z' },
            ]);
            // Pattern D: first call satisfies import phase so session gets imported;
            // second call is the active-session hydration in initializeIrisSessionAndLoadMessages,
            // which is what this test is asserting against.
            const failingSessionFetch = mockApiService.getChatMessages.withArgs(5);
            failingSessionFetch.onFirstCall().resolves([
                { id: 50, sender: 'USER', content: [{ textContent: 'X' }] },
            ]);
            failingSessionFetch.onSecondCall().rejects(new Error('Server error during hydration'));
            mockIrisWebSocketSessionClient.initializeSession.resolves(5);

            await chatSessionService.loadAllSessionsForContext();

            const errorCall = postMessageSpy.getCalls().find(
                c => c.args[0]?.type === 'loadMessagesError'
            );
            assert.ok(errorCall, 'Should emit loadMessagesError when hydration fails');

            const snapshotBeforeError = onPostSnapshotSpy.getCalls().some(
                snap => snap.calledBefore(errorCall)
            );
            assert.ok(snapshotBeforeError,
                'postSnapshot must fire before LoadMessagesError so the webview shows the error UI for the imported session');

            // Same strictness as the success path: the error must be
            // tagged with the local session id that became active.
            const activeSession = contextStore.snapshot().activeSession;
            assert.ok(activeSession, 'An active session should exist even if hydration failed');
            assert.strictEqual(
                (errorCall.args[0] as { localSessionId: string }).localSessionId,
                activeSession.id,
                'LoadMessagesError must carry the local session id that ended up active after import',
            );
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

        test('does not attach the new artemis id to a different session if the user switched mid-flight', async () => {
            const context: ActiveContext = {
                type: 'course',
                id: 101,
                title: 'Test Course',
                source: 'user-selected',
                locked: false,
                selectedAt: Date.now()
            };
            contextStore.setActiveContext(context);

            // Pre-existing session B with its own artemis id we must not clobber.
            // Bump messageCount so cleanupEmptySessions (called inside switchSession)
            // does not prune B before we can switch back to it.
            contextStore.createSession();
            contextStore.incrementActiveSessionMessageCount();
            const initialSnapshot = contextStore.snapshot();
            const sessionBId = initialSnapshot.sessions[0].id;
            contextStore.setArtemisSessionId(7); // B has artemisSessionId=7

            // Make the server-create promise resolve later so we can switch first.
            let resolveCreate: (id: number) => void = () => { /* noop */ };
            mockIrisWebSocketSessionClient.createNewSession.callsFake(
                () => new Promise<number>(resolve => { resolveCreate = resolve; }),
            );

            // Trigger new-session creation — this becomes session N (active).
            chatSessionService.createNewSession();
            const afterCreateSnapshot = contextStore.snapshot();
            const sessionNId = afterCreateSnapshot.activeSession!.id;
            assert.notStrictEqual(sessionNId, sessionBId, 'precondition: N and B are distinct sessions');

            // User switches back to B before server responds.
            contextStore.switchSession(sessionBId);
            assert.strictEqual(contextStore.snapshot().activeSession?.id, sessionBId);

            // Now N's create resolves with artemisSessionId 99.
            resolveCreate(99);
            await new Promise(resolve => setTimeout(resolve, 10));

            // B must still have its original artemisSessionId, not N's 99.
            const finalSnapshot = contextStore.snapshot();
            const sessionB = finalSnapshot.sessions.find(s => s.id === sessionBId);
            assert.strictEqual(sessionB?.artemisSessionId, 7,
                'session B must keep its own artemisSessionId (7); the late create response for N must not clobber it');
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

            mockApiService.listChatSessionsForCourse.resolves([
                { id: 1, entityId: 101, mode: 'COURSE_CHAT', creationDate: '2024-01-01T10:00:00Z' },
            ]);
            mockApiService.getChatMessages.withArgs(1).resolves([
                { id: 100, sender: 'USER', content: [{ textContent: 'Hi' }] },
            ]);

            mockIrisWebSocketSessionClient.initializeSession.resolves(1);

            const count = await chatSessionService.resetAndReloadSessions();

            assert.strictEqual(count, 1);
            // Must post snapshot so UI reflects reloaded sessions
            assert.ok(onPostSnapshotSpy.called, 'Should post snapshot after reload');
            const snapshot = contextStore.snapshot();
            assert.strictEqual(snapshot.sessions.length, 1, 'Should have 1 reloaded session');
        });

        // The snapshot-before-LoadMessages ordering invariant lives with the
        // cold-start test in the loadAllSessionsForContext suite — both
        // paths share _fetchImportAndActivate, so duplicating the assertion
        // here is just coupling without value.

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

            mockApiService.listChatSessionsForCourse.resolves([]);
            mockIrisWebSocketSessionClient.createNewSession.resolves(99);

            await chatSessionService.resetAndReloadSessions();

            // _clearAllSessions should call resetSession to avoid stale session IDs
            // (the no-server-sessions fallback also calls createNewSession,
            // which itself calls resetSession — so the spy fires twice).
            assert.ok(mockIrisWebSocketSessionClient.resetSession.called, 'Should reset session during clear');
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

            mockApiService.listChatSessionsForCourse.resolves([]);
            mockIrisWebSocketSessionClient.createNewSession.resolves(99);

            const count = await chatSessionService.resetAndReloadSessions();

            assert.strictEqual(count, 0);
        });

        test('falls back to createNewSession when reload finds zero server sessions', async () => {
            // After the hydration predicate change in IrisChatView, leaving
            // the user with "context set + activeSessionId === null" parks
            // the chat on the loading state forever. The fallback ensures
            // they always land on a usable empty session.
            const context: ActiveContext = {
                type: 'course',
                id: 101,
                title: 'Test Course',
                source: 'user-selected',
                locked: false,
                selectedAt: Date.now()
            };
            contextStore.setActiveContext(context);

            mockApiService.listChatSessionsForCourse.resolves([]);
            mockIrisWebSocketSessionClient.createNewSession.resolves(99);

            await chatSessionService.resetAndReloadSessions();

            const snapshot = contextStore.snapshot();
            assert.ok(snapshot.activeSession,
                'Should have an active session after reset+reload with empty server payload');
            assert.strictEqual(snapshot.activeSession?.messageCount, 0,
                'Fallback session should be a fresh empty session');
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

            mockApiService.listChatSessionsForCourse.rejects(new Error('Server down'));

            await assert.rejects(
                () => chatSessionService.resetAndReloadSessions(),
                /Server down/
            );
        });
    });
});
