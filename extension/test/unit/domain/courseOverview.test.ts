/**
 * Unit tests for the `exercises-for-overview` adapter in
 * `extension/src/extension/domain/courseOverview.ts`.
 *
 * The endpoint replaced the deleted `courses/{id}/for-dashboard` and sends a leaner projection
 * than the exercise entity did. The target type is permissive (`[key: string]: unknown`), so a
 * wrong mapping produces `undefined` at the reader rather than a type error. These tests pin the
 * two properties that cannot be caught that way: every participation survives the mapping, and a
 * field the server omits does not become a crash.
 */

import * as assert from 'assert';

import { MalformedResponseError, parseCourseExercisesForOverview } from '@extension/domain';

suite('parseCourseExercisesForOverview', () => {
    test('maps the fields the course detail and the catalog read', () => {
        const exercises = parseCourseExercisesForOverview({
            exercises: [{
                id: 10,
                title: 'Sorting',
                type: 'programming',
                maxPoints: 12,
                releaseDate: '2026-01-01T00:00:00Z',
                startDate: '2026-01-02T00:00:00Z',
                dueDate: '2026-02-01T00:00:00Z',
            }],
        });

        assert.deepStrictEqual(exercises, [{
            id: 10,
            title: 'Sorting',
            type: 'programming',
            maxPoints: 12,
            releaseDate: '2026-01-01T00:00:00Z',
            startDate: '2026-01-02T00:00:00Z',
            dueDate: '2026-02-01T00:00:00Z',
            studentParticipations: undefined,
        }]);
    });

    test('keeps every participation, not just the first', () => {
        // Workspace matching scans all of them, and the graded repository is not always first.
        const [exercise] = parseCourseExercisesForOverview({
            exercises: [{
                id: 10,
                title: 'Sorting',
                studentParticipations: [
                    { id: 1, repositoryUri: 'https://git/practice', testRun: true },
                    { id: 2, repositoryUri: 'https://git/graded', testRun: false },
                ],
            }],
        });

        assert.deepStrictEqual(
            exercise.studentParticipations?.map(p => p.repositoryUri),
            ['https://git/practice', 'https://git/graded'],
        );
        assert.deepStrictEqual(exercise.studentParticipations?.map(p => p.testRun), [true, false]);
    });

    test('reads a course with no visible exercises as empty', () => {
        // The server serializes with NON_EMPTY, so an empty collection is an absent key rather
        // than an empty array. Treating that as malformed would break every such course.
        assert.deepStrictEqual(parseCourseExercisesForOverview({}), []);
    });

    test('leaves a field the server omitted undefined rather than failing', () => {
        const [exercise] = parseCourseExercisesForOverview({
            exercises: [{ id: 10, studentParticipations: [{ id: 1 }] }],
        });

        assert.strictEqual(exercise.title, undefined);
        assert.strictEqual(exercise.dueDate, undefined);
        assert.strictEqual(exercise.studentParticipations?.[0].repositoryUri, undefined);
    });

    test('rejects an exercises field that is present but not a list', () => {
        // Distinct from the absent key above. A server that answers with something else in that
        // slot is malformed, and reading it as "no exercises" would blank the exercise list on a
        // reload and make an archive scan report a reachable course with nothing in it.
        for (const broken of [null, 'oops', {}, 3]) {
            assert.throws(
                () => parseCourseExercisesForOverview({ exercises: broken }),
                (err: unknown) => err instanceof MalformedResponseError,
                `expected a malformed-response error for ${JSON.stringify(broken)}`,
            );
        }
    });

    test('rejects a body that is not an object', () => {
        assert.throws(
            () => parseCourseExercisesForOverview([]),
            (err: unknown) => err instanceof MalformedResponseError,
        );
    });
});
