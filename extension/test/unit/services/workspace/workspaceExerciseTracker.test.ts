import * as assert from 'assert';

import { WorkspaceExerciseTracker } from '@extension/services/workspace/workspaceExerciseTracker';

suite('WorkspaceExerciseTracker', () => {
    test('reports the current exercise and its id', () => {
        const tracker = new WorkspaceExerciseTracker();
        assert.strictEqual(tracker.exerciseId, undefined);
        tracker.set({ id: 5, title: 'E', courseId: 9 });
        assert.strictEqual(tracker.exerciseId, 5);
        assert.strictEqual(tracker.current?.courseId, 9);
    });

    test('fires only when the exercise id changes', () => {
        const tracker = new WorkspaceExerciseTracker();
        const seen: Array<number | undefined> = [];
        tracker.onDidChange(e => seen.push(e?.id));
        tracker.set({ id: 5, title: 'E', courseId: 9 });
        tracker.set({ id: 5, title: 'E renamed', courseId: 9 });
        tracker.clear();
        tracker.clear();
        assert.deepStrictEqual(seen, [5, undefined]);
    });

    test('a later set still carries the newer title', () => {
        const tracker = new WorkspaceExerciseTracker();
        tracker.set({ id: 5, title: 'E', courseId: 9 });
        tracker.set({ id: 5, title: 'E renamed', courseId: 9 });
        assert.strictEqual(tracker.current?.title, 'E renamed');
    });
});
