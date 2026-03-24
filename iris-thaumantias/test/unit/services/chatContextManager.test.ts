import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { ChatContextManager } from '../../../src/services/iris/chatContextManager';
import { ContextStore } from '../../../src/services/iris/contextStore';
import { IrisChatSessionService } from '../../../src/services/iris/chatSessionService';
import { IrisWebSocketSessionClient } from '../../../src/services/iris/irisWebSocketSessionClient';
import { MockExtensionContext } from '../mocks/vscodeMocks';

suite('ChatContextManager Test Suite', () => {
    let chatContextManager: ChatContextManager;
    let contextStore: ContextStore;
    let chatSessionService: sinon.SinonStubbedInstance<IrisChatSessionService>;
    let irisSessionManager: sinon.SinonStubbedInstance<IrisWebSocketSessionClient>;
    let postMessageSpy: sinon.SinonSpy;
    let mockContext: MockExtensionContext;
    // vscode.window stubs kept to prevent unhandled calls
    let _showInformationMessageStub: sinon.SinonStub;
    let _showWarningMessageStub: sinon.SinonStub;

    setup(() => {
        mockContext = new MockExtensionContext();
        contextStore = new ContextStore(mockContext);

        // Create stubbed services
        chatSessionService = sinon.createStubInstance(IrisChatSessionService);
        chatSessionService.loadAllSessionsForContext.resolves();

        irisSessionManager = sinon.createStubInstance(IrisWebSocketSessionClient);

        postMessageSpy = sinon.spy();

        // Stub vscode.window methods
        _showInformationMessageStub = sinon.stub(vscode.window, 'showInformationMessage');
        _showWarningMessageStub = sinon.stub(vscode.window, 'showWarningMessage');

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
            const exercise = snapshot.allExercises.find(e => e.id === 123);
            assert.ok(exercise);
            assert.strictEqual(exercise.title, 'Test Exercise');
        });

        test('should register course when selecting course context', () => {
            chatContextManager.handleContextSelection('course', 101, 'Test Course');

            const snapshot = contextStore.snapshot();
            const course = snapshot.allCourses.find(c => c.id === 101);
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

    suite('Course Selection', () => {
        test('should handle course selection by ID', () => {
            chatContextManager.handleCourseSelection(101);

            const snapshot = contextStore.snapshot();
            assert.ok(snapshot.activeContext);
            assert.strictEqual(snapshot.activeContext.type, 'course');
            assert.strictEqual(snapshot.activeContext.id, 101);
            assert.strictEqual(snapshot.activeContext.source, 'user-selected');

            assert.ok(postMessageSpy.calledWith({ type: 'clearChatMessages' }));
            assert.ok(chatSessionService.loadAllSessionsForContext.calledOnce);
        });

        test('should register and use course for context', () => {
            // When calling handleCourseSelection, it will register with default title first
            chatContextManager.handleCourseSelection(101);

            const snapshot = contextStore.snapshot();
            assert.ok(snapshot.activeContext);
            // Will have the registered course data
            assert.strictEqual(snapshot.activeContext.id, 101);
        });

        test('should use fallback title if course not tracked', () => {
            chatContextManager.handleCourseSelection(999);

            const snapshot = contextStore.snapshot();
            assert.ok(snapshot.activeContext);
            assert.strictEqual(snapshot.activeContext.title, 'Course 999');
        });

        test('should register course if not already tracked', () => {
            chatContextManager.handleCourseSelection(101);

            const snapshot = contextStore.snapshot();
            const course = snapshot.allCourses.find(c => c.id === 101);
            assert.ok(course);
        });

        test('should reset Iris session on course selection', () => {
            chatContextManager.handleCourseSelection(101);

            assert.ok(irisSessionManager.resetSession.calledOnce);
        });
    });

    suite('Exercise Selection', () => {
        test('should handle exercise selection by ID', () => {
            chatContextManager.handleExerciseSelection(123);

            const snapshot = contextStore.snapshot();
            assert.ok(snapshot.activeContext);
            assert.strictEqual(snapshot.activeContext.type, 'exercise');
            assert.strictEqual(snapshot.activeContext.id, 123);
            assert.strictEqual(snapshot.activeContext.source, 'user-selected');

            assert.ok(postMessageSpy.calledWith({ type: 'clearChatMessages' }));
            assert.ok(chatSessionService.loadAllSessionsForContext.calledOnce);
        });

        test('should register and use exercise for context', () => {
            // Pre-register exercise
            contextStore.registerExercise({
                id: 123,
                title: 'Algorithm Challenge',
                shortName: 'EX01',
                courseId: 101
            });

            chatContextManager.handleExerciseSelection(123);

            const snapshot = contextStore.snapshot();
            assert.ok(snapshot.activeContext);
            // Will use data from registered exercise
            assert.strictEqual(snapshot.activeContext.id, 123);
            assert.strictEqual(snapshot.activeContext.courseId, 101);
        });

        test('should use fallback title if exercise not tracked', () => {
            chatContextManager.handleExerciseSelection(999);

            const snapshot = contextStore.snapshot();
            assert.ok(snapshot.activeContext);
            assert.strictEqual(snapshot.activeContext.title, 'Exercise 999');
        });

        test('should preserve courseId from tracked exercise', () => {
            contextStore.registerExercise({
                id: 123,
                title: 'Test Exercise',
                courseId: 101
            });

            chatContextManager.handleExerciseSelection(123);

            const snapshot = contextStore.snapshot();
            assert.strictEqual(snapshot.activeContext?.courseId, 101);
        });

        test('should register exercise if not already tracked', () => {
            chatContextManager.handleExerciseSelection(123);

            const snapshot = contextStore.snapshot();
            const exercise = snapshot.allExercises.find(e => e.id === 123);
            assert.ok(exercise);
        });

        test('should set active context with exercise title', () => {
            contextStore.registerExercise({
                id: 123,
                title: 'My Exercise'
            });

            chatContextManager.handleExerciseSelection(123);

            const snapshot = contextStore.snapshot();
            assert.ok(snapshot.activeContext);
            assert.strictEqual(snapshot.activeContext.title, 'My Exercise');
        });

        test('should reset Iris session on exercise selection', () => {
            chatContextManager.handleExerciseSelection(123);

            assert.ok(irisSessionManager.resetSession.calledOnce);
        });
    });

    suite('Switch Context', () => {
        test('should unlock active context', () => {
            // Set a locked context
            contextStore.setActiveContext({
                type: 'exercise',
                id: 123,
                title: 'Test Exercise',
                source: 'user-selected',
                locked: true,
                selectedAt: Date.now()
            });

            let snapshot = contextStore.snapshot();
            assert.strictEqual(snapshot.activeContext?.locked, true);

            chatContextManager.handleSwitchContext();

            snapshot = contextStore.snapshot();
            assert.strictEqual(snapshot.activeContext?.locked, false);
        });

        test('should handle when no active context exists', () => {
            // Should not throw
            chatContextManager.handleSwitchContext();

            const snapshot = contextStore.snapshot();
            assert.strictEqual(snapshot.activeContext, null);
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

    suite('Integration - Multiple Operations', () => {
        test('should handle switching between multiple contexts', () => {
            // Set course context
            chatContextManager.handleCourseSelection(101);
            let snapshot = contextStore.snapshot();
            assert.strictEqual(snapshot.activeContext?.type, 'course');
            assert.strictEqual(snapshot.activeContext?.id, 101);

            // Switch to exercise
            chatContextManager.handleExerciseSelection(123);
            snapshot = contextStore.snapshot();
            assert.strictEqual(snapshot.activeContext?.type, 'exercise');
            assert.strictEqual(snapshot.activeContext?.id, 123);

            // Switch back to course
            chatContextManager.handleCourseSelection(102);
            snapshot = contextStore.snapshot();
            assert.strictEqual(snapshot.activeContext?.type, 'course');
            assert.strictEqual(snapshot.activeContext?.id, 102);

            // Should have loaded sessions 3 times
            assert.strictEqual(chatSessionService.loadAllSessionsForContext.callCount, 3);
        });

        test('should reset Iris session each time context changes', () => {
            chatContextManager.handleCourseSelection(101);
            chatContextManager.handleExerciseSelection(123);
            chatContextManager.handleCourseSelection(102);

            // Should reset session 3 times
            assert.strictEqual(irisSessionManager.resetSession.callCount, 3);
        });

        test('should clear messages each time context changes', () => {
            chatContextManager.handleCourseSelection(101);
            chatContextManager.handleExerciseSelection(123);

            // Should clear twice
            const clearCalls = postMessageSpy.getCalls().filter(
                call => call.args[0].type === 'clearChatMessages'
            );
            assert.strictEqual(clearCalls.length, 2);
        });
    });

    suite('Edge Cases', () => {
        test('should handle context selection with undefined shortName', () => {
            chatContextManager.handleContextSelection('exercise', 123, 'Test Exercise', undefined);

            const snapshot = contextStore.snapshot();
            assert.ok(snapshot.activeContext);
            assert.strictEqual(snapshot.activeContext.shortName, undefined);
        });

        test('should handle exercise selection with no courseId', () => {
            chatContextManager.handleExerciseSelection(123);

            const snapshot = contextStore.snapshot();
            assert.ok(snapshot.activeContext);
            assert.strictEqual(snapshot.activeContext.courseId, undefined);
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
            managerWithoutIris.handleCourseSelection(101);

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

        test('should override with workspace exercise when different exercise active', () => {
            contextStore.setActiveContext({
                type: 'exercise',
                id: 999,
                title: 'Other',
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
            assert.strictEqual(snapshot.activeContext?.id, 123);
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

        test('should auto-select after removing active exercise', () => {
            chatContextManager.registerExerciseAndAutoSelect({ id: 1, title: 'Ex 1' });
            chatContextManager.registerExerciseAndAutoSelect({ id: 2, title: 'Ex 2' });

            // Ex 1 should be auto-selected (first registered, no active)
            assert.strictEqual(contextStore.getActiveContext()?.id, 1);

            // Now set Ex 2 as active and remove it
            contextStore.setActiveContext({
                type: 'exercise',
                id: 2,
                title: 'Ex 2',
                source: 'user-selected',
                locked: false,
                selectedAt: Date.now(),
            });
            chatContextManager.removeExerciseAndAutoSelect(2);

            const snapshot = contextStore.snapshot();
            assert.ok(snapshot.activeContext);
            assert.strictEqual(snapshot.activeContext.id, 1);
        });

        test('should auto-select after removing active course', () => {
            chatContextManager.registerCourseAndAutoSelect({ id: 101, title: 'Course 1' });
            chatContextManager.registerCourseAndAutoSelect({ id: 102, title: 'Course 2' });

            contextStore.setActiveContext({
                type: 'course',
                id: 101,
                title: 'Course 1',
                source: 'user-selected',
                locked: false,
                selectedAt: Date.now(),
            });

            chatContextManager.removeCourseAndAutoSelect(101);

            const snapshot = contextStore.snapshot();
            assert.ok(snapshot.activeContext);
            assert.strictEqual(snapshot.activeContext.id, 102);
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
});
