import * as vscode from 'vscode';
import * as assert from 'assert';
import * as sinon from 'sinon';

import { ChatContextManager, pickBestContextFromSnapshot } from '@extension/services/iris/chat/chatContextManager';
import { IrisChatSessionService } from '@extension/services/iris/chat/chatSessionService';
import { ContextStore } from '@extension/services/iris/context/contextStore';
import { IrisWebSocketSessionClient } from '@extension/services/iris/transport/irisWebSocketSessionClient';
import { MockExtensionContext } from '@test/unit/mocks/vscodeMocks';

suite('ChatContextManager Test Suite', () => {
    let chatContextManager: ChatContextManager;
    let contextStore: ContextStore;
    let chatSessionService: sinon.SinonStubbedInstance<IrisChatSessionService>;
    let irisSessionManager: sinon.SinonStubbedInstance<IrisWebSocketSessionClient>;
    let postMessageSpy: sinon.SinonSpy;
    let mockContext: MockExtensionContext;

    setup(() => {
        mockContext = new MockExtensionContext();
        contextStore = new ContextStore(mockContext);

        // Create stubbed services
        chatSessionService = sinon.createStubInstance(IrisChatSessionService);
        chatSessionService.loadAllSessionsForContext.resolves();

        irisSessionManager = sinon.createStubInstance(IrisWebSocketSessionClient);

        postMessageSpy = sinon.spy();

        // Stub vscode.window methods to prevent unhandled calls
        sinon.stub(vscode.window, 'showInformationMessage');
        sinon.stub(vscode.window, 'showWarningMessage');

        chatContextManager = new ChatContextManager(
            {
                contextStore,
                artemisApiService: undefined,
                postMessage: postMessageSpy,
                postSnapshot: sinon.spy(),
            },
            chatSessionService as any,
            () => irisSessionManager as any,
        );
    });

    teardown(() => {
        sinon.restore();
    });

    suite('Context Selection', () => {
        test('should handle exercise context selection', () => {
            chatContextManager.handleContextSelection('exercise', 123, 'Test Exercise', 'EX123');

            const snapshot = contextStore.snapshot();
            assert.ok(snapshot.activeContext);
            assert.strictEqual(snapshot.activeContext.type, 'exercise');
            assert.strictEqual(snapshot.activeContext.id, 123);
            assert.strictEqual(snapshot.activeContext.title, 'Test Exercise');
            assert.strictEqual(snapshot.activeContext.shortName, 'EX123');
            assert.strictEqual(snapshot.activeContext.source, 'user-selected');

            assert.ok(postMessageSpy.calledWith({ type: 'clearChatMessages' }));
            assert.ok(chatSessionService.loadAllSessionsForContext.calledOnce);
        });

        test('should handle course context selection', () => {
            chatContextManager.handleContextSelection('course', 101, 'Test Course', 'CS101');

            const snapshot = contextStore.snapshot();
            assert.ok(snapshot.activeContext);
            assert.strictEqual(snapshot.activeContext.type, 'course');
            assert.strictEqual(snapshot.activeContext.id, 101);
            assert.strictEqual(snapshot.activeContext.title, 'Test Course');
            assert.strictEqual(snapshot.activeContext.shortName, 'CS101');

            assert.ok(postMessageSpy.calledWith({ type: 'clearChatMessages' }));
        });

        test('should register exercise when selecting exercise context', () => {
            chatContextManager.handleContextSelection('exercise', 123, 'Test Exercise');

            const snapshot = contextStore.snapshot();
            const exercise = snapshot.exercises.find(e => e.id === 123);
            assert.ok(exercise);
            assert.strictEqual(exercise.title, 'Test Exercise');
        });

        test('should register course when selecting course context', () => {
            chatContextManager.handleContextSelection('course', 101, 'Test Course');

            const snapshot = contextStore.snapshot();
            const course = snapshot.courses.find(c => c.id === 101);
            assert.ok(course);
            assert.strictEqual(course.title, 'Test Course');
        });

        test('should preserve courseId from tracked exercise', () => {
            // Pre-register exercise with courseId
            contextStore.registerExercise({
                id: 123,
                title: 'Test Exercise',
                courseId: 101
            });

            chatContextManager.handleContextSelection('exercise', 123, 'Test Exercise Updated');

            const snapshot = contextStore.snapshot();
            assert.ok(snapshot.activeContext);
            assert.strictEqual(snapshot.activeContext.courseId, 101);
        });

        test('should reset Iris session on context change', () => {
            chatContextManager.handleContextSelection('course', 101, 'Test Course');

            assert.ok(irisSessionManager.resetSession.calledOnce);
        });

        test('should clear chat messages on context change', () => {
            chatContextManager.handleContextSelection('exercise', 123, 'Test Exercise');

            assert.ok(postMessageSpy.calledWith({ type: 'clearChatMessages' }));
        });

        test('should handle lecture context selection', () => {
            chatContextManager.handleContextSelection('lecture' as any, 999, 'Test Lecture');

            const snapshot = contextStore.snapshot();
            assert.ok(snapshot.activeContext);
            assert.strictEqual(snapshot.activeContext.type, 'lecture');
            // Toast is now shown by the provider, not the service
        });

        test('should handle session loading errors gracefully', async () => {
            chatSessionService.loadAllSessionsForContext.rejects(new Error('Load failed'));

            // Should not throw
            chatContextManager.handleContextSelection('course', 101, 'Test Course');

            // Give async operation time to complete
            await new Promise(resolve => setTimeout(resolve, 10));

            // Context should still be set despite error
            const snapshot = contextStore.snapshot();
            assert.ok(snapshot.activeContext);
            assert.strictEqual(snapshot.activeContext.id, 101);
        });
    });

    suite('switchContext loadDefaultSession flag', () => {
        test('loadDefaultSession:false sets active context + clears chat but does NOT load the default session', () => {
            chatContextManager.switchContext({
                type: 'course',
                id: 202,
                title: 'History Course',
                courseId: 202,
                reason: 'user-selected',
                loadDefaultSession: false,
            });

            const snapshot = contextStore.snapshot();
            assert.ok(snapshot.activeContext, 'active context must still be set');
            assert.strictEqual(snapshot.activeContext.id, 202);
            assert.strictEqual(snapshot.activeContext.type, 'course');

            // WS reset + chat cleared (steps 1-3 still run).
            assert.ok(irisSessionManager.resetSession.calledOnce, 'WS session must be reset');
            assert.ok(postMessageSpy.calledWith({ type: 'clearChatMessages' }), 'chat must be cleared');

            // The whole point: the default-session loader must NOT fire.
            assert.ok(
                chatSessionService.loadAllSessionsForContext.notCalled,
                'loadAllSessionsForContext must NOT run when loadDefaultSession is false',
            );
        });

        test('default (flag omitted) still loads the default session', () => {
            chatContextManager.switchContext({
                type: 'course',
                id: 303,
                title: 'Normal Course',
                reason: 'user-selected',
            });

            assert.ok(
                chatSessionService.loadAllSessionsForContext.calledOnce,
                'loadAllSessionsForContext must run by default',
            );
        });
    });

    suite('Same-context selection (no-op)', () => {
        test('re-selecting the already-active exercise context does not reset, clear, or reload', () => {
            chatContextManager.handleContextSelection('exercise', 123, 'Test Exercise', 'EX123');

            const registerExerciseSpy = sinon.spy(contextStore, 'registerExercise');
            const setActiveContextSpy = sinon.spy(contextStore, 'setActiveContext');
            postMessageSpy.resetHistory();
            chatSessionService.loadAllSessionsForContext.resetHistory();
            irisSessionManager.resetSession.resetHistory();

            chatContextManager.handleContextSelection('exercise', 123, 'Test Exercise', 'EX123');

            assert.ok(registerExerciseSpy.notCalled);
            assert.ok(setActiveContextSpy.notCalled);
            assert.ok(chatSessionService.loadAllSessionsForContext.notCalled);
            assert.ok(irisSessionManager.resetSession.notCalled);
            assert.ok(postMessageSpy.notCalled);

            const snapshot = contextStore.snapshot();
            assert.strictEqual(snapshot.activeContext?.id, 123);
            assert.strictEqual(snapshot.activeContext?.type, 'exercise');
        });

        test('selecting a different exercise id still switches normally', () => {
            chatContextManager.handleContextSelection('exercise', 123, 'Test Exercise', 'EX123');
            chatSessionService.loadAllSessionsForContext.resetHistory();

            chatContextManager.handleContextSelection('exercise', 456, 'Other Exercise', 'EX456');

            const snapshot = contextStore.snapshot();
            assert.strictEqual(snapshot.activeContext?.id, 456);
            assert.ok(chatSessionService.loadAllSessionsForContext.calledOnce);
        });
    });

    suite('Switch To Workspace Context', () => {
        test('should find workspace exercise from recent exercises', () => {
            contextStore.registerExercise({
                id: 123,
                title: 'Workspace Exercise',
                isWorkspace: true
            });

            const result = chatContextManager.handleSwitchToWorkspaceContext();

            assert.ok(result);
            assert.strictEqual(result.id, 123);
            assert.strictEqual(result.isWorkspace, true);
        });

        test('should find workspace exercise from all exercises', () => {
            // Register multiple exercises to push workspace exercise to allExercises
            for (let i = 0; i < 15; i++) {
                contextStore.registerExercise({
                    id: i,
                    title: `Exercise ${i}`
                });
            }

            contextStore.registerExercise({
                id: 999,
                title: 'Workspace Exercise',
                isWorkspace: true
            });

            const result = chatContextManager.handleSwitchToWorkspaceContext();

            assert.ok(result);
            assert.strictEqual(result.id, 999);
        });

        test('should find exercise with "(Workspace)" in title', () => {
            contextStore.registerExercise({
                id: 123,
                title: 'My Exercise (Workspace)',
                isWorkspace: true
            });

            const result = chatContextManager.handleSwitchToWorkspaceContext();

            assert.ok(result);
            assert.strictEqual(result.id, 123);
        });

        test('should be case-insensitive when matching "(Workspace)"', () => {
            contextStore.registerExercise({
                id: 123,
                title: 'My Exercise (workspace)',
                isWorkspace: true
            });

            const result = chatContextManager.handleSwitchToWorkspaceContext();

            assert.ok(result);
            assert.strictEqual(result.id, 123);
        });

        test('should return undefined when no workspace exercise found', () => {
            contextStore.registerExercise({
                id: 123,
                title: 'Regular Exercise'
            });

            const result = chatContextManager.handleSwitchToWorkspaceContext();

            assert.strictEqual(result, undefined);
            // Warning toast is now shown by the provider, not the service
        });

        test('should prefer recent workspace exercise over all exercises', () => {
            // Add workspace exercise to allExercises (older)
            for (let i = 0; i < 15; i++) {
                contextStore.registerExercise({
                    id: i,
                    title: `Exercise ${i}`
                });
            }
            contextStore.registerExercise({
                id: 999,
                title: 'Old Workspace Exercise',
                isWorkspace: true
            });

            // Add different workspace exercise to recent (newer)
            contextStore.registerExercise({
                id: 123,
                title: 'New Workspace Exercise',
                isWorkspace: true
            });

            const result = chatContextManager.handleSwitchToWorkspaceContext();

            assert.ok(result);
            // Should return the recent one
            assert.strictEqual(result.id, 123);
        });

        test('should return exercise without setting context', () => {
            contextStore.registerExercise({
                id: 123,
                title: 'Workspace Exercise',
                isWorkspace: true
            });

            const before = contextStore.snapshot();
            const result = chatContextManager.handleSwitchToWorkspaceContext();

            const after = contextStore.snapshot();

            assert.ok(result);
            // Active context should not change
            assert.deepStrictEqual(after.activeContext, before.activeContext);
        });
    });

    suite('Edge Cases', () => {
        test('should handle context selection with undefined shortName', () => {
            chatContextManager.handleContextSelection('exercise', 123, 'Test Exercise', undefined);

            const snapshot = contextStore.snapshot();
            assert.ok(snapshot.activeContext);
            assert.strictEqual(snapshot.activeContext.shortName, undefined);
        });

        test('should handle when IrisWebSocketSessionClient is not available', () => {
            const managerWithoutIris = new ChatContextManager(
                {
                    contextStore,
                    artemisApiService: undefined,
                    postMessage: postMessageSpy,
                    postSnapshot: sinon.spy(),
                },
                chatSessionService as any,
                () => undefined,
            );

            // Should not throw
            managerWithoutIris.handleContextSelection('course', 101, 'Test Course');

            const snapshot = contextStore.snapshot();
            assert.ok(snapshot.activeContext);
        });
    });

    suite('Registration with auto-select policy', () => {
        test('should auto-select exercise when no active context', () => {
            chatContextManager.registerExerciseAndAutoSelect({
                id: 123,
                title: 'Test Exercise',
                source: 'system-default',
            });

            const snapshot = contextStore.snapshot();
            assert.ok(snapshot.activeContext);
            assert.strictEqual(snapshot.activeContext.id, 123);
            assert.strictEqual(snapshot.activeContext.source, 'system-default');
        });

        test('should not change active context when one already exists', () => {
            contextStore.setActiveContext({
                type: 'exercise',
                id: 999,
                title: 'Existing',
                source: 'user-selected',
                locked: false,
                selectedAt: Date.now(),
            });

            chatContextManager.registerExerciseAndAutoSelect({
                id: 123,
                title: 'New Exercise',
                source: 'system-default',
            });

            const snapshot = contextStore.snapshot();
            assert.strictEqual(snapshot.activeContext?.id, 999);
        });

        test('should NOT override an explicit user-selected exercise when workspace detection runs for a different id', () => {
            // Reproduces the bug where clicking "Ask Iris about exercise B"
            // was silently overwritten by background workspace re-detection of
            // exercise A on the next chat-view-visible event.
            // Goes through the real selection path on purpose: what protects the context is that the
            // student chose it in THIS session, which only the manager can know. Writing the store
            // directly would model a context restored from a previous window instead (#371).
            chatContextManager.handleContextSelection('exercise', 999, 'User-Picked Exercise');

            chatContextManager.registerExerciseAndAutoSelect({
                id: 123,
                title: 'Workspace Exercise',
                source: 'workspace-detected',
                isWorkspace: true,
            });

            const snapshot = contextStore.snapshot();
            assert.strictEqual(snapshot.activeContext?.id, 999, 'user-selected exercise must be preserved');
            assert.strictEqual(snapshot.activeContext?.source, 'user-selected');
        });

        test('should override with workspace exercise when active is system-default and outdated', () => {
            // Legitimate override case: no explicit user choice, just a stale
            // auto-pick. Workspace detection is allowed to take over.
            contextStore.setActiveContext({
                type: 'exercise',
                id: 999,
                title: 'Auto-picked Exercise',
                source: 'system-default',
                locked: false,
                selectedAt: Date.now(),
            });

            chatContextManager.registerExerciseAndAutoSelect({
                id: 123,
                title: 'Workspace Exercise',
                source: 'workspace-detected',
                isWorkspace: true,
            });

            const snapshot = contextStore.snapshot();
            assert.strictEqual(snapshot.activeContext?.id, 123);
            assert.strictEqual(snapshot.activeContext?.source, 'workspace-detected');
        });

        test('should override with workspace exercise when no active context exists', () => {
            chatContextManager.registerExerciseAndAutoSelect({
                id: 123,
                title: 'Workspace Exercise',
                source: 'workspace-detected',
                isWorkspace: true,
            });

            const snapshot = contextStore.snapshot();
            assert.strictEqual(snapshot.activeContext?.id, 123);
            assert.strictEqual(snapshot.activeContext?.source, 'workspace-detected');
        });

        test('SHOULD override a user-selected context restored from an earlier session (#371)', () => {
            // The active context is persisted together with its `source`, so a choice made days ago
            // came back as `user-selected` and vetoed detection in every later window: the chat
            // opened on "Struggle Test Course" while the workspace held Graph Traversal.
            // Writing the store directly is exactly what restoration looks like to the manager —
            // an active context carrying `user-selected` that it never handed out itself.
            contextStore.setActiveContext({
                type: 'course',
                id: 1,
                title: 'Struggle Test Course',
                source: 'user-selected',
                locked: false,
                selectedAt: Date.now(),
            });

            chatContextManager.registerExerciseAndAutoSelect({
                id: 3,
                title: 'Graph Traversal (Workspace)',
                source: 'workspace-detected',
                isWorkspace: true,
            });

            const snapshot = contextStore.snapshot();
            assert.strictEqual(snapshot.activeContext?.id, 3, 'a stale selection must not veto workspace detection');
            assert.strictEqual(snapshot.activeContext?.type, 'exercise');
            assert.strictEqual(snapshot.activeContext?.source, 'workspace-detected');
        });

        test('should override a course context whose id collides with the detected exercise id (#371)', () => {
            // The override guard used to compare ids alone, so course 3 read as "already exercise 3".
            contextStore.setActiveContext({
                type: 'course',
                id: 3,
                title: 'Course Three',
                source: 'system-default',
                locked: false,
                selectedAt: Date.now(),
            });

            chatContextManager.registerExerciseAndAutoSelect({
                id: 3,
                title: 'Exercise Three (Workspace)',
                source: 'workspace-detected',
                isWorkspace: true,
            });

            const snapshot = contextStore.snapshot();
            assert.strictEqual(snapshot.activeContext?.type, 'exercise', 'a course must not suppress an exercise override');
            assert.strictEqual(snapshot.activeContext?.source, 'workspace-detected');
        });

        test('should NOT override a restored context the student re-selected in this session (#371)', () => {
            // Confirming a restored context by clicking its already-active row in the picker is a
            // real choice, even though it is a no-op for everything else. If the marker were only
            // armed inside switchContext, the same-context early return would skip it and the next
            // detection would yank the context away.
            contextStore.setActiveContext({
                type: 'course',
                id: 1,
                title: 'Struggle Test Course',
                source: 'user-selected',
                locked: false,
                selectedAt: Date.now(),
            });

            chatContextManager.handleContextSelection('course', 1, 'Struggle Test Course');

            chatContextManager.registerExerciseAndAutoSelect({
                id: 3,
                title: 'Graph Traversal (Workspace)',
                source: 'workspace-detected',
                isWorkspace: true,
            });

            const snapshot = contextStore.snapshot();
            assert.strictEqual(snapshot.activeContext?.type, 'course', 're-selection must count as a choice');
            assert.strictEqual(snapshot.activeContext?.id, 1);
        });

        test('should override a restored user-selected course that also collides on id (#371)', () => {
            // Both guards would have blocked this one: the stale `user-selected` source and the
            // id-only comparison. Neither may survive on its own.
            contextStore.setActiveContext({
                type: 'course',
                id: 3,
                title: 'Course Three',
                source: 'user-selected',
                locked: false,
                selectedAt: Date.now(),
            });

            chatContextManager.registerExerciseAndAutoSelect({
                id: 3,
                title: 'Exercise Three (Workspace)',
                source: 'workspace-detected',
                isWorkspace: true,
            });

            const snapshot = contextStore.snapshot();
            assert.strictEqual(snapshot.activeContext?.type, 'exercise');
            assert.strictEqual(snapshot.activeContext?.source, 'workspace-detected');
        });

        test('should not override when same workspace exercise re-detected and user-selected', () => {
            contextStore.setActiveContext({
                type: 'exercise',
                id: 123,
                title: 'Workspace Exercise',
                source: 'user-selected',
                locked: false,
                selectedAt: Date.now(),
            });

            chatContextManager.registerExerciseAndAutoSelect({
                id: 123,
                title: 'Workspace Exercise',
                source: 'workspace-detected',
                isWorkspace: true,
            });

            const snapshot = contextStore.snapshot();
            assert.strictEqual(snapshot.activeContext?.source, 'user-selected');
        });

        test('should auto-select course when no active context', () => {
            chatContextManager.registerCourseAndAutoSelect({
                id: 101,
                title: 'Test Course',
                source: 'system-default',
            });

            const snapshot = contextStore.snapshot();
            assert.ok(snapshot.activeContext);
            assert.strictEqual(snapshot.activeContext.id, 101);
            assert.strictEqual(snapshot.activeContext.type, 'course');
        });

        test('should clear stale workspace context', () => {
            contextStore.setActiveContext({
                type: 'exercise',
                id: 123,
                title: 'Workspace Exercise',
                source: 'workspace-detected',
                locked: true,
                selectedAt: Date.now(),
            });

            chatContextManager.clearStaleWorkspaceContext();

            assert.strictEqual(contextStore.getActiveContext(), null);
        });

        test('should not clear non-workspace context', () => {
            contextStore.setActiveContext({
                type: 'exercise',
                id: 123,
                title: 'User Exercise',
                source: 'user-selected',
                locked: false,
                selectedAt: Date.now(),
            });

            chatContextManager.clearStaleWorkspaceContext();

            assert.ok(contextStore.getActiveContext());
            assert.strictEqual(contextStore.getActiveContext()?.id, 123);
        });
    });

    suite('pickBestContextFromSnapshot', () => {
        test('prefers exercises[0] over courses[0]', () => {
            const snap = {
                activeContext: null, activeSession: null, sessions: [],
                exercises: [{ id: 5, title: 'E5' }],
                courses: [{ id: 9, title: 'C9' }],
            };
            const picked = pickBestContextFromSnapshot(snap);
            assert.strictEqual(picked?.type, 'exercise');
            assert.strictEqual(picked?.id, 5);
        });

        test('falls through to course when exercises empty', () => {
            const snap = {
                activeContext: null, activeSession: null, sessions: [],
                exercises: [],
                courses: [{ id: 9, title: 'C9' }],
            };
            const picked = pickBestContextFromSnapshot(snap);
            assert.strictEqual(picked?.type, 'course');
            assert.strictEqual(picked?.id, 9);
        });

        test('returns null when both empty', () => {
            const snap = {
                activeContext: null, activeSession: null, sessions: [],
                exercises: [],
                courses: [],
            };
            assert.strictEqual(pickBestContextFromSnapshot(snap), null);
        });
    });
});
