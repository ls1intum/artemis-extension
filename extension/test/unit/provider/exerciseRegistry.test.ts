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

    // --- participationId reverse-lookup (NEW-2 fix) ---

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

    test('clearCourse removes participation reverse mappings for that course', () => {
        registry.registerExercise(1, 'Ex1', 'https://git.example.com/ex1', 'ex1', 100, 5001);
        registry.registerExercise(2, 'Ex2', 'https://git.example.com/ex2', 'ex2', 200, 5002);
        registry.clearCourse(100);
        assert.strictEqual(registry.getExerciseIdByParticipation(5001), undefined, 'cleared course participation must not resolve');
        assert.strictEqual(registry.getExerciseIdByParticipation(5002), 2, 'other course participation must still resolve');
    });

    test('registerFromCourseData extracts participationId from studentParticipations', () => {
        const courseData = {
            course: {
                id: 100,
                exercises: [
                    {
                        id: 1,
                        title: 'Ex1',
                        studentParticipations: [{ id: 5001, repositoryUri: 'https://git.example.com/ex1' }]
                    }
                ]
            }
        };
        registry.registerFromCourseData(courseData);
        assert.strictEqual(registry.getExerciseIdByParticipation(5001), 1);
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
