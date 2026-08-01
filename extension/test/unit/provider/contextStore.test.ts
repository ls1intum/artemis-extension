import * as assert from 'assert';

import { ContextStore } from '@extension/services/iris/context/contextStore';
import { TrackedExercise } from '@extension/types';
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
        assert.strictEqual(snapshot.exercises.length, 0);
        assert.strictEqual(snapshot.courses.length, 0);
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

    test('should remove course', () => {
        contextStore.registerCourse({ id: 101, title: 'C1' });
        contextStore.registerCourse({ id: 102, title: 'C2' });

        contextStore.removeCourse(101);

        const snapshot = contextStore.snapshot();
        assert.strictEqual(snapshot.courses.length, 1);
        assert.strictEqual(snapshot.courses[0].id, 102);
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

    // The two "sorted" tests above lean on insertion order: the repository
    // PREPENDS new items, so a freshly registered list is already in the
    // expected order and a no-op sort would pass them. This one registers in
    // an order the sort has to actually undo, and re-registers an existing
    // item (an UPDATE replaces in place without moving it).
    test('snapshot sorts, it does not just echo insertion order', () => {
        const originalNow = Date.now;
        let t = 1000;
        Date.now = () => t;
        try {
            t = 3000; contextStore.registerExercise({ id: 1, title: 'Ex 1' });
            t = 2000; contextStore.registerExercise({ id: 2, title: 'Ex 2' });
            t = 1000; contextStore.registerExercise({ id: 3, title: 'Ex 3' });
            // Ex 1 is now the OLDEST-viewed but the LAST element of the stored
            // array (prepend order), so insertion order alone gives [3, 2, 1]
            // and lastViewed order gives [1, 2, 3]. They disagree.
            const exercises = contextStore.snapshot().exercises.map(e => e.id);
            assert.deepStrictEqual(exercises, [1, 2, 3], 'exercises must be sorted by lastViewed desc');

            t = 3000; contextStore.registerCourse({ id: 10, title: 'C 10' });
            t = 2000; contextStore.registerCourse({ id: 20, title: 'C 20' });
            t = 1000; contextStore.registerCourse({ id: 30, title: 'C 30' });
            const courses = contextStore.snapshot().courses.map(c => c.id);
            assert.deepStrictEqual(courses, [10, 20, 30], 'courses must be sorted by lastViewed desc');
        } finally {
            Date.now = originalNow;
        }
    });

    test('snapshot hides past-deadline exercises but keeps the workspace one', () => {
        const past = '2020-01-01T00:00:00.000Z';
        const future = new Date(Date.now() + 86400000).toISOString();
        contextStore.registerExercise({ id: 2, title: 'Workspace', dueDate: past, isWorkspace: true });
        contextStore.registerExercise({ id: 3, title: 'PastDeadline', dueDate: past });
        contextStore.registerExercise({ id: 4, title: 'Future', dueDate: future });
        contextStore.registerExercise({ id: 5, title: 'Undated' });

        const snapshot = contextStore.snapshot();
        const ids = snapshot.exercises.map(e => e.id).sort();
        assert.deepStrictEqual(ids, [2, 4, 5], 'past-deadline #3 hidden, others kept');
    });

    // Liam's decision: an overdue exercise the student is demonstrably still
    // talking about stays pickable. Without it the composer chip names a topic
    // the picker cannot show, so the checkmark has nothing to land on.
    test('snapshot keeps a past-deadline exercise when it is the conversation topic', () => {
        const past = '2020-01-01T00:00:00.000Z';
        contextStore.registerExercise({ id: 3, title: 'Overdue topic', dueDate: past });
        contextStore.registerExercise({ id: 4, title: 'Overdue, not the topic', dueDate: past });

        assert.deepStrictEqual(
            contextStore.snapshot().exercises.map(e => e.id), [],
            'precondition: both are hidden with no topic',
        );
        assert.deepStrictEqual(
            contextStore.snapshot(3).exercises.map(e => e.id), [3],
            'only the topic survives the deadline filter',
        );
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
        assert.strictEqual(snapshot.exercises.length, 0);
        assert.strictEqual(snapshot.courses.length, 0);
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
});

suite('ContextStore course title lookup', () => {
    let store: ContextStore;

    setup(() => {
        store = new ContextStore(new MockExtensionContext());
    });

    // The chat header's course line reads this and nothing else. It is an
    // optional wire field, so if the lookup ever stops resolving there is no
    // compile error: the line simply goes blank forever.
    test('getCourseTitle returns the tracked title', () => {
        store.registerCourse({ id: 42, title: 'Algorithms' });
        assert.strictEqual(store.getCourseTitle(42), 'Algorithms');
    });

    test('getCourseTitle returns undefined for an untracked course', () => {
        assert.strictEqual(store.getCourseTitle(999), undefined);
    });
});

suite('ContextStore workspace accessors', () => {
    let store: ContextStore;

    setup(() => {
        store = new ContextStore(new MockExtensionContext());
    });

    test('getWorkspaceExerciseId returns the id of the flagged exercise', () => {
        store.registerExercise({ id: 7, title: 'Ws', isWorkspace: true });
        assert.strictEqual(store.getWorkspaceExerciseId(), 7);
    });

    test('getWorkspaceExerciseId returns undefined when no exercise is flagged', () => {
        store.registerExercise({ id: 8, title: 'NotWs' });
        assert.strictEqual(store.getWorkspaceExerciseId(), undefined);
    });

    test('clearWorkspaceFlag clears the flag', () => {
        store.registerExercise({ id: 9, title: 'Ws', isWorkspace: true });
        assert.ok(store.getWorkspaceExercise(), 'precondition');
        store.clearWorkspaceFlag();
        assert.strictEqual(store.getWorkspaceExercise(), undefined);
    });
});

suite('ContextStore onDidChangeWorkspaceExercise', () => {
    let store: ContextStore;

    setup(() => {
        store = new ContextStore(new MockExtensionContext());
    });

    test('fires when registerExercise sets the workspace flag', () => {
        const fired: Array<TrackedExercise | undefined> = [];
        const sub = store.onDidChangeWorkspaceExercise(ex => fired.push(ex));
        store.registerExercise({ id: 1, title: 'Ws', isWorkspace: true });
        sub.dispose();
        assert.strictEqual(fired.length, 1);
        assert.strictEqual(fired[0]?.id, 1);
    });

    test('does not fire when registering a non-workspace exercise', () => {
        const fired: Array<TrackedExercise | undefined> = [];
        const sub = store.onDidChangeWorkspaceExercise(ex => fired.push(ex));
        store.registerExercise({ id: 2, title: 'Not ws' });
        sub.dispose();
        assert.strictEqual(fired.length, 0);
    });

    test('fires with undefined when clearWorkspaceFlag removes the workspace exercise', () => {
        store.registerExercise({ id: 3, title: 'Ws', isWorkspace: true });
        const fired: Array<TrackedExercise | undefined> = [];
        const sub = store.onDidChangeWorkspaceExercise(ex => fired.push(ex));
        store.clearWorkspaceFlag();
        sub.dispose();
        assert.strictEqual(fired.length, 1);
        assert.strictEqual(fired[0], undefined);
    });

    test('does not fire when clearWorkspaceFlag is called with no workspace exercise set', () => {
        const fired: Array<TrackedExercise | undefined> = [];
        const sub = store.onDidChangeWorkspaceExercise(ex => fired.push(ex));
        store.clearWorkspaceFlag();
        sub.dispose();
        assert.strictEqual(fired.length, 0);
    });
});
