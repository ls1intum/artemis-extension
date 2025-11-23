import * as assert from 'assert';
import { getLatestSubmission, transformExerciseData } from '../../src/views/utils/exerciseDataTransformer';

suite('Exercise Data Transformer Test Suite', () => {
    test('should get latest submission by ID', () => {
        const participation = {
            submissions: [
                { id: 1, submissionDate: '2024-01-01' },
                { id: 3, submissionDate: '2024-01-03' },
                { id: 2, submissionDate: '2024-01-02' }
            ]
        };

        const latest = getLatestSubmission(participation);
        assert.ok(latest);
        assert.strictEqual(latest.id, 3); // Highest ID, not latest date
    });

    test('should return undefined when no submissions', () => {
        const participation = { submissions: [] };
        const latest = getLatestSubmission(participation);
        assert.strictEqual(latest, undefined);
    });

    test('should transform programming exercise data', () => {
        const exerciseData = {
            id: 1,
            title: 'Test Exercise',
            type: 'programming',
            maxPoints: 100,
            bonusPoints: 10,
            releaseDate: '2024-01-01',
            dueDate: '2024-12-31',
            studentParticipations: [
                {
                    id: 1,
                    testRun: false,
                    submissions: [{ id: 1, buildFailed: false, results: [{ score: 80, successful: true }] }]
                }
            ]
        };

        const transformed = transformExerciseData(exerciseData);
        
        assert.strictEqual(transformed.exerciseTitle, 'Test Exercise');
        assert.strictEqual(transformed.exerciseType, 'Programming');
        assert.strictEqual(transformed.isProgrammingExercise, true);
        assert.strictEqual(transformed.hasParticipation, true);
    });

    test('should handle exercise without participation', () => {
        const exerciseData = {
            id: 1,
            title: 'Test Exercise',
            type: 'text',
            maxPoints: 50,
            bonusPoints: 0,
            studentParticipations: []
        };

        const transformed = transformExerciseData(exerciseData);
        
        assert.strictEqual(transformed.hasParticipation, false);
        assert.strictEqual(transformed.participationId, undefined);
    });

    test('should identify practice participation when available', () => {
        const exerciseData = {
            id: 1,
            title: 'Test',
            type: 'programming',
            maxPoints: 100,
            studentParticipations: [
                { id: 1, testRun: false, submissions: [] },
                { id: 2, testRun: true, submissions: [] } // Practice mode exists
            ]
        };

        const transformed = transformExerciseData(exerciseData);
        
        // isPracticeAvailable is false when practice participation EXISTS
        // It's true when practice CAN be started (due date passed, no existing practice)
        assert.strictEqual(transformed.isPracticeAvailable, false);
        assert.ok(transformed.practiceParticipation);
        assert.strictEqual(transformed.practiceParticipation.id, 2);
    });

    test('should calculate score percentage', () => {
        const exerciseData = {
            id: 1,
            title: 'Test',
            type: 'programming',
            maxPoints: 100,
            studentParticipations: [
                {
                    id: 1,
                    submissions: [
                        { 
                            id: 1, 
                            results: [{ 
                                score: 75,
                                completionDate: '2024-01-01' 
                            }] 
                        }
                    ]
                }
            ]
        };

        const transformed = transformExerciseData(exerciseData);
        
        assert.strictEqual(transformed.scorePercentage, 75);
        assert.strictEqual(transformed.scorePoints, 75);
    });
});
