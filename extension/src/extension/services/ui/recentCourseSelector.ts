import type { CourseDashboardEntry, ExerciseDetail } from '../../types';

/**
 * Select and order courses for the dashboard "Recent Courses" section.
 *
 * Selection rule:
 *   1. Courses whose id is in `accessedIds` come first, preserving the order given
 *      (caller is expected to pass IDs already sorted by last-access DESC).
 *   2. Remaining courses are sorted by a "most recent activity" signal:
 *      max(exercise.releaseDate ?? exercise.startDate) DESC,
 *      then course.startDate DESC,
 *      then course.title ASC (deterministic tiebreak).
 *   3. The concatenated list is truncated to `displayLimit`.
 *
 * Courses in `accessedIds` that are not present in the input (e.g. archived or
 * unenrolled) are silently skipped.
 */
export function selectRecentCourses(
    courses: CourseDashboardEntry[],
    accessedIds: readonly number[],
    displayLimit: number,
): CourseDashboardEntry[] {
    if (displayLimit <= 0 || courses.length === 0) { return []; }

    const byId = new Map<number, CourseDashboardEntry>();
    for (const entry of courses) {
        const id = entry.course?.id;
        if (typeof id === 'number') { byId.set(id, entry); }
    }

    const accessedSet = new Set<number>();
    const accessed: CourseDashboardEntry[] = [];
    for (const id of accessedIds) {
        if (accessedSet.has(id)) { continue; }
        const entry = byId.get(id);
        if (entry) { accessed.push(entry); accessedSet.add(id); }
    }

    const fallback = courses
        .filter(e => {
            const id = e.course?.id;
            return typeof id === 'number' && !accessedSet.has(id);
        })
        .slice()
        .sort(compareFallback);

    return [...accessed, ...fallback].slice(0, displayLimit);
}

function compareFallback(a: CourseDashboardEntry, b: CourseDashboardEntry): number {
    const ax = maxExerciseDate(a);
    const bx = maxExerciseDate(b);
    if (ax !== bx) {
        if (ax === null) { return 1; }
        if (bx === null) { return -1; }
        return bx.localeCompare(ax);
    }
    const aStart = a.course?.startDate;
    const bStart = b.course?.startDate;
    if (aStart && bStart && aStart !== bStart) { return bStart.localeCompare(aStart); }
    if (aStart && !bStart) { return -1; }
    if (!aStart && bStart) { return 1; }
    const aTitle = a.course?.title ?? '';
    const bTitle = b.course?.title ?? '';
    return aTitle.localeCompare(bTitle);
}

function maxExerciseDate(entry: CourseDashboardEntry): string | null {
    const exercises: ExerciseDetail[] = entry.course?.exercises ?? [];
    let max: string | null = null;
    for (const ex of exercises) {
        const date = ex.releaseDate ?? ex.startDate;
        if (typeof date !== 'string' || date.length === 0) { continue; }
        if (max === null || date > max) { max = date; }
    }
    return max;
}
