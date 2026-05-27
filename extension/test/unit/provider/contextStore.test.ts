import * as assert from 'assert';

import { ContextStore } from '@extension/services/iris/context/contextStore';
import { ActiveContext } from '@extension/types';
import { MockExtensionContext } from '@test/unit/mocks/vscodeMocks';

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
        assert.strictEqual(snapshot.exercises.length, 0);
    });

    test('should register exercise', () => {
        contextStore.registerExercise({
            id: 1,
            title: 'Test Exercise',
            source: 'user-selected'
        });

        const snapshot = contextStore.snapshot();
        assert.strictEqual(snapshot.exercises.length, 1);
        assert.strictEqual(snapshot.exercises[0].id, 1);
    });

    test('should not change active context when registering workspace exercise (policy in ChatContextManager)', () => {
        contextStore.registerExercise({
            id: 1,
            title: 'Workspace Exercise',
            source: 'workspace-detected'
        });

        const snapshot = contextStore.snapshot();
        assert.strictEqual(snapshot.activeContext, null);
        assert.strictEqual(snapshot.exercises.length, 1);
    });

    test('should register course', () => {
        contextStore.registerCourse({
            id: 101,
            title: 'Test Course',
            source: 'user-selected'
        });

        const snapshot = contextStore.snapshot();
        assert.strictEqual(snapshot.courses.length, 1);
        assert.strictEqual(snapshot.courses[0].id, 101);
    });

    test('should remove exercise', () => {
        contextStore.registerExercise({ id: 1, title: 'Ex 1' });
        contextStore.registerExercise({ id: 2, title: 'Ex 2' });

        contextStore.removeExercise(1);

        const snapshot = contextStore.snapshot();
        assert.strictEqual(snapshot.exercises.length, 1);
        assert.strictEqual(snapshot.exercises[0].id, 2);
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

    test('snapshot exercises sorted: most recently registered first', () => {
        const originalNow = Date.now;
        let t = 1000;
        Date.now = () => t;
        try {
            t = 1000; contextStore.registerExercise({ id: 1, title: 'Ex 1' });
            t = 2000; contextStore.registerExercise({ id: 2, title: 'Ex 2' });
            t = 3000; contextStore.registerExercise({ id: 3, title: 'Ex 3' });

            const snapshot = contextStore.snapshot();
            assert.strictEqual(snapshot.exercises[0].id, 3);
            assert.strictEqual(snapshot.exercises[1].id, 2);
            assert.strictEqual(snapshot.exercises[2].id, 1);
        } finally {
            Date.now = originalNow;
        }
    });

    test('snapshot exercises sorted: workspace first regardless of recency', () => {
        contextStore.registerExercise({ id: 1, title: 'Charlie' });
        contextStore.registerExercise({ id: 2, title: 'Alpha' });
        contextStore.registerExercise({ id: 3, title: 'Bravo', isWorkspace: true });

        const snapshot = contextStore.snapshot();
        assert.strictEqual(snapshot.exercises[0].id, 3, 'workspace exercise must come first');
    });

    test('snapshot hides past-deadline exercises but keeps workspace and active', () => {
        const past = '2020-01-01T00:00:00.000Z';
        const future = new Date(Date.now() + 86400000).toISOString();
        contextStore.registerExercise({ id: 1, title: 'Active', dueDate: past });
        contextStore.setActiveContext({
            type: 'exercise', id: 1, title: 'Active',
            source: 'user-selected', locked: false, selectedAt: Date.now(),
        });
        contextStore.registerExercise({ id: 2, title: 'Workspace', dueDate: past, isWorkspace: true });
        contextStore.registerExercise({ id: 3, title: 'PastDeadline', dueDate: past });
        contextStore.registerExercise({ id: 4, title: 'Future', dueDate: future });
        contextStore.registerExercise({ id: 5, title: 'Undated' });

        const snapshot = contextStore.snapshot();
        const ids = snapshot.exercises.map(e => e.id).sort();
        assert.deepStrictEqual(ids, [1, 2, 4, 5], 'past-deadline #3 hidden, others kept');
    });

    test('snapshot keeps exercise with malformed dueDate (treated as no deadline)', () => {
        contextStore.registerExercise({ id: 9, title: 'Junk', dueDate: 'not-a-date' });
        const snapshot = contextStore.snapshot();
        assert.notStrictEqual(snapshot.exercises.find(e => e.id === 9), undefined);
    });

    test('should load default state if no stored state', () => {
        mockContext.globalState.get = () => undefined;
        const store = new ContextStore(mockContext);
        const snapshot = store.snapshot();
        assert.strictEqual(snapshot.activeContext, null);
        assert.strictEqual(snapshot.exercises.length, 0);
    });

    test('should not auto-select context when registering exercise (policy in ChatContextManager)', () => {
        contextStore.registerExercise({ id: 1, title: 'Ex 1' });

        const snapshot = contextStore.snapshot();
        assert.strictEqual(snapshot.activeContext, null);
    });

    test('should not auto-select context when registering course (policy in ChatContextManager)', () => {
        contextStore.registerCourse({ id: 101, title: 'Course 1' });

        const snapshot = contextStore.snapshot();
        assert.strictEqual(snapshot.activeContext, null);
    });

    test('should remove course', () => {
        contextStore.registerCourse({ id: 101, title: 'C1' });
        contextStore.registerCourse({ id: 102, title: 'C2' });

        contextStore.removeCourse(101);

        const snapshot = contextStore.snapshot();
        assert.strictEqual(snapshot.courses.length, 1);
        assert.strictEqual(snapshot.courses[0].id, 102);
        assert.strictEqual(snapshot.activeContext, null);
    });

    test('should clear active context if removed course was active', () => {
        contextStore.registerCourse({ id: 101, title: 'C1' });
        contextStore.setActiveContext({
            type: 'course',
            id: 101,
            title: 'C1',
            source: 'user-selected',
            selectedAt: Date.now(),
            locked: false
        });

        contextStore.removeCourse(101);

        const snapshot = contextStore.snapshot();
        assert.strictEqual(snapshot.activeContext, null);
    });

    test('should create session with active context', () => {
        contextStore.registerExercise({ id: 1, title: 'Ex 1' });
        contextStore.setActiveContext({
            type: 'exercise',
            id: 1,
            title: 'Ex 1',
            source: 'user-selected',
            selectedAt: Date.now(),
            locked: false
        });
        const initialSessionCount = contextStore.snapshot().sessions.length;

        contextStore.createSession('New Session');

        const snapshot = contextStore.snapshot();
        assert.strictEqual(snapshot.sessions.length, initialSessionCount + 1);
        assert.strictEqual(snapshot.sessions[0].preview, 'New Session');
        assert.strictEqual(snapshot.activeSession?.id, snapshot.sessions[0].id);
    });

    test('should not create session if no active context', () => {
        contextStore.createSession();
        const snapshot = contextStore.snapshot();
        assert.strictEqual(snapshot.sessions.length, 0);
    });

    test('should create session with details', () => {
        contextStore.registerExercise({ id: 1, title: 'Ex 1' });
        contextStore.setActiveContext({
            type: 'exercise',
            id: 1,
            title: 'Ex 1',
            source: 'user-selected',
            selectedAt: Date.now(),
            locked: false
        });
        const initialSessionCount = contextStore.snapshot().sessions.length;

        const now = Date.now();
        contextStore.createSessionWithDetails('Detailed Session', 5, now, 123);

        const snapshot = contextStore.snapshot();
        assert.strictEqual(snapshot.sessions.length, initialSessionCount + 1);
        assert.strictEqual(snapshot.sessions[0].messageCount, 5);
        assert.strictEqual(snapshot.sessions[0].artemisSessionId, 123);
    });

    test('should switch session', () => {
        contextStore.registerExercise({ id: 1, title: 'Ex 1' });
        contextStore.setActiveContext({
            type: 'exercise',
            id: 1,
            title: 'Ex 1',
            source: 'user-selected',
            selectedAt: Date.now(),
            locked: false
        });

        contextStore.createSession('Session 1');
        const session1Id = contextStore.snapshot().activeSession?.id;
        contextStore.incrementActiveSessionMessageCount();

        contextStore.createSession('Session 2');
        const session2Id = contextStore.snapshot().activeSession?.id;

        assert.notStrictEqual(session1Id, session2Id);

        if (session1Id) {
            contextStore.switchSession(session1Id);
            assert.strictEqual(contextStore.snapshot().activeSession?.id, session1Id);
        }
    });

    test('should clear sessions for context', () => {
        contextStore.registerExercise({ id: 1, title: 'Ex 1' });
        contextStore.createSession('Session 1');

        const key = 'exercise:1';
        contextStore.clearSessionsForContext(key);

        const snapshot = contextStore.snapshot();
        assert.strictEqual(snapshot.sessions.length, 0);
        assert.strictEqual(snapshot.activeSession, null);
    });

    test('should clear sessions for course context key', () => {
        contextStore.registerCourse({ id: 42, title: 'Course' });
        contextStore.setActiveContext({
            type: 'course',
            id: 42,
            title: 'Course',
            source: 'user-selected',
            selectedAt: Date.now(),
            locked: false
        });

        contextStore.createSession('Course Session');
        const snapshotBefore = contextStore.snapshot();
        assert.ok(snapshotBefore.activeSession);
        assert.strictEqual(snapshotBefore.sessions[0].contextKey, 'course:42');

        contextStore.clearSessionsForContext('course:42');
        const snapshotAfter = contextStore.snapshot();
        assert.strictEqual(snapshotAfter.sessions.length, 0);
        assert.strictEqual(snapshotAfter.activeSession, null);
    });

    test('should switch to first session', () => {
        contextStore.setActiveContext({
            type: 'exercise',
            id: 1,
            title: 'Ex 1',
            source: 'user-selected',
            selectedAt: Date.now(),
            locked: false
        });
        contextStore.createSession('Session 1');
        contextStore.createSession('Session 2');

        contextStore.clearActiveContext();
        contextStore.setActiveContext({
            type: 'exercise',
            id: 1,
            title: 'Ex 1',
            source: 'user-selected',
            selectedAt: Date.now(),
            locked: false
        });

        contextStore.switchToFirstSession();

        const snapshot = contextStore.snapshot();
        assert.ok(snapshot.activeSession);
    });

    test('should increment active session message count', () => {
        contextStore.registerExercise({ id: 1, title: 'Ex 1' });
        contextStore.setActiveContext({
            type: 'exercise',
            id: 1,
            title: 'Ex 1',
            source: 'user-selected',
            selectedAt: Date.now(),
            locked: false
        });
        contextStore.createSession('Session 1');

        contextStore.incrementActiveSessionMessageCount();

        const snapshot = contextStore.snapshot();
        assert.strictEqual(snapshot.activeSession?.messageCount, 1);
    });

    test('should cleanup empty sessions', () => {
        contextStore.registerExercise({ id: 1, title: 'Ex 1' });
        contextStore.setActiveContext({
            type: 'exercise',
            id: 1,
            title: 'Ex 1',
            source: 'user-selected',
            selectedAt: Date.now(),
            locked: false
        });

        contextStore.createSession('Empty Session');
        contextStore.createSession('Active Empty Session');

        contextStore.cleanupEmptySessions();

        const snapshot = contextStore.snapshot();
        assert.strictEqual(snapshot.sessions.length, 1);
        assert.strictEqual(snapshot.sessions[0].preview, 'Active Empty Session');
    });

    test('should set Artemis session ID', () => {
        contextStore.registerExercise({ id: 1, title: 'Ex 1' });
        contextStore.setActiveContext({
            type: 'exercise',
            id: 1,
            title: 'Ex 1',
            source: 'user-selected',
            selectedAt: Date.now(),
            locked: false
        });
        contextStore.createSession('Session 1');

        contextStore.setArtemisSessionId(999);

        const snapshot = contextStore.snapshot();
        assert.strictEqual(snapshot.activeSession?.artemisSessionId, 999);
    });

    test('should clear all sessions', () => {
        contextStore.registerExercise({ id: 1, title: 'Ex 1' });
        contextStore.createSession('Session 1');

        contextStore.clearAllSessions();

        const snapshot = contextStore.snapshot();
        assert.strictEqual(snapshot.sessions.length, 0);
        assert.strictEqual(snapshot.activeSession, null);
    });

    test('should trim exercises beyond archive cap', function () {
        this.timeout(5000);
        const originalNow = Date.now;
        let t = 1000000;
        Date.now = () => t++;
        try {
            const limit = 1000;
            for (let i = 1; i <= limit + 5; i++) {
                contextStore.registerExercise({ id: i, title: `Ex ${i}` });
            }
            const snapshot = contextStore.snapshot();
            assert.strictEqual(snapshot.exercises.length, limit);
            assert.ok(snapshot.exercises.some(e => e.id === limit + 5), 'most recent kept');
            assert.ok(!snapshot.exercises.some(e => e.id === 1), 'oldest dropped');
        } finally {
            Date.now = originalNow;
        }
    });

    test('should trim courses beyond archive cap', () => {
        const limit = 400;
        for (let i = 1; i <= limit + 5; i++) {
            contextStore.registerCourse({ id: i, title: `Course ${i}` });
        }

        const snapshot = contextStore.snapshot();
        assert.strictEqual(snapshot.courses.length, limit);
        assert.ok(snapshot.courses.some(c => c.id === limit + 5));
    });

    test('should not auto-select session when setting active context (ensureSession removed)', () => {
        contextStore.setActiveContext({
            type: 'exercise',
            id: 1,
            title: 'Ex 1',
            source: 'user-selected',
            selectedAt: Date.now(),
            locked: false
        });

        const now = Date.now();
        contextStore.createSessionWithDetails('Old Session', 1, now - 10000);
        contextStore.createSessionWithDetails('New Session', 1, now);

        contextStore.clearActiveContext();
        contextStore.setActiveContext({
            type: 'exercise',
            id: 1,
            title: 'Ex 1',
            source: 'user-selected',
            selectedAt: Date.now(),
            locked: false
        });

        const snapshot = contextStore.snapshot();
        assert.ok(snapshot.sessions.length >= 2);
    });

    test('should persist state changes to global storage', () => {
        let persisted: any;
        mockContext.globalState.update = async (key: string, value: any) => {
            persisted = { key, value };
        };

        const store = new ContextStore(mockContext);
        store.registerExercise({ id: 500, title: 'Persisted Exercise' });

        assert.strictEqual(persisted.key, 'iris.contextStore');
        assert.ok(persisted.value.exercises.some((ex: any) => ex.id === 500));
    });

    test('should handle session operations with no active context', () => {
        contextStore.clearActiveContext();

        contextStore.switchSession('any');
        contextStore.switchToFirstSession();
        contextStore.incrementActiveSessionMessageCount();
        contextStore.cleanupEmptySessions();
        contextStore.setArtemisSessionId(123);

        const snapshot = contextStore.snapshot();
        assert.strictEqual(snapshot.activeContext, null);
    });

    test('should handle session operations with no sessions', () => {
        contextStore.registerExercise({ id: 1, title: 'Ex 1' });
        contextStore.clearAllSessions();

        contextStore.incrementActiveSessionMessageCount();
        contextStore.cleanupEmptySessions();
        contextStore.setArtemisSessionId(123);
        contextStore.switchToFirstSession();

        const snapshot = contextStore.snapshot();
        assert.strictEqual(snapshot.sessions.length, 0);
    });

    test('should handle switchSession with non-existent session', () => {
        contextStore.registerExercise({ id: 1, title: 'Ex 1' });
        const initialSessionId = contextStore.snapshot().activeSession?.id;

        contextStore.switchSession('non-existent-id');

        const snapshot = contextStore.snapshot();
        assert.strictEqual(snapshot.activeSession?.id, initialSessionId);
    });

    test('should clear active context on removeExercise even when id is absent from tracked lists', () => {
        contextStore.setActiveContext({
            type: 'exercise',
            id: 999,
            title: 'Phantom Exercise',
            source: 'user-selected',
            selectedAt: 0,
            locked: false,
        });

        const before = contextStore.snapshot();
        assert.strictEqual(before.exercises.find(e => e.id === 999), undefined);

        let firedCount = 0;
        let firedEvent: { current: ActiveContext | null; previous: ActiveContext | null } | undefined;
        contextStore.onDidChangeActiveContext(event => {
            firedCount++;
            firedEvent = event;
        });

        contextStore.removeExercise(999);

        assert.strictEqual(contextStore.getActiveContext(), null);
        assert.strictEqual(firedCount, 1);
        assert.strictEqual(firedEvent?.current, null);
        assert.strictEqual(firedEvent?.previous?.id, 999);
        assert.strictEqual(firedEvent?.previous?.type, 'exercise');

        const after = contextStore.snapshot();
        assert.strictEqual(after.exercises.length, 0);
    });

    test('should clear active context on removeCourse even when id is absent from tracked lists', () => {
        contextStore.setActiveContext({
            type: 'course',
            id: 999,
            title: 'Phantom Course',
            source: 'user-selected',
            selectedAt: 0,
            locked: false,
        });

        const before = contextStore.snapshot();
        assert.strictEqual(before.courses.find(c => c.id === 999), undefined);

        let firedCount = 0;
        let firedEvent: { current: ActiveContext | null; previous: ActiveContext | null } | undefined;
        contextStore.onDidChangeActiveContext(event => {
            firedCount++;
            firedEvent = event;
        });

        contextStore.removeCourse(999);

        assert.strictEqual(contextStore.getActiveContext(), null);
        assert.strictEqual(firedCount, 1);
        assert.strictEqual(firedEvent?.current, null);
        assert.strictEqual(firedEvent?.previous?.id, 999);
        assert.strictEqual(firedEvent?.previous?.type, 'course');

        const after = contextStore.snapshot();
        assert.strictEqual(after.courses.length, 0);
    });
});
