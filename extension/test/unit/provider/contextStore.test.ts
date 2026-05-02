import * as assert from 'assert';
import * as vscode from 'vscode';
import { ContextStore } from '../../../src/extension/services/iris/contextStore';
import { MockExtensionContext } from '../mocks/vscodeMocks';
import { ActiveContext } from '../../../src/extension/types';

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

    test('should not change active context when registering workspace exercise (policy in ChatContextManager)', () => {
        contextStore.registerExercise({
            id: 1,
            title: 'Workspace Exercise',
            source: 'workspace-detected'
        });

        const snapshot = contextStore.snapshot();
        // ContextStore no longer applies workspace override — that's ChatContextManager's job
        assert.strictEqual(snapshot.activeContext, null);
        assert.strictEqual(snapshot.allExercises.length, 1);
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

    test('should load default state if no stored state', () => {
        // Mock globalState.get to return undefined
        mockContext.globalState.get = () => undefined;
        const store = new ContextStore(mockContext);
        const snapshot = store.snapshot();
        assert.strictEqual(snapshot.activeContext, null);
        assert.strictEqual(snapshot.recentExercises.length, 0);
    });

    test('should migrate state from previous version', () => {
        const oldState = {
            version: 0,
            activeContext: { type: 'exercise', id: 1, title: 'Old' },
            recentExercises: [{ id: 1, title: 'Old' }]
        };
        mockContext.globalState.get = () => oldState;

        const store = new ContextStore(mockContext);
        const snapshot = store.snapshot();

        assert.ok(snapshot.activeContext);
        assert.strictEqual(snapshot.activeContext.id, 1);
        // Should have reset sessions
        assert.strictEqual(snapshot.sessions.length, 0);
    });

    test('should not auto-select context when registering exercise (policy in ChatContextManager)', () => {
        contextStore.registerExercise({ id: 1, title: 'Ex 1' });

        const snapshot = contextStore.snapshot();
        // ContextStore no longer auto-selects — that's ChatContextManager's job
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
        assert.strictEqual(snapshot.allCourses.length, 1);
        assert.strictEqual(snapshot.allCourses[0].id, 102);
        // ContextStore no longer auto-selects after removal
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

    test('should create session', () => {
        contextStore.registerExercise({ id: 1, title: 'Ex 1' });
        // Set active context so SessionManager can create sessions
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
        // Set active context so SessionManager can create sessions
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
        // Set active context so SessionManager can create sessions
        contextStore.setActiveContext({
            type: 'exercise',
            id: 1,
            title: 'Ex 1',
            source: 'user-selected',
            selectedAt: Date.now(),
            locked: false
        });

        // Create Session 1
        contextStore.createSession('Session 1');
        const session1Id = contextStore.snapshot().activeSession?.id;
        // Add a message so it's not empty and won't be cleaned up
        contextStore.incrementActiveSessionMessageCount();


        // Create Session 2
        contextStore.createSession('Session 2');
        const session2Id = contextStore.snapshot().activeSession?.id;

        assert.notStrictEqual(session1Id, session2Id);

        if (session1Id) {
            contextStore.switchSession(session1Id);
            assert.strictEqual(contextStore.snapshot().activeSession?.id, session1Id);
        }
    }); test('should clear sessions for context', () => {
        contextStore.registerExercise({ id: 1, title: 'Ex 1' });
        contextStore.createSession('Session 1');

        // Get the key internally used (we know it's exercise:1)
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

        // Manually clear active session to test switch
        contextStore.clearActiveContext();
        // Restore context but no session selected yet (simulated)
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
        // Set active context so SessionManager can create sessions
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
        // Set active context so SessionManager can create sessions
        contextStore.setActiveContext({
            type: 'exercise',
            id: 1,
            title: 'Ex 1',
            source: 'user-selected',
            selectedAt: Date.now(),
            locked: false
        });

        contextStore.createSession('Empty Session');

        // Create another one which will be active
        contextStore.createSession('Active Empty Session');

        // Explicitly call cleanup to remove the previous empty session which is now inactive
        contextStore.cleanupEmptySessions();

        const snapshot = contextStore.snapshot();
        // Should only have the active one, the previous empty one should be gone
        assert.strictEqual(snapshot.sessions.length, 1);
        assert.strictEqual(snapshot.sessions[0].preview, 'Active Empty Session');
    }); test('should set Artemis session ID', () => {
        contextStore.registerExercise({ id: 1, title: 'Ex 1' });
        // Set active context so SessionManager can create sessions
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

    test('should calculate exercise priority correctly', () => {
        const now = Date.now();
        const day = 24 * 60 * 60 * 1000;

        // Workspace exercise
        contextStore.registerExercise({ id: 1, title: 'Workspace', isWorkspace: true });
        let snapshot = contextStore.snapshot();
        assert.ok(snapshot.allExercises[0].priority >= 1000);

        // Recent release
        contextStore.registerExercise({
            id: 2,
            title: 'Recent Release',
            releaseDate: new Date(now - day).toISOString()
        });
        snapshot = contextStore.snapshot();
        const ex2 = snapshot.allExercises.find(e => e.id === 2);
        assert.ok((ex2?.priority ?? 0) >= 100);

        // Due soon
        contextStore.registerExercise({
            id: 3,
            title: 'Due Soon',
            dueDate: new Date(now + day).toISOString()
        });
        snapshot = contextStore.snapshot();
        const ex3 = snapshot.allExercises.find(e => e.id === 3);
        assert.ok((ex3?.priority ?? 0) >= 170);

        // Completed (score 100)
        contextStore.registerExercise({
            id: 4,
            title: 'Completed',
            score: 100
        });
        snapshot = contextStore.snapshot();
        const ex4 = snapshot.allExercises.find(e => e.id === 4);
        assert.ok((ex4?.priority ?? 0) < 0);
    });

    test('should calculate course priority correctly', () => {
        const now = Date.now();

        // Recently viewed
        contextStore.registerCourse({ id: 101, title: 'Recent Course' });
        // Registering updates lastViewed

        const snapshot = contextStore.snapshot();
        const course = snapshot.allCourses[0];
        assert.ok(course.priority >= 100);
    });

    test('should trim exercise history', () => {
        // Default limit is 5 recent exercises
        for (let i = 1; i <= 10; i++) {
            contextStore.registerExercise({ id: i, title: `Ex ${i}` });
        }

        const snapshot = contextStore.snapshot();
        assert.strictEqual(snapshot.recentExercises.length, 5);
        // Should keep the most recent ones (higher IDs in this loop)
        assert.ok(snapshot.recentExercises.some(e => e.id === 10));
        assert.ok(!snapshot.recentExercises.some(e => e.id === 1));
    });

    test('should trim course history', () => {
        // Default limit is 3 recent courses
        for (let i = 1; i <= 5; i++) {
            contextStore.registerCourse({ id: i, title: `Course ${i}` });
        }

        const snapshot = contextStore.snapshot();
        assert.strictEqual(snapshot.recentCourses.length, 3);
        assert.ok(snapshot.recentCourses.some(c => c.id === 5));
    });

    test('should trim all exercises history', function () {
        this.timeout(5000); // Increase timeout for this test
        // Limit is 1000
        const limit = 1000;
        for (let i = 1; i <= limit + 5; i++) {
            contextStore.registerExercise({ id: i, title: `Ex ${i}` });
        }

        const snapshot = contextStore.snapshot();
        assert.strictEqual(snapshot.allExercises.length, limit);
        // Should keep the most recent ones (higher IDs)
        assert.ok(snapshot.allExercises.some(e => e.id === limit + 5));
        assert.ok(!snapshot.allExercises.some(e => e.id === 1));
    }); test('should trim all courses history', () => {
        // Limit is 400
        const limit = 400;
        for (let i = 1; i <= limit + 5; i++) {
            contextStore.registerCourse({ id: i, title: `Course ${i}` });
        }

        const snapshot = contextStore.snapshot();
        assert.strictEqual(snapshot.allCourses.length, limit);
        assert.ok(snapshot.allCourses.some(c => c.id === limit + 5));
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

        // Create two sessions with different timestamps
        const now = Date.now();
        contextStore.createSessionWithDetails('Old Session', 1, now - 10000);
        contextStore.createSessionWithDetails('New Session', 1, now);

        // Clear and re-set — no auto session selection
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
        // setActiveContext no longer calls ensureSessionForActive
        // activeSession falls back to first in list (sorted by lastActivity in snapshot())
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
        assert.ok(persisted.value.allExercises.some((ex: any) => ex.id === 500));
    });

    test('should handle session operations with no active context', () => {
        contextStore.clearActiveContext();

        // Should not throw and return snapshot
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
        // registerExercise creates a session, let's clear it
        contextStore.clearAllSessions();

        // Now we have active context but no sessions
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
        // Should remain on initial session
        assert.strictEqual(snapshot.activeSession?.id, initialSessionId);
    });

    // ── New tests (Task 0 — lock invariants before refactor) ──────────

    test('should clear active context on removeExercise even when id is absent from tracked lists', () => {
        // Set active context for an exercise that was never registered in any tracked list
        contextStore.setActiveContext({
            type: 'exercise',
            id: 999,
            title: 'Phantom Exercise',
            source: 'user-selected',
            selectedAt: 0,
            locked: false,
        });

        // Confirm the id is not in any tracked list
        const before = contextStore.snapshot();
        assert.strictEqual(before.allExercises.find(e => e.id === 999), undefined);
        assert.strictEqual(before.recentExercises.find(e => e.id === 999), undefined);

        // Subscribe spy before triggering removal
        let firedCount = 0;
        let firedEvent: { current: ActiveContext | null; previous: ActiveContext | null } | undefined;
        contextStore.onDidChangeActiveContext(event => {
            firedCount++;
            firedEvent = event;
        });

        contextStore.removeExercise(999);

        assert.strictEqual(contextStore.getActiveContext(), null, 'getActiveContext() must return null');
        assert.strictEqual(firedCount, 1, 'onDidChangeActiveContext must fire exactly once');
        assert.strictEqual(firedEvent?.current, null);
        assert.strictEqual(firedEvent?.previous?.id, 999);
        assert.strictEqual(firedEvent?.previous?.type, 'exercise');

        const after = contextStore.snapshot();
        assert.strictEqual(after.allExercises.length, 0);
        assert.strictEqual(after.recentExercises.length, 0);
    });

    test('should clear active context on removeCourse even when id is absent from tracked lists', () => {
        // Set active context for a course that was never registered in any tracked list
        contextStore.setActiveContext({
            type: 'course',
            id: 999,
            title: 'Phantom Course',
            source: 'user-selected',
            selectedAt: 0,
            locked: false,
        });

        // Confirm the id is not in any tracked list
        const before = contextStore.snapshot();
        assert.strictEqual(before.allCourses.find(c => c.id === 999), undefined);
        assert.strictEqual(before.recentCourses.find(c => c.id === 999), undefined);

        let firedCount = 0;
        let firedEvent: { current: ActiveContext | null; previous: ActiveContext | null } | undefined;
        contextStore.onDidChangeActiveContext(event => {
            firedCount++;
            firedEvent = event;
        });

        contextStore.removeCourse(999);

        assert.strictEqual(contextStore.getActiveContext(), null, 'getActiveContext() must return null');
        assert.strictEqual(firedCount, 1, 'onDidChangeActiveContext must fire exactly once');
        assert.strictEqual(firedEvent?.current, null);
        assert.strictEqual(firedEvent?.previous?.id, 999);
        assert.strictEqual(firedEvent?.previous?.type, 'course');

        const after = contextStore.snapshot();
        assert.strictEqual(after.allCourses.length, 0);
        assert.strictEqual(after.recentCourses.length, 0);
    });

    test('should preserve sessions and activeSessionId from previous-version stored state via migration', () => {
        // Pre-populate globalState with a version-mismatched StoredState that carries sessions
        const storedSession = {
            id: 'sess-A',
            contextKey: 'exercise:123',
            preview: 'hi',
            messageCount: 0,
            createdAt: 1700000000000,
            lastActivity: 1700000000000,
        };
        const oldState = {
            version: 0,  // != STORE_VERSION (1), triggers migrateState()
            activeContext: {
                type: 'exercise' as const,
                id: 123,
                title: 'Migrated Exercise',
                source: 'user-selected' as const,
                locked: false,
                selectedAt: 1700000000000,
            },
            activeSessionId: 'sess-A',
            sessions: { 'exercise:123': [storedSession] },
            recentExercises: [],
            recentCourses: [],
            allExercises: [],
            allCourses: [],
        };

        mockContext.globalState.get = () => oldState as any;

        const store = new ContextStore(mockContext);
        const snap = store.snapshot();

        // Migration must preserve both sessions map and activeSessionId
        assert.ok(snap.sessions.length > 0, 'migrated sessions array must be non-empty');
        assert.ok(snap.activeSession !== null, 'migrated activeSession must not be null');
        assert.strictEqual(snap.activeSession?.id, 'sess-A', 'activeSessionId from migration must resolve to the stored session');
    });

    test('should calculate exercise priority with time-based rules', () => {
        // Mock Date.now
        const originalNow = Date.now;
        let currentTime = 1000000000000; // Fixed start time
        Date.now = () => currentTime;

        try {
            // 1. Workspace exercise (+1000) + Recent View (+50) = 1050
            contextStore.registerExercise({ id: 1, title: 'Workspace', isWorkspace: true });
            let snapshot = contextStore.snapshot();
            const ex1 = snapshot.allExercises.find(e => e.id === 1);
            assert.strictEqual(ex1?.priority, 1050);

            // 2. Release date within 7 days (+100) + Recent View (+50) + Release Date Bonus (timestamp/...)
            // Release date bonus is Math.floor(releaseTime / msPerDay / 1000) which is small but non-zero.
            // Let's calculate expected bonus.
            const msPerDay = 24 * 60 * 60 * 1000;
            const releaseDate = new Date(currentTime - msPerDay).toISOString(); // 1 day ago
            const releaseTime = new Date(releaseDate).getTime();
            const releaseBonus = Math.floor(releaseTime / msPerDay / 1000);

            contextStore.registerExercise({ id: 2, title: 'Released', releaseDate });
            snapshot = contextStore.snapshot();
            const ex2 = snapshot.allExercises.find(e => e.id === 2);
            // 100 (recent release) + 50 (recent view) + releaseBonus
            assert.strictEqual(ex2?.priority, 150 + releaseBonus);

            // 3. Due date within 7 days
            // Formula: Math.max(200 - Math.floor(daysUntilDue * 30 / 7), 170)
            // Let's say due in 1 day.
            const dueDate = new Date(currentTime + msPerDay).toISOString();
            const daysUntilDue = 1;
            const dueBonus = Math.max(200 - Math.floor(daysUntilDue * 30 / 7), 170); // 200 - 4 = 196

            contextStore.registerExercise({ id: 3, title: 'Due', dueDate });
            snapshot = contextStore.snapshot();
            const ex3 = snapshot.allExercises.find(e => e.id === 3);
            // dueBonus + 50 (recent view)
            assert.strictEqual(ex3?.priority, dueBonus + 50);

            // 4. Completed exercise (score 100) -> -100 penalty
            contextStore.registerExercise({ id: 4, title: 'Done', score: 100 });
            snapshot = contextStore.snapshot();
            const ex4 = snapshot.allExercises.find(e => e.id === 4);
            // 50 (recent view) - 100 = -50
            assert.strictEqual(ex4?.priority, -50);

            // 5. Old view (> 24 hours)
            // Advance time by 25 hours
            currentTime += 25 * 60 * 60 * 1000;

            // Trigger recalculation by registering a new exercise
            contextStore.registerExercise({ id: 5, title: 'New' });

            snapshot = contextStore.snapshot();
            // Ex 1 (Workspace) should lose recent view bonus: 1000
            // Note: recalculateExercisePriorities only updates recentExercises
            assert.strictEqual(snapshot.recentExercises.find(e => e.id === 1)?.priority, 1000);

            // Ex 4 (Done) should lose recent view bonus: -100
            assert.strictEqual(snapshot.recentExercises.find(e => e.id === 4)?.priority, -100);

        } finally {
            Date.now = originalNow;
        }
    });
});
