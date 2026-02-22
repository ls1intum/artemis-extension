import * as assert from 'assert';
import {
    ActiveContext,
    TrackedExercise,
    TrackedCourse,
    StoredSession,
    ContextSnapshot,
} from '../../src/models/context';

suite('ActiveContext', () => {
    test('parses complete valid JSON', () => {
        const c = ActiveContext.fromJSON({
            type: 'exercise', id: 1, title: 'Ex1', source: 'user-selected',
            locked: false, selectedAt: 1000, shortName: 'E1', courseId: 10,
        });
        assert.ok(c instanceof ActiveContext);
        assert.strictEqual(c.type, 'exercise');
        assert.strictEqual(c.id, 1);
        assert.strictEqual(c.title, 'Ex1');
        assert.strictEqual(c.source, 'user-selected');
        assert.strictEqual(c.locked, false);
        assert.strictEqual(c.selectedAt, 1000);
        assert.strictEqual(c.shortName, 'E1');
        assert.strictEqual(c.courseId, 10);
    });

    test('handles missing optional fields', () => {
        const c = ActiveContext.fromJSON({
            type: 'course', id: 2, title: 'Course', source: 'workspace-detected',
            locked: true, selectedAt: 2000,
        });
        assert.strictEqual(c.shortName, undefined);
        assert.strictEqual(c.courseId, undefined);
    });

    test('throws on invalid input', () => {
        assert.throws(() => ActiveContext.fromJSON(null), /Invalid/);
        assert.throws(() => ActiveContext.fromJSON(undefined), /Invalid/);
    });
});

suite('TrackedExercise', () => {
    test('parses complete valid JSON', () => {
        const e = TrackedExercise.fromJSON({
            id: 1, title: 'Ex1', priority: 5, lastUpdated: 1000,
            shortName: 'E1', courseId: 10, releaseDate: '2025-01-01',
            dueDate: '2025-02-01', lastViewed: 900, score: 85.5,
            repositoryUri: 'https://example.com/repo.git', isWorkspace: true,
        });
        assert.ok(e instanceof TrackedExercise);
        assert.strictEqual(e.id, 1);
        assert.strictEqual(e.title, 'Ex1');
        assert.strictEqual(e.priority, 5);
        assert.strictEqual(e.lastUpdated, 1000);
        assert.strictEqual(e.shortName, 'E1');
        assert.strictEqual(e.courseId, 10);
        assert.strictEqual(e.releaseDate, '2025-01-01');
        assert.strictEqual(e.dueDate, '2025-02-01');
        assert.strictEqual(e.lastViewed, 900);
        assert.strictEqual(e.score, 85.5);
        assert.strictEqual(e.repositoryUri, 'https://example.com/repo.git');
        assert.strictEqual(e.isWorkspace, true);
    });

    test('handles missing optional fields', () => {
        const e = TrackedExercise.fromJSON({
            id: 1, title: 'Ex1', priority: 1, lastUpdated: 500,
        });
        assert.strictEqual(e.shortName, undefined);
        assert.strictEqual(e.courseId, undefined);
        assert.strictEqual(e.releaseDate, undefined);
        assert.strictEqual(e.dueDate, undefined);
        assert.strictEqual(e.lastViewed, undefined);
        assert.strictEqual(e.score, undefined);
        assert.strictEqual(e.repositoryUri, undefined);
        assert.strictEqual(e.isWorkspace, undefined);
    });

    test('throws on invalid input', () => {
        assert.throws(() => TrackedExercise.fromJSON(null), /Invalid/);
        assert.throws(() => TrackedExercise.fromJSON(undefined), /Invalid/);
    });
});

suite('TrackedCourse', () => {
    test('parses complete valid JSON', () => {
        const c = TrackedCourse.fromJSON({
            id: 1, title: 'CS1', priority: 3, lastUpdated: 1000,
            shortName: 'C1', lastViewed: 900,
        });
        assert.ok(c instanceof TrackedCourse);
        assert.strictEqual(c.id, 1);
        assert.strictEqual(c.title, 'CS1');
        assert.strictEqual(c.priority, 3);
        assert.strictEqual(c.lastUpdated, 1000);
        assert.strictEqual(c.shortName, 'C1');
        assert.strictEqual(c.lastViewed, 900);
    });

    test('handles missing optional fields', () => {
        const c = TrackedCourse.fromJSON({
            id: 1, title: 'CS1', priority: 1, lastUpdated: 500,
        });
        assert.strictEqual(c.shortName, undefined);
        assert.strictEqual(c.lastViewed, undefined);
    });

    test('throws on invalid input', () => {
        assert.throws(() => TrackedCourse.fromJSON(null), /Invalid/);
        assert.throws(() => TrackedCourse.fromJSON(undefined), /Invalid/);
    });
});

suite('StoredSession', () => {
    test('parses complete valid JSON', () => {
        const s = StoredSession.fromJSON({
            id: 'sess-1', contextKey: 'exercise:1', preview: 'Hello...',
            messageCount: 10, createdAt: 1000, lastActivity: 2000,
            artemisSessionId: 42,
        });
        assert.ok(s instanceof StoredSession);
        assert.strictEqual(s.id, 'sess-1');
        assert.strictEqual(s.contextKey, 'exercise:1');
        assert.strictEqual(s.preview, 'Hello...');
        assert.strictEqual(s.messageCount, 10);
        assert.strictEqual(s.createdAt, 1000);
        assert.strictEqual(s.lastActivity, 2000);
        assert.strictEqual(s.artemisSessionId, 42);
    });

    test('handles missing optional artemisSessionId', () => {
        const s = StoredSession.fromJSON({
            id: 'sess-1', contextKey: 'exercise:1', preview: 'Hi',
            messageCount: 1, createdAt: 100, lastActivity: 200,
        });
        assert.strictEqual(s.artemisSessionId, undefined);
    });

    test('throws on invalid input', () => {
        assert.throws(() => StoredSession.fromJSON(null), /Invalid/);
        assert.throws(() => StoredSession.fromJSON(undefined), /Invalid/);
    });
});

suite('ContextSnapshot', () => {
    const sessionData = {
        id: 's1', contextKey: 'ex:1', preview: 'P',
        messageCount: 1, createdAt: 100, lastActivity: 200,
    };
    const exerciseData = { id: 1, title: 'E1', priority: 1, lastUpdated: 100 };
    const courseData = { id: 1, title: 'C1', priority: 1, lastUpdated: 100 };

    test('parses complete valid JSON with nested objects', () => {
        const snap = ContextSnapshot.fromJSON({
            activeContext: {
                type: 'exercise', id: 1, title: 'Ex1',
                source: 'user-selected', locked: false, selectedAt: 1000,
            },
            activeSession: sessionData,
            sessions: [sessionData],
            recentExercises: [exerciseData],
            recentCourses: [courseData],
            allExercises: [exerciseData],
            allCourses: [courseData],
        });
        assert.ok(snap instanceof ContextSnapshot);
        assert.ok(snap.activeContext instanceof ActiveContext);
        assert.strictEqual(snap.activeContext!.id, 1);
        assert.ok(snap.activeSession instanceof StoredSession);
        assert.strictEqual(snap.activeSession!.id, 's1');
        assert.strictEqual(snap.sessions.length, 1);
        assert.ok(snap.sessions[0] instanceof StoredSession);
        assert.strictEqual(snap.recentExercises.length, 1);
        assert.ok(snap.recentExercises[0] instanceof TrackedExercise);
        assert.strictEqual(snap.recentCourses.length, 1);
        assert.ok(snap.recentCourses[0] instanceof TrackedCourse);
        assert.strictEqual(snap.allExercises.length, 1);
        assert.strictEqual(snap.allCourses.length, 1);
    });

    test('handles null activeContext and activeSession', () => {
        const snap = ContextSnapshot.fromJSON({
            activeContext: null,
            activeSession: null,
            sessions: [], recentExercises: [], recentCourses: [],
            allExercises: [], allCourses: [],
        });
        assert.strictEqual(snap.activeContext, null);
        assert.strictEqual(snap.activeSession, null);
    });

    test('defaults arrays to empty when missing', () => {
        const snap = ContextSnapshot.fromJSON({});
        assert.deepStrictEqual(snap.sessions, []);
        assert.deepStrictEqual(snap.recentExercises, []);
        assert.deepStrictEqual(snap.recentCourses, []);
        assert.deepStrictEqual(snap.allExercises, []);
        assert.deepStrictEqual(snap.allCourses, []);
    });

    test('throws on invalid input', () => {
        assert.throws(() => ContextSnapshot.fromJSON(null), /Invalid/);
        assert.throws(() => ContextSnapshot.fromJSON(undefined), /Invalid/);
    });
});
