import * as assert from 'assert';
import { ExerciseRegistry } from '../../../src/extension/services/exerciseRegistry';

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

    test('should clear all exercises', () => {
        registry.registerExercise(1, 'Test 1', 'https://git.example.com/test1');
        registry.registerExercise(2, 'Test 2', 'https://git.example.com/test2');

        registry.clear();

        const exercises = registry.getAllExercises();
        assert.strictEqual(exercises.length, 0);
    });

    test('should clear exercises for specific course only', () => {
        registry.registerExercise(1, 'Course1 Ex1', 'https://git.example.com/c1e1', 'c1e1', 100);
        registry.registerExercise(2, 'Course1 Ex2', 'https://git.example.com/c1e2', 'c1e2', 100);
        registry.registerExercise(3, 'Course2 Ex1', 'https://git.example.com/c2e1', 'c2e1', 200);

        registry.clearCourse(100);

        const exercises = registry.getAllExercises();
        assert.strictEqual(exercises.length, 1);
        assert.strictEqual(exercises[0].id, 3);
        assert.strictEqual(exercises[0].courseId, 200);
    });

    test('should replace course exercises when re-registering from fresh course data', () => {
        // Initial registration
        const courseData1 = {
            course: {
                id: 100,
                exercises: [
                    {
                        id: 1,
                        title: 'Exercise 1',
                        studentParticipations: [{ repositoryUri: 'https://git.example.com/ex1' }]
                    },
                    {
                        id: 2,
                        title: 'Exercise 2 (will be deleted)',
                        studentParticipations: [{ repositoryUri: 'https://git.example.com/ex2' }]
                    }
                ]
            }
        };
        registry.registerFromCourseData(courseData1);
        assert.strictEqual(registry.getAllExercises().length, 2);

        // Re-register with fresh data where exercise 2 was deleted on server
        const courseData2 = {
            course: {
                id: 100,
                exercises: [
                    {
                        id: 1,
                        title: 'Exercise 1 (updated title)',
                        studentParticipations: [{ repositoryUri: 'https://git.example.com/ex1' }]
                    }
                ]
            }
        };
        registry.registerFromCourseData(courseData2);

        const exercises = registry.getAllExercises();
        assert.strictEqual(exercises.length, 1);
        assert.strictEqual(exercises[0].id, 1);
        assert.strictEqual(exercises[0].title, 'Exercise 1 (updated title)');
    });
});
