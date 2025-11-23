import * as assert from 'assert';
import { ExerciseRegistry } from '../../src/provider/exerciseRegistry';

suite('ExerciseRegistry Test Suite', () => {
    let registry: ExerciseRegistry;

    setup(() => {
        // Reset singleton for each test
        (ExerciseRegistry as any).instance = undefined;
        registry = ExerciseRegistry.getInstance();
    });

    test('should register and retrieve exercise', () => {
        registry.registerExercise(1, 'Test Exercise', 'https://git.example.com/test', 'test-ex');
        
        const exercise = registry.findByRepositoryUrl('https://git.example.com/test');
        assert.ok(exercise);
        assert.strictEqual(exercise.id, 1);
        assert.strictEqual(exercise.title, 'Test Exercise');
    });

    test('should register from course data', () => {
        const courseData = {
            course: {
                exercises: [
                    {
                        id: 1,
                        title: 'Exercise 1',
                        shortName: 'ex1',
                        studentParticipations: [{ repositoryUri: 'https://git.example.com/ex1' }]
                    },
                    {
                        id: 2,
                        title: 'Exercise 2',
                        studentParticipations: [] // No repo - should skip
                    }
                ]
            }
        };

        registry.registerFromCourseData(courseData);

        const exercises = registry.getAllExercises();
        assert.strictEqual(exercises.length, 1); // Only ex1 should be registered
        assert.strictEqual(exercises[0].id, 1);
        assert.strictEqual(exercises[0].title, 'Exercise 1');
    });

    test('should return singleton instance', () => {
        const instance1 = ExerciseRegistry.getInstance();
        const instance2 = ExerciseRegistry.getInstance();
        assert.strictEqual(instance1, instance2);
    });

    test('should find exercise by repository URI', () => {
        registry.registerExercise(1, 'Test', 'https://git.example.com/test');
        
        const found = registry.findByRepositoryUrl('https://git.example.com/test');
        assert.ok(found);
        assert.strictEqual(found.id, 1);

        const notFound = registry.findByRepositoryUrl('https://git.example.com/nonexistent');
        assert.strictEqual(notFound, null);
    });

    test('should normalize repository URLs', () => {
        registry.registerExercise(1, 'Test', 'https://git.example.com/test.git');
        
        // Should find with different URL formats
        const found1 = registry.findByRepositoryUrl('https://git.example.com/test');
        const found2 = registry.findByRepositoryUrl('git@git.example.com:test.git');
        
        assert.ok(found1);
        assert.ok(found2);
        assert.strictEqual(found1.id, 1);
        assert.strictEqual(found2.id, 1);
    });

    test('should clear all exercises', () => {
        registry.registerExercise(1, 'Test 1', 'https://git.example.com/test1');
        registry.registerExercise(2, 'Test 2', 'https://git.example.com/test2');
        
        registry.clear();
        
        const exercises = registry.getAllExercises();
        assert.strictEqual(exercises.length, 0);
    });
});
