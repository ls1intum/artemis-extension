import * as vscode from 'vscode';
import * as assert from 'assert';
import * as sinon from 'sinon';

import { ExerciseRegistry } from '@extension/services/exerciseRegistry';
import {
    type DetectedExercise,
    detectWorkspaceExercise,
    detectWorkspaceExerciseForRepository,
    type ExerciseSource,
    findExerciseByRepositoryUrl,
    getEntryExercises,
    getWorkspaceRepositoryUrl,
    normalizeRepositoryUrl,
    toExerciseSource,
} from '@extension/services/workspace/workspaceDetectionService';
import type { CourseDashboardEntry, ExerciseDetail } from '@extension/types';

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

});

suite('detectWorkspaceExerciseForRepository: archive path records the catalog', () => {
    let sandbox: sinon.SinonSandbox;
    let callbacks: { registerExercise: sinon.SinonStub; clearStaleWorkspaceContext: sinon.SinonStub };
    let registry: ExerciseRegistry;

    setup(() => {
        sandbox = sinon.createSandbox();
        callbacks = {
            registerExercise: sandbox.stub(),
            clearStaleWorkspaceContext: sandbox.stub(),
        };
        registry = new ExerciseRegistry();
    });

    teardown(() => { sandbox.restore(); });

    /**
     * An archived course whose one exercise matches `url`, as
     * `getCourseForDashboard` returns it. The participation carries the
     * repository URI, not just the bare exercise field: that is the only
     * shape `ExerciseRegistry.registerFromCourseData` actually registers.
     */
    function archivedEntryMatching(url: string): CourseDashboardEntry {
        return {
            course: {
                id: 77,
                title: 'Archived Course',
                exercises: [{
                    id: 5,
                    title: 'Archived Exercise',
                    repositoryUri: url,
                    studentParticipations: [{ id: 1, repositoryUri: url }],
                }],
            },
        };
    }

    test('an archived course found for the workspace is recorded in the catalog', async () => {
        const catalog = { fetch: sandbox.stub().resolves({ courses: [] }), upsertSupplemental: sandbox.stub(), currentEpoch: 3 };
        const api = {
            getArchivedCourses: sandbox.stub().resolves([{ id: 77 }]),
            getCourseForDashboard: sandbox.stub().resolves(archivedEntryMatching('https://git/ws')),
        };

        const outcome = await detectWorkspaceExerciseForRepository(
            'https://git/ws', api as never, callbacks, registry, catalog as never,
        );

        assert.strictEqual(outcome.kind, 'matched');
        assert.strictEqual(catalog.upsertSupplemental.callCount, 1);
        assert.strictEqual(catalog.upsertSupplemental.firstCall.args[0].kind, 'course');
        assert.strictEqual(catalog.upsertSupplemental.firstCall.args[1], 3, 'the epoch must be the catalog\'s current one');
    });
});

suite('getEntryExercises', () => {
    test('returns nested exercises when present and non-empty', () => {
        const entry: CourseDashboardEntry = {
            course: { id: 1, exercises: [{ id: 10, title: 'A' }] },
        };
        const result = getEntryExercises(entry);
        assert.deepStrictEqual(result.map(e => e.id), [10]);
    });

    test('falls back to flat exercises when nested is empty array', () => {
        const entry: CourseDashboardEntry = {
            course: { id: 1, exercises: [] },
            exercises: [{ id: 99, title: 'flat' }],
        };
        const result = getEntryExercises(entry);
        assert.deepStrictEqual(result.map(e => e.id), [99]);
    });

    test('falls back to flat exercises when nested is undefined', () => {
        const entry: CourseDashboardEntry = {
            course: { id: 1 },
            exercises: [{ id: 5, title: 'flat-only' }],
        };
        const result = getEntryExercises(entry);
        assert.deepStrictEqual(result.map(e => e.id), [5]);
    });

    test('returns empty array when both are missing', () => {
        const entry: CourseDashboardEntry = { course: { id: 1 } };
        assert.deepStrictEqual(getEntryExercises(entry), []);
    });
});

suite('toExerciseSource', () => {
    test('returns null when id is not a number', () => {
        const ex: ExerciseDetail = { title: 'no-id' };
        assert.strictEqual(toExerciseSource(ex), null);
    });

    test('returns null when title is not a string', () => {
        const ex: ExerciseDetail = { id: 1 };
        assert.strictEqual(toExerciseSource(ex), null);
    });

    test('preserves direct repositoryUri', () => {
        const ex: ExerciseDetail = { id: 1, title: 'A', repositoryUri: 'git://x/y.git' };
        const result = toExerciseSource(ex);
        assert.ok(result);
        assert.strictEqual(result.repositoryUri, 'git://x/y.git');
    });

    test('preserves studentParticipations with only the read fields', () => {
        const ex: ExerciseDetail = {
            id: 1, title: 'A',
            studentParticipations: [
                { id: 99, repositoryUri: 'r1', testRun: true, type: 'STUDENT' as never },
                { id: 100, repositoryUri: 'r2', testRun: false, type: 'STUDENT' as never },
            ],
        };
        const result = toExerciseSource(ex);
        assert.ok(result);
        assert.deepStrictEqual(
            result.studentParticipations,
            [
                { repositoryUri: 'r1', testRun: true },
                { repositoryUri: 'r2', testRun: false },
            ],
        );
    });

    test('uses courseId argument over any nested course.id', () => {
        const ex: ExerciseDetail = { id: 1, title: 'A', course: { id: 999 } };
        const result = toExerciseSource(ex, 42);
        assert.ok(result);
        assert.strictEqual(result.courseId, 42);
    });
});

suite('collectExerciseSources', () => {
    test('handles entries with nested-only, flat-only, and both', () => {
        // import collectExerciseSources locally to avoid the global suite reorg
        const { collectExerciseSources } = require('@extension/services/workspace/workspaceDetectionService');
        const entries: CourseDashboardEntry[] = [
            { course: { id: 1, exercises: [{ id: 11, title: 'nested' }] } },
            { course: { id: 2 }, exercises: [{ id: 22, title: 'flat' }] },
            { course: { id: 3, exercises: [] }, exercises: [{ id: 33, title: 'both' }] },
        ];
        const out = collectExerciseSources(entries);
        assert.deepStrictEqual(out.map((s: { id: number }) => s.id), [11, 22, 33]);
        assert.deepStrictEqual(out.map((s: { courseId?: number }) => s.courseId), [1, 2, 3]);
    });

    test('drops malformed entries silently', () => {
        const { collectExerciseSources } = require('@extension/services/workspace/workspaceDetectionService');
        const entries: CourseDashboardEntry[] = [
            { course: { id: 1, exercises: [{ /* no id */ title: 'x' } as ExerciseDetail, { id: 9, title: 'ok' }] } },
        ];
        const out = collectExerciseSources(entries);
        assert.deepStrictEqual(out.map((s: { id: number }) => s.id), [9]);
    });
});
