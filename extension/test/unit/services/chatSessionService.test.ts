import * as assert from 'assert';
import * as sinon from 'sinon';

import { ArtemisApiService } from '@extension/api';
import { ApiError, MalformedResponseError } from '@extension/domain/errors';
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
    let resetRunsSpy: sinon.SinonSpy;
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
        resetRunsSpy = sinon.spy();
        chatSessionService = new IrisChatSessionService(
            {
                contextStore,
                artemisApiService: mockApiService as any,
                postMessage: postMessageSpy,
                postSnapshot: onPostSnapshotSpy,
            },
            () => mockIrisWebSocketSessionClient as any,
            { resetRuns: resetRunsSpy },
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
        const courseContext: ActiveContext = {
            type: 'course',
            id: 101,
            title: 'Test Course',
            source: 'user-selected',
            locked: false,
            selectedAt: Date.now()
        };

        test('classifies as unavailable when API service is not available', async () => {
            const serviceWithoutApi = new IrisChatSessionService(
                {
                    contextStore,
                    artemisApiService: undefined,
                    postMessage: postMessageSpy,
                    postSnapshot: onPostSnapshotSpy,
                },
                () => mockIrisWebSocketSessionClient as any,
                { resetRuns: resetRunsSpy },
            );

            const result = await serviceWithoutApi.checkAndLoadIrisSettings(courseContext);
            assert.strictEqual(result.kind, 'unavailable');
        });

        test('classifies as enabled for course context when settings.enabled is true', async () => {
            mockApiService.getIrisCourseChatSettings.resolves({
                settings: { enabled: true },
                effectiveRateLimit: { requests: 10, timeframeHours: 1 }
            });

            const result = await chatSessionService.checkAndLoadIrisSettings(courseContext);

            assert.strictEqual(result.kind, 'enabled');
            assert.ok(mockApiService.getIrisCourseChatSettings.calledOnceWith(101));
        });

        test('classifies as disabled when settings.enabled is false', async () => {
            mockApiService.getIrisCourseChatSettings.resolves({
                settings: { enabled: false }
            });

            const result = await chatSessionService.checkAndLoadIrisSettings(courseContext);
            assert.strictEqual(result.kind, 'disabled');
        });

        test('classifies as unavailable when settings.settings is missing entirely', async () => {
            mockApiService.getIrisCourseChatSettings.resolves({} as any);

            const result = await chatSessionService.checkAndLoadIrisSettings(courseContext);
            assert.strictEqual(result.kind, 'unavailable');
        });

        test('classifies as unavailable when settings.settings.enabled is not a boolean', async () => {
            mockApiService.getIrisCourseChatSettings.resolves({
                settings: {} as any
            });

            const result = await chatSessionService.checkAndLoadIrisSettings(courseContext);
            assert.strictEqual(result.kind, 'unavailable');
        });

        test('classifies as enabled for exercise context with courseId', async () => {
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

            assert.strictEqual(result.kind, 'enabled');
            assert.ok(mockApiService.getIrisCourseChatSettings.calledOnceWith(101));
        });

        test('resolves courseId from tracked exercise', async () => {
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

            assert.strictEqual(result.kind, 'enabled');
            assert.ok(mockApiService.getIrisCourseChatSettings.calledWith(101));
        });

        test('resolves courseId from exercise details API', async () => {
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

            assert.strictEqual(result.kind, 'enabled');
            assert.ok(mockApiService.getExerciseDetails.calledOnceWith(123));
            assert.ok(mockApiService.getIrisCourseChatSettings.calledWith(101));
        });

        test('classifies as unavailable when courseId cannot be resolved for exercise', async () => {
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
            assert.strictEqual(result.kind, 'unavailable');
        });

        test('classifies as disabled for unsupported context type', async () => {
            const context: ActiveContext = {
                type: 'lecture' as any,
                id: 999,
                title: 'Test Lecture',
                source: 'user-selected',
                locked: false,
                selectedAt: Date.now()
            };

            const result = await chatSessionService.checkAndLoadIrisSettings(context);
            assert.strictEqual(result.kind, 'disabled');
        });

        test('classifies ApiError(403) as disabled', async () => {
            mockApiService.getIrisCourseChatSettings.rejects(new ApiError('Forbidden', 403));

            const result = await chatSessionService.checkAndLoadIrisSettings(courseContext);
            assert.strictEqual(result.kind, 'disabled');
        });

        test('classifies ApiError(401) as unavailable (auth handler is firing)', async () => {
            mockApiService.getIrisCourseChatSettings.rejects(new ApiError('Auth expired', 401));

            const result = await chatSessionService.checkAndLoadIrisSettings(courseContext);
            assert.strictEqual(result.kind, 'unavailable');
        });

        test('classifies ApiError(404) as unavailable', async () => {
            mockApiService.getIrisCourseChatSettings.rejects(new ApiError('Not found', 404));

            const result = await chatSessionService.checkAndLoadIrisSettings(courseContext);
            assert.strictEqual(result.kind, 'unavailable');
        });

        test('classifies ApiError(500) as unavailable', async () => {
            mockApiService.getIrisCourseChatSettings.rejects(new ApiError('Server error', 500));

            const result = await chatSessionService.checkAndLoadIrisSettings(courseContext);
            assert.strictEqual(result.kind, 'unavailable');
        });

        test('classifies MalformedResponseError as unavailable', async () => {
            mockApiService.getIrisCourseChatSettings.rejects(
                new MalformedResponseError('Schema mismatch', 200, 'bad shape')
            );

            const result = await chatSessionService.checkAndLoadIrisSettings(courseContext);
            assert.strictEqual(result.kind, 'unavailable');
        });

        test('classifies a plain network error as unavailable', async () => {
            mockApiService.getIrisCourseChatSettings.rejects(new TypeError('Failed to fetch'));

            const result = await chatSessionService.checkAndLoadIrisSettings(courseContext);
            assert.strictEqual(result.kind, 'unavailable');
        });

        test('classifies getProfileInfo failure as unavailable', async () => {
            mockApiService.getProfileInfo.rejects(new TypeError('Failed to fetch'));

            const result = await chatSessionService.checkAndLoadIrisSettings(courseContext);
            assert.strictEqual(result.kind, 'unavailable');
        });

        test('classifies as disabled when iris profile is not active on server', async () => {
            mockApiService.isIrisProfileActive.returns(false);

            const result = await chatSessionService.checkAndLoadIrisSettings(courseContext);
            assert.strictEqual(result.kind, 'disabled');
        });

        test('classifies ApiError(403) from getProfileInfo as unavailable, not disabled', async () => {
            // 403 only means "Iris is off for this course/exercise" when it
            // comes from the iris-settings endpoint. A 403 from the profile
            // probe (or any other endpoint in the flow) is an
            // infrastructure / auth issue and must NOT be misclassified as
            // disabled — otherwise a transient permissions hiccup would
            // surface the "instructor disabled Iris" overlay.
            mockApiService.getProfileInfo.rejects(new ApiError('Forbidden', 403));

            const result = await chatSessionService.checkAndLoadIrisSettings(courseContext);
            assert.strictEqual(result.kind, 'unavailable');
        });

        test('classifies ApiError(403) from getExerciseDetails (during course resolution) as unavailable', async () => {
            // Same origin-sensitivity concern as the profile probe: a 403
            // from the exercise-details endpoint while resolving the course
            // ID is an auth / permissions issue, not an Iris-disabled
            // signal. The user must see the unavailable banner, not the
            // disabled overlay.
            const exerciseContext: ActiveContext = {
                type: 'exercise',
                id: 123,
                title: 'Test Exercise',
                source: 'user-selected',
                locked: false,
                selectedAt: Date.now()
            };
            mockApiService.getExerciseDetails.rejects(new ApiError('Forbidden', 403));

            const result = await chatSessionService.checkAndLoadIrisSettings(exerciseContext);
            assert.strictEqual(result.kind, 'unavailable');
        });
    });

    suite('Availability state tracking', () => {
        const courseContext: ActiveContext = {
            type: 'course',
            id: 101,
            title: 'Test Course',
            source: 'user-selected',
            locked: false,
            selectedAt: Date.now()
        };

        test('lastAvailability starts as unknown', () => {
            assert.strictEqual(chatSessionService.lastAvailability.kind, 'unknown');
        });

        test('lastAvailability reflects the last classification after loadAllSessionsForContext', async () => {
            contextStore.setActiveContext(courseContext);
            mockApiService.getIrisCourseChatSettings.rejects(new ApiError('Server error', 500));

            await chatSessionService.loadAllSessionsForContext();

            assert.strictEqual(chatSessionService.lastAvailability.kind, 'unavailable');
            assert.strictEqual(chatSessionService.lastAvailability.contextKey, 'course:101');
        });

        test('lastAvailability tracks contextKey for disabled state', async () => {
            contextStore.setActiveContext(courseContext);
            mockApiService.getIrisCourseChatSettings.resolves({ settings: { enabled: false } });

            await chatSessionService.loadAllSessionsForContext();

            assert.strictEqual(chatSessionService.lastAvailability.kind, 'disabled');
            assert.strictEqual(chatSessionService.lastAvailability.contextKey, 'course:101');
        });

        test('resetAvailability sets state back to unknown', async () => {
            contextStore.setActiveContext(courseContext);
            mockApiService.getIrisCourseChatSettings.rejects(new ApiError('Server error', 500));
            await chatSessionService.loadAllSessionsForContext();
            assert.strictEqual(chatSessionService.lastAvailability.kind, 'unavailable');

            chatSessionService.resetAvailability();

            const reset = chatSessionService.lastAvailability;
            assert.strictEqual(reset.kind, 'unknown');
            assert.strictEqual(reset.contextKey, undefined);
        });
    });

    suite('Load All Sessions For Context', () => {
        test('should not load sessions when no active context', async () => {
            await chatSessionService.loadAllSessionsForContext();

            assert.ok(mockApiService.listChatSessionsForCourse.notCalled);
        });

        test('classifies as unavailable and surfaces the banner when API service is missing', async () => {
            const serviceWithoutApi = new IrisChatSessionService(
                {
                    contextStore,
                    artemisApiService: undefined,
                    postMessage: postMessageSpy,
                    postSnapshot: onPostSnapshotSpy,
                },
                () => mockIrisWebSocketSessionClient as any,
                { resetRuns: resetRunsSpy },
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

            // The API service being absent during early activation is transient
            // (the next reload after init completes will pick up the service).
            // Showing the unavailable banner is the right UX, not silently
            // doing nothing and leaving the loader spinning.
            assert.ok(postMessageSpy.calledWith(
                sinon.match({ type: 'showUnavailableState' })
            ), 'expected showUnavailableState when API service is unavailable');
            // The listing API must never be hit when no service exists.
            // (Trivially true because the service is undefined, but worth
            // documenting alongside the banner expectation.)
            assert.ok(!mockApiService.listChatSessionsForCourse.called);
        });

        test('emits ShowDisabledState + HideUnavailableState when Iris is disabled', async () => {
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
            assert.ok(postMessageSpy.calledWith(
                sinon.match({ type: 'hideUnavailableState' })
            ));
            // Disabled is an availability decision, NOT a history-load failure.
            // The view gates its loader on disabledMessage / unavailableMessage
            // directly; emitting loadMessagesError would surface the misleading
            // central error UI in addition to the banner.
            assert.ok(postMessageSpy.neverCalledWith(
                sinon.match({ type: 'loadMessagesError' })
            ));
        });

        test('emits ShowUnavailableState + HideDisabledState on transient infrastructure failure', async () => {
            const context: ActiveContext = {
                type: 'course',
                id: 101,
                title: 'Test Course',
                source: 'user-selected',
                locked: false,
                selectedAt: Date.now()
            };
            contextStore.setActiveContext(context);

            mockApiService.getIrisCourseChatSettings.rejects(new ApiError('Server error', 500));

            await chatSessionService.loadAllSessionsForContext();

            assert.ok(postMessageSpy.calledWith(
                sinon.match({ type: 'showUnavailableState' })
            ), 'expected showUnavailableState to be posted');
            assert.ok(postMessageSpy.calledWith(
                sinon.match({ type: 'hideDisabledState' })
            ), 'expected hideDisabledState to be posted alongside unavailable');
            assert.ok(postMessageSpy.neverCalledWith(
                sinon.match({ type: 'showDisabledState' })
            ), 'transient failure must NOT show the disabled overlay');
            assert.ok(postMessageSpy.neverCalledWith(
                sinon.match({ type: 'loadMessagesError' })
            ), 'transient failure must NOT post the central history-load error');
        });

        test('outer fetch failure classifies as unavailable and does NOT create a fallback session', async () => {
            const context: ActiveContext = {
                type: 'course',
                id: 101,
                title: 'Test Course',
                source: 'user-selected',
                locked: false,
                selectedAt: Date.now()
            };
            contextStore.setActiveContext(context);

            // Settings succeed → enabled path; then listChatSessionsForCourse blows up.
            mockApiService.getIrisCourseChatSettings.resolves({ settings: { enabled: true } });
            mockApiService.listChatSessionsForCourse.rejects(new ApiError('Server error', 500));

            const sessionCountBefore = contextStore.snapshot().sessions.length;

            await chatSessionService.loadAllSessionsForContext();

            assert.ok(postMessageSpy.calledWith(
                sinon.match({ type: 'showUnavailableState' })
            ), 'outer catch must classify the failure as unavailable');

            const sessionCountAfter = contextStore.snapshot().sessions.length;
            assert.strictEqual(sessionCountAfter, sessionCountBefore,
                'no createNewSession() fallback may run when listing fails — the server still has the real sessions');
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
                { sessionId: 1, courseId: 101, context: { mode: 'COURSE_CHAT', entityId: 101 }, lastActivity: Date.parse('2024-01-01T10:00:00Z') },
                { sessionId: 2, courseId: 101, context: { mode: 'COURSE_CHAT', entityId: 101 }, lastActivity: Date.parse('2024-01-02T10:00:00Z') },
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
                { sessionId: 1, courseId: 123, context: { mode: 'PROGRAMMING_EXERCISE_CHAT', entityId: 123 }, lastActivity: Date.parse('2024-01-01T10:00:00Z') },
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
                { sessionId: 1, courseId: 101, context: { mode: 'COURSE_CHAT', entityId: 101 }, lastActivity: Date.parse('2024-01-01T10:00:00Z') },
                { sessionId: 2, courseId: 101, context: { mode: 'COURSE_CHAT', entityId: 101 }, lastActivity: Date.parse('2024-01-03T10:00:00Z') }, // Newest
                { sessionId: 3, courseId: 101, context: { mode: 'COURSE_CHAT', entityId: 101 }, lastActivity: Date.parse('2024-01-02T10:00:00Z') },
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

        test('outer load failure surfaces unavailable without creating a fallback session', async () => {
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
            // Listing throws AFTER the enabled classification — exercises the
            // outer try/catch path.
            mockApiService.listChatSessionsForCourse.rejects(new Error('API Error'));

            mockIrisWebSocketSessionClient.createNewSession.resolves(42);

            await chatSessionService.loadAllSessionsForContext();

            // The previous behavior silently created a local fallback session
            // whenever any error escaped the outer try — masking transient
            // server outages as "no server-side sessions" and accumulating
            // orphan local sessions on each reload. The new contract is:
            // outer failures classify as `unavailable` and surface the
            // banner. Retry is the user's recovery path.
            assert.ok(postMessageSpy.calledWith(
                sinon.match({ type: 'showUnavailableState' })
            ), 'outer failure must classify as unavailable');
            assert.ok(mockIrisWebSocketSessionClient.resetSession.notCalled,
                'createNewSession must not run as a silent fallback');
            assert.ok(mockIrisWebSocketSessionClient.createNewSession.notCalled,
                'no new server session may be allocated by the failure path');
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
                { sessionId: 1, courseId: 101, context: { mode: 'COURSE_CHAT', entityId: 101 }, lastActivity: Date.parse('2024-01-01T10:00:00Z') },
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

        test('hides both disabled and unavailable banners when Iris is enabled', async () => {
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
            ), 'expected hideDisabledState on enabled path');
            assert.ok(postMessageSpy.calledWith(
                sinon.match({ type: 'hideUnavailableState' })
            ), 'expected hideUnavailableState on enabled path');
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
                { sessionId: 7, courseId: 101, context: { mode: 'COURSE_CHAT', entityId: 101 }, lastActivity: Date.parse('2024-02-01T10:00:00Z') },
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
                { sessionId: 1, courseId: 101, context: { mode: 'COURSE_CHAT', entityId: 101 }, lastActivity: Date.parse('2024-01-01T10:00:00Z') },
                { sessionId: 2, courseId: 101, context: { mode: 'COURSE_CHAT', entityId: 101 }, lastActivity: Date.parse('2024-01-02T10:00:00Z') },
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
                { sessionId: 1, courseId: 101, context: { mode: 'COURSE_CHAT', entityId: 101 }, lastActivity: Date.parse('2024-01-01T10:00:00Z') },
                { sessionId: 2, courseId: 101, context: { mode: 'COURSE_CHAT', entityId: 101 }, lastActivity: Date.parse('2024-01-02T10:00:00Z') },
                { sessionId: 3, courseId: 101, context: { mode: 'COURSE_CHAT', entityId: 101 }, lastActivity: Date.parse('2024-01-03T10:00:00Z') },
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
                { sessionId: 5, courseId: 101, context: { mode: 'COURSE_CHAT', entityId: 101 }, lastActivity: Date.parse('2024-01-05T10:00:00Z') },
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

        test('LoadMessages carries activities (filtered) and final through the history path', async () => {
            // Persisted Iris messages carry a tool `activities` trail and a
            // `final` flag. The mapping in chatSessionService must forward
            // both instead of silently discarding them on reload, and it
            // must drop malformed activity entries rather than forward them
            // as-is (isIrisActivity is the shared runtime guard).
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

            const validActivity = { id: 'a1', kind: 'TOOL', name: 'search', state: 'RUNNING' };
            const malformedActivity = { id: 'a2', name: 'bad-activity', state: 'RUNNING' }; // missing `kind` — must be filtered out

            mockApiService.listChatSessionsForCourse.resolves([
                { sessionId: 1, courseId: 101, context: { mode: 'COURSE_CHAT', entityId: 101 }, lastActivity: Date.parse('2024-01-01T10:00:00Z') },
            ]);
            mockApiService.getChatMessages.withArgs(1).resolves([
                {
                    id: 100,
                    sender: 'LLM',
                    content: [{ textContent: 'Working on it' }],
                    activities: [validActivity, malformedActivity],
                    final: false,
                } as never,
            ]);

            mockIrisWebSocketSessionClient.initializeSession.resolves(1);

            await chatSessionService.loadAllSessionsForContext();

            const loadMessagesCall = postMessageSpy.getCalls().find(
                c => c.args[0]?.type === 'loadMessages'
            );
            assert.ok(loadMessagesCall, 'Should emit loadMessages');

            const messages = (loadMessagesCall!.args[0] as {
                messages: Array<{ activities?: unknown[]; final?: boolean }>;
            }).messages;
            assert.strictEqual(messages.length, 1);
            assert.strictEqual(messages[0].final, false, 'final:false must survive the mapping');
            assert.deepStrictEqual(
                messages[0].activities,
                [validActivity],
                'the malformed activity entry must be filtered out; the valid one must survive',
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

        test('server-side failure during new-session round-trip surfaces unavailable banner', async () => {
            // The previous behavior posted only LoadMessagesError on a
            // createNewSession failure — the loader stopped via the
            // messagesErrored UI but the user got no "Iris unavailable,
            // retry?" affordance. The new contract: classify the error via
            // the shared availability classifier and surface the unavailable
            // banner alongside the LoadMessagesError, so reconnect-auto-retry
            // can recover the session.
            const context: ActiveContext = {
                type: 'course',
                id: 101,
                title: 'Test Course',
                source: 'user-selected',
                locked: false,
                selectedAt: Date.now()
            };
            contextStore.setActiveContext(context);

            mockIrisWebSocketSessionClient.createNewSession.rejects(new ApiError('Server error', 500));

            chatSessionService.createNewSession();

            // Let the .catch() fire.
            await new Promise(resolve => setTimeout(resolve, 10));

            assert.ok(postMessageSpy.calledWith(
                sinon.match({ type: 'showUnavailableState' })
            ), 'expected showUnavailableState after createNewSession 500');
            assert.strictEqual(chatSessionService.lastAvailability.kind, 'unavailable',
                'lastAvailability must reflect the failure so reconnect-auto-retry fires');
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

    suite('createNewSession creation-in-flight guard', () => {
        test('two rapid calls create exactly one local session and one server call; the accepted result is applied', async () => {
            const context: ActiveContext = {
                type: 'course',
                id: 101,
                title: 'Test Course',
                source: 'user-selected',
                locked: false,
                selectedAt: Date.now()
            };
            contextStore.setActiveContext(context);
            const sessionCountBefore = contextStore.snapshot().sessions.length;

            mockIrisWebSocketSessionClient.createNewSession.resolves(42);

            // Rapid duplicate: fired before the first server round-trip resolves.
            chatSessionService.createNewSession();
            chatSessionService.createNewSession();

            // The guard-key check and local session creation are synchronous;
            // assert those immediately. The actual server call is issued after
            // an async courseId resolution, so it is asserted after the flush
            // below instead.
            assert.strictEqual(
                contextStore.snapshot().sessions.length, sessionCountBefore + 1,
                'exactly one new local session must be created',
            );

            // Let the courseId resolution and the accepted request's .then() fire.
            await new Promise(resolve => setTimeout(resolve, 10));

            assert.strictEqual(
                mockIrisWebSocketSessionClient.createNewSession.callCount, 1,
                'the duplicate call must not issue a second server-side create',
            );

            const finalSnapshot = contextStore.snapshot();
            assert.strictEqual(finalSnapshot.activeSession?.artemisSessionId, 42,
                'the accepted request\'s server id must be mapped onto the session (guard runs before the token advances, so the duplicate never invalidates the legitimate op)');

            const loadMessagesCall = postMessageSpy.getCalls().find(
                c => c.args[0]?.type === 'loadMessages'
            );
            assert.ok(loadMessagesCall, 'LoadMessages for the accepted create must not be discarded as stale');
            assert.strictEqual(
                (loadMessagesCall!.args[0] as { localSessionId: string }).localSessionId,
                finalSnapshot.activeSession?.id,
                'LoadMessages must be tagged with the session that is actually active',
            );
        });

        test('the guard releases after completion, so a later call for the same context is allowed', async () => {
            const context: ActiveContext = {
                type: 'course',
                id: 101,
                title: 'Test Course',
                source: 'user-selected',
                locked: false,
                selectedAt: Date.now()
            };
            contextStore.setActiveContext(context);
            mockIrisWebSocketSessionClient.createNewSession.resolves(1);

            chatSessionService.createNewSession();
            await new Promise(resolve => setTimeout(resolve, 10));

            chatSessionService.createNewSession();
            await new Promise(resolve => setTimeout(resolve, 10));

            assert.strictEqual(mockIrisWebSocketSessionClient.createNewSession.callCount, 2,
                'a create issued after the first one fully completed must not be blocked by a stale guard entry');
        });

        test('the guard is keyed by context: an in-flight create in course A does not block a concurrent create in course B', async () => {
            const courseA: ActiveContext = {
                type: 'course',
                id: 101,
                title: 'Course A',
                source: 'user-selected',
                locked: false,
                selectedAt: Date.now()
            };
            const courseB: ActiveContext = {
                type: 'course',
                id: 202,
                title: 'Course B',
                source: 'user-selected',
                locked: false,
                selectedAt: Date.now()
            };

            // A's server round-trip is held open for the duration of this
            // test, so A's guard entry stays populated the whole time.
            let resolveA: (id: number) => void = () => { /* noop */ };
            mockIrisWebSocketSessionClient.createNewSession.callsFake(
                () => new Promise<number>(resolve => { resolveA = resolve; }),
            );

            contextStore.setActiveContext(courseA);
            chatSessionService.createNewSession(); // A now in flight, never resolves during this test

            contextStore.setActiveContext(courseB);
            mockIrisWebSocketSessionClient.createNewSession.resolves(2); // B resolves normally
            chatSessionService.createNewSession();

            await new Promise(resolve => setTimeout(resolve, 10));

            assert.strictEqual(mockIrisWebSocketSessionClient.createNewSession.callCount, 2,
                "B must not be blocked by A's still-open guard entry");

            // Resolve A so its promise chain settles before the test ends.
            resolveA(1);
            await new Promise(resolve => setTimeout(resolve, 10));
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
                { sessionId: 1, courseId: 101, context: { mode: 'COURSE_CHAT', entityId: 101 }, lastActivity: Date.parse('2024-01-01T10:00:00Z') },
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

    suite('fetchActiveSessionHistory', () => {
        test('returns the formatted messages from getChatMessages', async () => {
            mockApiService.getChatMessages.withArgs(5).resolves([
                { id: 100, sender: 'USER', content: [{ textContent: 'Hello' }], sentAt: '2024-01-01T10:00:00Z' } as never,
                { id: 200, sender: 'LLM', content: [{ textContent: 'Hi there' }], final: true } as never,
            ]);

            const result = await chatSessionService.fetchActiveSessionHistory(5);

            assert.strictEqual(result.length, 2);
            assert.strictEqual(result[0].id, 100);
            assert.strictEqual(result[0].role, 'user');
            assert.strictEqual(result[0].content, 'Hello');
            assert.strictEqual(result[1].id, 200);
            assert.strictEqual(result[1].role, 'assistant');
            assert.strictEqual(result[1].final, true);
        });

        test('posts nothing and does not clear sessions for the context', async () => {
            const clearSpy = sinon.spy(contextStore, 'clearSessionsForContext');
            mockApiService.getChatMessages.withArgs(5).resolves([
                { id: 100, sender: 'USER', content: [{ textContent: 'Hello' }] },
            ]);

            await chatSessionService.fetchActiveSessionHistory(5);

            assert.ok(postMessageSpy.notCalled, 'fetchActiveSessionHistory must not post any webview message');
            assert.ok(clearSpy.notCalled, 'fetchActiveSessionHistory must not clear sessions for the context');
        });

        test('returns [] when artemisApiService is undefined', async () => {
            const serviceWithoutApi = new IrisChatSessionService(
                {
                    contextStore,
                    artemisApiService: undefined,
                    postMessage: postMessageSpy,
                    postSnapshot: onPostSnapshotSpy,
                },
                () => mockIrisWebSocketSessionClient as any,
                { resetRuns: resetRunsSpy },
            );

            const result = await serviceWithoutApi.fetchActiveSessionHistory(5);

            assert.deepStrictEqual(result, []);
            assert.ok(postMessageSpy.notCalled, 'must not post anything when the API service is missing');
        });
    });

    suite('resetRuns on conversation-reset paths', () => {
        // Each reset path clears the WS session and messages, so each must also
        // drop host run state or the old run's projection survives into the new
        // conversation. resetRuns must fire BEFORE the Iris session reset.
        const context: ActiveContext = {
            type: 'course',
            id: 101,
            title: 'Test Course',
            source: 'user-selected',
            locked: false,
            selectedAt: Date.now()
        };

        test('switchToSession resets runs before resetting the Iris session', () => {
            contextStore.setActiveContext(context);
            contextStore.createSession();
            const sessionId = contextStore.snapshot().sessions[0].id;
            mockIrisWebSocketSessionClient.initializeSession.resolves(1);
            mockApiService.getChatMessages.resolves([]);

            chatSessionService.switchToSession(sessionId);

            assert.ok(resetRunsSpy.calledOnce, 'resetRuns must fire on switchToSession');
            assert.ok(
                resetRunsSpy.calledBefore(mockIrisWebSocketSessionClient.resetSession),
                'resetRuns must fire before the Iris session reset',
            );
        });

        test('createNewSession resets runs before resetting the Iris session', () => {
            contextStore.setActiveContext(context);
            mockIrisWebSocketSessionClient.createNewSession.resolves(42);

            chatSessionService.createNewSession();

            assert.ok(resetRunsSpy.calledOnce, 'resetRuns must fire on createNewSession');
            assert.ok(
                resetRunsSpy.calledBefore(mockIrisWebSocketSessionClient.resetSession),
                'resetRuns must fire before the Iris session reset',
            );
        });

        test('resetAndReloadSessions (_clearAllSessions) resets runs', async () => {
            contextStore.setActiveContext(context);
            mockApiService.listChatSessionsForCourse.resolves([]);
            mockIrisWebSocketSessionClient.createNewSession.resolves(99);

            await chatSessionService.resetAndReloadSessions();

            // _clearAllSessions runs first and resets runs before its
            // resetSession; the no-server-sessions fallback (createNewSession)
            // resets again, so the spy fires at least once.
            assert.ok(resetRunsSpy.called, 'resetRuns must fire on Reset & Sync');
            assert.ok(
                resetRunsSpy.calledBefore(mockIrisWebSocketSessionClient.resetSession),
                'the first resetRuns must fire before the first Iris session reset',
            );
        });
    });
});
