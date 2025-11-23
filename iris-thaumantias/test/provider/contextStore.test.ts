import * as assert from 'assert';
import * as vscode from 'vscode';
import { ContextStore } from '../../src/provider/contextStore';
import { MockExtensionContext } from '../mocks/vscodeMocks';
import { ActiveContext } from '../../src/provider/contextTypes';

suite('ContextStore Test Suite', () => {
    let contextStore: ContextStore;
    let mockContext: MockExtensionContext;

    setup(() => {
        mockContext = new MockExtensionContext();
        contextStore = new ContextStore(mockContext);
    });

    test('should initialize with default state', () => {
        const snapshot = contextStore.snapshot();
        assert.strictEqual(snapshot.activeContext, null);
        assert.strictEqual(snapshot.recentExercises.length, 0);
    });

    test('should register exercise', () => {
        contextStore.registerExercise({
            id: 1,
            title: 'Test Exercise',
            source: 'user-selected'
        });

        const snapshot = contextStore.snapshot();
        assert.strictEqual(snapshot.allExercises.length, 1);
        assert.strictEqual(snapshot.allExercises[0].id, 1);
    });

    test('should set active context when registering workspace exercise', () => {
        contextStore.registerExercise({
            id: 1,
            title: 'Workspace Exercise',
            source: 'workspace-detected'
        });

        const snapshot = contextStore.snapshot();
        assert.ok(snapshot.activeContext);
        assert.strictEqual(snapshot.activeContext.id, 1);
        assert.strictEqual(snapshot.activeContext.source, 'workspace-detected');
    });

    test('should not override user-selected context with workspace exercise', () => {
        // Set user selected context
        const userContext: ActiveContext = {
            type: 'exercise',
            id: 2,
            title: 'User Exercise',
            source: 'user-selected',
            selectedAt: Date.now(),
            locked: false
        };
        contextStore.setActiveContext(userContext);

        // Try to register workspace exercise
        contextStore.registerExercise({
            id: 1,
            title: 'Workspace Exercise',
            source: 'workspace-detected'
        });

        const snapshot = contextStore.snapshot();
        assert.ok(snapshot.activeContext);
        assert.strictEqual(snapshot.activeContext.id, 2); // Should still be user exercise
        assert.strictEqual(snapshot.activeContext.source, 'user-selected');
    });

    test('should register course', () => {
        contextStore.registerCourse({
            id: 101,
            title: 'Test Course',
            source: 'user-selected'
        });

        const snapshot = contextStore.snapshot();
        assert.strictEqual(snapshot.allCourses.length, 1);
        assert.strictEqual(snapshot.allCourses[0].id, 101);
    });

    test('should remove exercise', () => {
        contextStore.registerExercise({ id: 1, title: 'Ex 1' });
        contextStore.registerExercise({ id: 2, title: 'Ex 2' });

        contextStore.removeExercise(1);

        const snapshot = contextStore.snapshot();
        assert.strictEqual(snapshot.allExercises.length, 1);
        assert.strictEqual(snapshot.allExercises[0].id, 2);
    });

    test('should clear active context if removed exercise was active', () => {
        contextStore.registerExercise({ id: 1, title: 'Ex 1' });
        contextStore.setActiveContext({
            type: 'exercise',
            id: 1,
            title: 'Ex 1',
            source: 'user-selected',
            selectedAt: Date.now(),
            locked: false
        });

        contextStore.removeExercise(1);

        const snapshot = contextStore.snapshot();
        assert.strictEqual(snapshot.activeContext, null);
    });

    test('should create session', () => {
        contextStore.setActiveContext({
            type: 'exercise',
            id: 1,
            title: 'Ex 1',
            source: 'user-selected',
            selectedAt: Date.now(),
            locked: false
        });

        contextStore.createSession('Test Session');

        const snapshot = contextStore.snapshot();
        assert.ok(snapshot.activeSession);
        assert.strictEqual(snapshot.activeSession.preview, 'Test Session');
    });

    test('should unlock active context', () => {
        contextStore.setActiveContext({
            type: 'exercise',
            id: 1,
            title: 'Ex 1',
            source: 'workspace-detected',
            selectedAt: Date.now(),
            locked: true
        });

        contextStore.unlockActiveContext();

        const snapshot = contextStore.snapshot();
        assert.ok(snapshot.activeContext);
        assert.strictEqual(snapshot.activeContext.locked, false);
    });

    test('should clear active context', () => {
        contextStore.setActiveContext({
            type: 'exercise',
            id: 1,
            title: 'Ex 1',
            source: 'user-selected',
            selectedAt: Date.now(),
            locked: false
        });

        contextStore.clearActiveContext();

        const snapshot = contextStore.snapshot();
        assert.strictEqual(snapshot.activeContext, null);
    });

    test('should sort recent exercises correctly', () => {
        // Add exercises with different timestamps/priorities
        // Note: registerExercise updates lastViewed implicitly via upsertExercise -> updateRecent
        // But we can't easily control time without mocking Date.now() or sleeping.
        // However, we can register them in order.
        
        contextStore.registerExercise({ id: 1, title: 'Ex 1' });
        contextStore.registerExercise({ id: 2, title: 'Ex 2' });
        contextStore.registerExercise({ id: 3, title: 'Ex 3' });

        // Ex 3 should be most recent
        const snapshot = contextStore.snapshot();
        assert.strictEqual(snapshot.recentExercises[0].id, 3);
        assert.strictEqual(snapshot.recentExercises[1].id, 2);
        assert.strictEqual(snapshot.recentExercises[2].id, 1);
    });
});
