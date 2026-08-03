import * as assert from 'assert';

import type { StoredState } from '@extension/services/iris/context/contextStateTypes';
import { TrackedItemRepository } from '@extension/services/iris/context/trackedItemRepository';

function makeState(): StoredState {
    return {
        version: 3,
        exercises: [],
        courses: [],
    };
}

suite('TrackedItemRepository workspace-flag clear', () => {
    test('clearAllWorkspaceFlags sets isWorkspace=false on every flagged exercise', () => {
        const state = makeState();
        const repo = new TrackedItemRepository(() => state, {
            exerciseArchiveLimit: 20,
            courseArchiveLimit: 20,
        });
        // Upsert A as workspace, then forcibly flag B too — simulating a corrupted
        // multi-flag state that the production code's single-writer invariant
        // normally prevents but that clearAllWorkspaceFlags must still handle.
        repo.upsertExercise({ id: 1, title: 'Alpha', isWorkspace: true });
        repo.upsertExercise({ id: 2, title: 'Beta' });
        state.exercises = state.exercises.map(ex => ({ ...ex, isWorkspace: true }));

        repo.clearAllWorkspaceFlags();

        for (const ex of state.exercises) {
            assert.strictEqual(ex.isWorkspace, false, `exercise ${ex.id} still flagged`);
        }
    });

    test('clearAllWorkspaceFlags is a no-op on an empty repository', () => {
        const state = makeState();
        const repo = new TrackedItemRepository(() => state, {
            exerciseArchiveLimit: 20,
            courseArchiveLimit: 20,
        });
        repo.clearAllWorkspaceFlags();
        assert.deepStrictEqual(state.exercises, []);
    });

    test('clearAllWorkspaceFlags makes getWorkspaceExercise return undefined', () => {
        const state = makeState();
        const repo = new TrackedItemRepository(() => state, {
            exerciseArchiveLimit: 20,
            courseArchiveLimit: 20,
        });
        repo.upsertExercise({ id: 1, title: 'Alpha', isWorkspace: true });
        assert.ok(repo.getWorkspaceExercise(), 'precondition: workspace exercise should exist');
        repo.clearAllWorkspaceFlags();
        assert.strictEqual(repo.getWorkspaceExercise(), undefined);
    });
});
