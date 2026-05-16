import * as assert from 'assert';
import { selectRecentCourses } from '@extension/services/ui/recentCourseSelector';
import type { CourseDashboardEntry, ExerciseDetail } from '@extension/types';

function entry(
    id: number,
    title: string,
    opts: { startDate?: string; exercises?: Array<{ releaseDate?: string; startDate?: string; dueDate?: string }> } = {},
): CourseDashboardEntry {
    return {
        course: {
            id,
            title,
            startDate: opts.startDate,
            exercises: (opts.exercises ?? []) as ExerciseDetail[],
        },
    } as CourseDashboardEntry;
}

suite('selectRecentCourses', () => {
    test('empty courses → empty result', () => {
        assert.deepStrictEqual(selectRecentCourses([], [], 3), []);
        assert.deepStrictEqual(selectRecentCourses([], [1, 2, 3], 3), []);
    });

    test('displayLimit ≤ 0 → empty result', () => {
        const courses = [entry(1, 'A'), entry(2, 'B')];
        assert.deepStrictEqual(selectRecentCourses(courses, [], 0), []);
    });

    test('no accessed ids → fallback sort applied', () => {
        const courses = [
            entry(1, 'Course 1', { startDate: '2024-01-01' }),
            entry(2, 'Course 2', { startDate: '2025-01-01' }),
            entry(3, 'Course 3', { startDate: '2023-01-01' }),
        ];
        const result = selectRecentCourses(courses, [], 3);
        // All have no exercises → fallback goes to startDate DESC
        assert.deepStrictEqual(result.map(c => c.course!.id), [2, 1, 3]);
    });

    test('fallback prefers max exercise releaseDate over startDate', () => {
        const courses = [
            // New semester starting, but no exercises yet
            entry(1, 'Fresh semester', { startDate: '2026-04-01' }),
            // Older semester but recent exercise drop
            entry(2, 'Active course', {
                startDate: '2025-10-01',
                exercises: [{ releaseDate: '2026-04-10' }],
            }),
        ];
        const result = selectRecentCourses(courses, [], 3);
        assert.deepStrictEqual(result.map(c => c.course!.id), [2, 1]);
    });

    test('fallback ignores dueDate in the recency signal', () => {
        // A course with a far-future dueDate should NOT beat a course with a recent release.
        const courses = [
            entry(1, 'With far dueDate', {
                startDate: '2024-01-01',
                exercises: [{ dueDate: '2030-01-01', releaseDate: '2024-02-01' }],
            }),
            entry(2, 'With recent release', {
                startDate: '2024-01-01',
                exercises: [{ releaseDate: '2026-04-01' }],
            }),
        ];
        const result = selectRecentCourses(courses, [], 3);
        assert.deepStrictEqual(result.map(c => c.course!.id), [2, 1]);
    });

    test('accessed ids come first in given order, regardless of fallback signal', () => {
        const courses = [
            entry(1, 'A', { startDate: '2020-01-01' }),
            entry(2, 'B', { startDate: '2026-01-01' }), // newest by startDate
            entry(3, 'C', { startDate: '2023-01-01' }),
        ];
        const result = selectRecentCourses(courses, [1, 3], 3);
        assert.deepStrictEqual(result.map(c => c.course!.id), [1, 3, 2]);
    });

    test('accessed list may exceed displayLimit (only take first N)', () => {
        const courses = [entry(1, 'A'), entry(2, 'B'), entry(3, 'C'), entry(4, 'D')];
        const result = selectRecentCourses(courses, [4, 3, 2, 1], 3);
        assert.deepStrictEqual(result.map(c => c.course!.id), [4, 3, 2]);
    });

    test('stale accessed ids (not in current courses) are skipped', () => {
        const courses = [entry(1, 'A', { startDate: '2020-01-01' }), entry(2, 'B', { startDate: '2021-01-01' })];
        const result = selectRecentCourses(courses, [999, 1], 3);
        assert.deepStrictEqual(result.map(c => c.course!.id), [1, 2]);
    });

    test('fewer than displayLimit courses → returns all', () => {
        const courses = [entry(1, 'A'), entry(2, 'B')];
        const result = selectRecentCourses(courses, [], 3);
        assert.strictEqual(result.length, 2);
    });

    test('tiebreak: equal max-exercise-date → startDate DESC → title ASC', () => {
        const courses = [
            entry(1, 'Zebra', { startDate: '2024-01-01', exercises: [{ releaseDate: '2026-01-01' }] }),
            entry(2, 'Alpha', { startDate: '2024-01-01', exercises: [{ releaseDate: '2026-01-01' }] }),
            entry(3, 'Beta', { startDate: '2025-01-01', exercises: [{ releaseDate: '2026-01-01' }] }),
        ];
        const result = selectRecentCourses(courses, [], 3);
        // id=3 wins on startDate, then id=2 (Alpha) beats id=1 (Zebra) alphabetically
        assert.deepStrictEqual(result.map(c => c.course!.id), [3, 2, 1]);
    });

    test('duplicate accessed ids are deduplicated', () => {
        const courses = [entry(1, 'A'), entry(2, 'B'), entry(3, 'C')];
        const result = selectRecentCourses(courses, [1, 1, 2, 1], 3);
        assert.deepStrictEqual(result.map(c => c.course!.id), [1, 2, 3]);
    });

    test('courses with no exercises sink to the bottom', () => {
        const courses = [
            entry(1, 'No exercises', { startDate: '2026-04-01' }),
            entry(2, 'Has exercises', { startDate: '2024-01-01', exercises: [{ releaseDate: '2024-06-01' }] }),
        ];
        const result = selectRecentCourses(courses, [], 3);
        assert.deepStrictEqual(result.map(c => c.course!.id), [2, 1]);
    });
});
