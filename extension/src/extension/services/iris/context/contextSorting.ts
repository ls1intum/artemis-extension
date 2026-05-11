import type { TrackedExercise, TrackedCourse } from '../../../types';

/**
 * Display order for exercises in the dropdown. Workspace exercise wins,
 * then most-recently-viewed, then alphabetical. Pure function, computed
 * at snapshot time — no stored priority field.
 */
export function compareExercisesForDisplay(a: TrackedExercise, b: TrackedExercise): number {
    const aWs = a.isWorkspace ? 1 : 0;
    const bWs = b.isWorkspace ? 1 : 0;
    if (aWs !== bWs) { return bWs - aWs; }
    return (b.lastViewed ?? 0) - (a.lastViewed ?? 0)
        || a.title.localeCompare(b.title, undefined, { sensitivity: 'base' });
}

export function compareCoursesForDisplay(a: TrackedCourse, b: TrackedCourse): number {
    return (b.lastViewed ?? 0) - (a.lastViewed ?? 0)
        || a.title.localeCompare(b.title, undefined, { sensitivity: 'base' });
}
