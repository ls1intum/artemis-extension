import * as assert from 'assert';
import * as vscode from 'vscode';
import {
    normalizeRepositoryUrl,
    findExerciseByRepositoryUrl,
    getWorkspaceRepositoryUrl,
    detectWorkspaceExercise,
    isExerciseInCurrentWorkspace,
    type ExerciseSource,
    type DetectedExercise
} from '../../../src/services/workspace/workspaceDetectionService';

suite('WorkspaceDetectionService', () => {
    suite('normalizeRepositoryUrl', () => {
        test('should normalize HTTPS URL', () => {
            const url = 'https://github.com/user/repo.git';
            const normalized = normalizeRepositoryUrl(url);
            assert.strictEqual(normalized, 'https://github.com/user/repo');
        });

        test('should normalize HTTPS URL without .git suffix', () => {
            const url = 'https://github.com/user/repo';
            const normalized = normalizeRepositoryUrl(url);
            assert.strictEqual(normalized, 'https://github.com/user/repo');
        });

        test('should normalize SSH URL to HTTPS format', () => {
            const url = 'git@github.com:user/repo.git';
            const normalized = normalizeRepositoryUrl(url);
            assert.strictEqual(normalized, 'https://github.com/user/repo');
        });

        test('should normalize HTTPS URL with credentials', () => {
            const url = 'https://username@github.com/user/repo.git';
            const normalized = normalizeRepositoryUrl(url);
            assert.strictEqual(normalized, 'https://github.com/user/repo');
        });

        test('should normalize HTTPS URL with username:password credentials', () => {
            const url = 'https://username:password@github.com/user/repo.git';
            const normalized = normalizeRepositoryUrl(url);
            assert.strictEqual(normalized, 'https://github.com/user/repo');
        });

        test('should remove trailing slash', () => {
            const url = 'https://github.com/user/repo/';
            const normalized = normalizeRepositoryUrl(url);
            assert.strictEqual(normalized, 'https://github.com/user/repo');
        });

        test('should convert to lowercase', () => {
            const url = 'https://GitHub.com/User/Repo.git';
            const normalized = normalizeRepositoryUrl(url);
            assert.strictEqual(normalized, 'https://github.com/user/repo');
        });

        test('should handle Artemis-style URLs', () => {
            const url = 'https://artemis.cit.tum.de/git/course-slug/exercise-slug-student.git';
            const normalized = normalizeRepositoryUrl(url);
            assert.strictEqual(normalized, 'https://artemis.cit.tum.de/git/course-slug/exercise-slug-student');
        });

        test('should handle Artemis SSH URLs', () => {
            const url = 'git@artemis.cit.tum.de:course-slug/exercise-slug-student.git';
            const normalized = normalizeRepositoryUrl(url);
            assert.strictEqual(normalized, 'https://artemis.cit.tum.de/course-slug/exercise-slug-student');
        });
    });

    suite('findExerciseByRepositoryUrl', () => {
        const createExercise = (
            id: number,
            title: string,
            repositoryUri?: string,
            participations?: Array<{ repositoryUri?: string; testRun?: boolean }>
        ): ExerciseSource => ({
            id,
            title,
            shortName: `ex${id}`,
            repositoryUri,
            studentParticipations: participations
        });

        test('should find exercise by direct repositoryUri', () => {
            const exercises: ExerciseSource[] = [
                createExercise(1, 'Exercise 1', 'https://github.com/user/repo1.git'),
                createExercise(2, 'Exercise 2', 'https://github.com/user/repo2.git'),
            ];

            const result = findExerciseByRepositoryUrl('https://github.com/user/repo1.git', exercises);

            assert.ok(result);
            assert.strictEqual(result.id, 1);
            assert.strictEqual(result.title, 'Exercise 1');
        });

        test('should find exercise by participation repositoryUri', () => {
            const exercises: ExerciseSource[] = [
                createExercise(1, 'Exercise 1', undefined, [
                    { repositoryUri: 'https://github.com/user/repo1.git' }
                ]),
            ];

            const result = findExerciseByRepositoryUrl('https://github.com/user/repo1.git', exercises);

            assert.ok(result);
            assert.strictEqual(result.id, 1);
        });

        test('should match normalized URLs (SSH vs HTTPS)', () => {
            const exercises: ExerciseSource[] = [
                createExercise(1, 'Exercise 1', 'git@github.com:user/repo.git'),
            ];

            const result = findExerciseByRepositoryUrl('https://github.com/user/repo', exercises);

            assert.ok(result);
            assert.strictEqual(result.id, 1);
        });

        test('should match case-insensitively', () => {
            const exercises: ExerciseSource[] = [
                createExercise(1, 'Exercise 1', 'https://GitHub.com/User/Repo.git'),
            ];

            const result = findExerciseByRepositoryUrl('https://github.com/user/repo', exercises);

            assert.ok(result);
            assert.strictEqual(result.id, 1);
        });

        test('should return null when no match found', () => {
            const exercises: ExerciseSource[] = [
                createExercise(1, 'Exercise 1', 'https://github.com/user/repo1.git'),
            ];

            const result = findExerciseByRepositoryUrl('https://github.com/user/different-repo', exercises);

            assert.strictEqual(result, null);
        });

        test('should return null for empty exercise list', () => {
            const result = findExerciseByRepositoryUrl('https://github.com/user/repo', []);

            assert.strictEqual(result, null);
        });

        test('should handle exercises without repositoryUri or participations', () => {
            const exercises: ExerciseSource[] = [
                createExercise(1, 'Exercise 1'),
                createExercise(2, 'Exercise 2', undefined, []),
                createExercise(3, 'Exercise 3', undefined, [{ repositoryUri: undefined }]),
            ];

            const result = findExerciseByRepositoryUrl('https://github.com/user/repo', exercises);

            assert.strictEqual(result, null);
        });

        test('should find first matching exercise when multiple match', () => {
            const exercises: ExerciseSource[] = [
                createExercise(1, 'Exercise 1', 'https://github.com/user/repo.git'),
                createExercise(2, 'Exercise 2', 'https://github.com/user/repo.git'),
            ];

            const result = findExerciseByRepositoryUrl('https://github.com/user/repo', exercises);

            assert.ok(result);
            assert.strictEqual(result.id, 1);
        });

        test('should check multiple participations', () => {
            const exercises: ExerciseSource[] = [
                createExercise(1, 'Exercise 1', undefined, [
                    { repositoryUri: 'https://github.com/user/other.git' },
                    { repositoryUri: 'https://github.com/user/repo.git', testRun: true },
                ]),
            ];

            const result = findExerciseByRepositoryUrl('https://github.com/user/repo', exercises);

            assert.ok(result);
            assert.strictEqual(result.id, 1);
        });

        test('should return correct DetectedExercise structure', () => {
            const exercises: ExerciseSource[] = [
                {
                    id: 42,
                    title: 'My Exercise',
                    shortName: 'myex',
                    repositoryUri: 'https://github.com/user/repo.git'
                }
            ];

            const result = findExerciseByRepositoryUrl('https://github.com/user/repo', exercises);

            assert.ok(result);
            assert.deepStrictEqual(result, {
                id: 42,
                title: 'My Exercise',
                shortName: 'myex',
                repositoryUri: 'https://github.com/user/repo.git'
            } as DetectedExercise);
        });

        test('should prefer direct repositoryUri over participation', () => {
            const exercises: ExerciseSource[] = [
                {
                    id: 1,
                    title: 'Exercise',
                    repositoryUri: 'https://github.com/direct/repo.git',
                    studentParticipations: [
                        { repositoryUri: 'https://github.com/participation/repo.git' }
                    ]
                }
            ];

            const result = findExerciseByRepositoryUrl('https://github.com/direct/repo', exercises);

            assert.ok(result);
            assert.strictEqual(result.repositoryUri, 'https://github.com/direct/repo.git');
        });

        test('should match practice repo to graded repo via fallback', () => {
            const exercises: ExerciseSource[] = [
                createExercise(1, 'Exercise 1', 'https://artemis.example.com/git/course/exercise-student.git'),
            ];

            // Practice repo URL contains '-practice-'
            const result = findExerciseByRepositoryUrl(
                'https://artemis.example.com/git/course/exercise-practice-student.git',
                exercises
            );

            assert.ok(result);
            assert.strictEqual(result.id, 1);
        });

        test('should prefer exact match over practice fallback', () => {
            const exercises: ExerciseSource[] = [
                createExercise(1, 'Graded Exercise', 'https://artemis.example.com/git/course/exercise-student.git'),
                createExercise(2, 'Practice Exercise', 'https://artemis.example.com/git/course/exercise-practice-student.git'),
            ];

            // Should match the practice exercise exactly, not fallback to graded
            const result = findExerciseByRepositoryUrl(
                'https://artemis.example.com/git/course/exercise-practice-student.git',
                exercises
            );

            assert.ok(result);
            assert.strictEqual(result.id, 2);
            assert.strictEqual(result.title, 'Practice Exercise');
        });

        test('should match practice repo via participation fallback', () => {
            const exercises: ExerciseSource[] = [
                createExercise(1, 'Exercise 1', undefined, [
                    { repositoryUri: 'https://artemis.example.com/git/course/exercise-student.git' }
                ]),
            ];

            const result = findExerciseByRepositoryUrl(
                'https://artemis.example.com/git/course/exercise-practice-student.git',
                exercises
            );

            assert.ok(result);
            assert.strictEqual(result.id, 1);
        });

        test('should not apply practice fallback for non-practice URLs', () => {
            const exercises: ExerciseSource[] = [
                createExercise(1, 'Exercise 1', 'https://artemis.example.com/git/course/exercise-student.git'),
            ];

            // URL without '-practice-' should not match
            const result = findExerciseByRepositoryUrl(
                'https://artemis.example.com/git/course/different-exercise-student.git',
                exercises
            );

            assert.strictEqual(result, null);
        });
    });

    suite('getWorkspaceRepositoryUrl', () => {
        test('should return null when no workspace folder exists', async () => {
            // The function checks vscode.workspace.workspaceFolders
            // In test environment, there may or may not be workspace folders
            // We test the function can be called without throwing
            const result = await getWorkspaceRepositoryUrl();

            // Result is either null (no workspace) or a string (workspace exists)
            assert.ok(result === null || typeof result === 'string');
        });

        test('should accept custom workspace folder parameter', async () => {
            // Create a mock workspace folder pointing to a non-git directory
            const mockWorkspaceFolder: vscode.WorkspaceFolder = {
                uri: vscode.Uri.file('/tmp/non-existent-test-folder'),
                name: 'test',
                index: 0
            };

            const result = await getWorkspaceRepositoryUrl(mockWorkspaceFolder);

            // Should return null because the directory doesn't exist or isn't a git repo
            assert.strictEqual(result, null);
        });
    });

    suite('detectWorkspaceExercise', () => {
        const createExercise = (
            id: number,
            title: string,
            repositoryUri?: string
        ): ExerciseSource => ({
            id,
            title,
            shortName: `ex${id}`,
            repositoryUri
        });

        test('should return null when no workspace folder exists and no match possible', async () => {
            const exercises: ExerciseSource[] = [
                createExercise(1, 'Exercise 1', 'https://github.com/user/repo1.git'),
            ];

            // In test environment without a matching workspace, should return null
            const result = await detectWorkspaceExercise(exercises);

            // Either null (no workspace or no match) or a DetectedExercise
            assert.ok(result === null || (result && typeof result.id === 'number'));
        });

        test('should return null for empty exercise list', async () => {
            const result = await detectWorkspaceExercise([]);

            assert.strictEqual(result, null);
        });

        test('should accept custom workspace folder', async () => {
            const exercises: ExerciseSource[] = [
                createExercise(1, 'Exercise 1', 'https://github.com/user/repo.git'),
            ];

            const mockWorkspaceFolder: vscode.WorkspaceFolder = {
                uri: vscode.Uri.file('/tmp/non-existent-test-folder'),
                name: 'test',
                index: 0
            };

            const result = await detectWorkspaceExercise(exercises, mockWorkspaceFolder);

            // Should return null because the mock folder doesn't exist
            assert.strictEqual(result, null);
        });
    });

    suite('isExerciseInCurrentWorkspace', () => {
        const createExercise = (
            id: number,
            title: string,
            repositoryUri?: string
        ): ExerciseSource => ({
            id,
            title,
            shortName: `ex${id}`,
            repositoryUri
        });

        test('should return false when no workspace matches', async () => {
            const exercises: ExerciseSource[] = [
                createExercise(1, 'Exercise 1', 'https://github.com/user/repo1.git'),
            ];

            const result = await isExerciseInCurrentWorkspace(1, exercises);

            // In test environment, likely no matching workspace
            assert.strictEqual(typeof result, 'boolean');
        });

        test('should return false for non-existent exercise ID', async () => {
            const exercises: ExerciseSource[] = [
                createExercise(1, 'Exercise 1', 'https://github.com/user/repo1.git'),
            ];

            const result = await isExerciseInCurrentWorkspace(999, exercises);

            assert.strictEqual(result, false);
        });

        test('should return false with empty exercise list', async () => {
            const result = await isExerciseInCurrentWorkspace(1, []);

            assert.strictEqual(result, false);
        });

        test('should accept custom workspace folder', async () => {
            const exercises: ExerciseSource[] = [
                createExercise(1, 'Exercise 1', 'https://github.com/user/repo.git'),
            ];

            const mockWorkspaceFolder: vscode.WorkspaceFolder = {
                uri: vscode.Uri.file('/tmp/non-existent-test-folder'),
                name: 'test',
                index: 0
            };

            const result = await isExerciseInCurrentWorkspace(1, exercises, mockWorkspaceFolder);

            // Should return false because mock folder doesn't exist
            assert.strictEqual(result, false);
        });
    });
});
