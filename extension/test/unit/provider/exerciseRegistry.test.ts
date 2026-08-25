import * as assert from 'assert';

import { ExerciseRegistry } from '@extension/services/exerciseRegistry';

suite('ExerciseRegistry Test Suite', () => {
    let registry: ExerciseRegistry;

    setup(() => {
        registry = new ExerciseRegistry();
    });

    test('should register and retrieve exercise', () => {
        registry.registerExercise(1, 'Test Exercise', 'https://git.example.com/test', 'test-ex');

        const exercises = registry.getAllExercises();
        assert.strictEqual(exercises.length, 1);
        assert.strictEqual(exercises[0].id, 1);
        assert.strictEqual(exercises[0].title, 'Test Exercise');
    });

    test('getExerciseIdByParticipation returns exerciseId for registered participation', () => {
        registry.registerExercise(1, 'Ex1', 'https://git.example.com/ex1', 'ex1', 100, 5001);
        assert.strictEqual(registry.getExerciseIdByParticipation(5001), 1);
    });

    test('getExerciseIdByParticipation returns undefined for unknown participation', () => {
        registry.registerExercise(1, 'Ex1', 'https://git.example.com/ex1', 'ex1', 100, 5001);
        assert.strictEqual(registry.getExerciseIdByParticipation(9999), undefined);
    });

    test('getExerciseIdByParticipation returns undefined when exercise registered without participationId', () => {
        registry.registerExercise(1, 'Ex1', 'https://git.example.com/ex1', 'ex1', 100);
        assert.strictEqual(registry.getExerciseIdByParticipation(5001), undefined);
    });

    test('re-registering same exercise with new participationId removes old reverse mapping', () => {
        registry.registerExercise(1, 'Ex1', 'https://git.example.com/ex1', 'ex1', 100, 5001);
        registry.registerExercise(1, 'Ex1', 'https://git.example.com/ex1', 'ex1', 100, 5002);
        assert.strictEqual(registry.getExerciseIdByParticipation(5001), undefined, 'old participation must no longer resolve');
        assert.strictEqual(registry.getExerciseIdByParticipation(5002), 1, 'new participation must resolve');
    });

    test('reset empties the exercises and the participation lookup', () => {
        const registry = new ExerciseRegistry();
        registry.registerExercise(1, 'A', 'https://git/a', 'A', 10, 99);
        registry.reset();
        assert.deepStrictEqual(registry.getAllExercises(), []);
        assert.strictEqual(registry.getExerciseIdByParticipation(99), undefined);
    });

    test('replaceAll installs exactly the given entries and rebuilds the lookup', () => {
        const registry = new ExerciseRegistry();
        registry.registerExercise(1, 'A', 'https://git/a', 'A', 10, 99);
        registry.replaceAll([
            { id: 2, title: 'B', repositoryUri: 'https://git/b', courseId: 11, participationId: 42 },
        ]);
        assert.deepStrictEqual(registry.getAllExercises().map(e => e.id), [2]);
        assert.strictEqual(registry.getExerciseIdByParticipation(42), 2);
        // The previous participation must not answer for an exercise that is gone.
        assert.strictEqual(registry.getExerciseIdByParticipation(99), undefined);
    });
});
