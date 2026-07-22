import type { ContextItem } from './types';

/** Parsed epoch ms, or null for missing/invalid dates. */
function dueMs(item: ContextItem): number | null {
    if (!item.dueDate) { return null; }
    const t = new Date(item.dueDate).getTime();
    return Number.isFinite(t) ? t : null;
}

/**
 * Picker-only order (NOT the snapshot/auto-select order): workspace exercise
 * first, then by due date descending to match the Artemis web client's
 * sortExercises, then no/invalid due date, then alphabetical by title.
 */
export function compareExercisesForPicker(a: ContextItem, b: ContextItem): number {
    const aWs = a.isWorkspace ? 1 : 0;
    const bWs = b.isWorkspace ? 1 : 0;
    if (aWs !== bWs) { return bWs - aWs; }

    const aDue = dueMs(a);
    const bDue = dueMs(b);
    if (aDue !== null && bDue !== null && aDue !== bDue) { return bDue - aDue; }
    if (aDue === null && bDue !== null) { return 1; }
    if (aDue !== null && bDue === null) { return -1; }

    return a.title.localeCompare(b.title, undefined, { sensitivity: 'base' });
}

/**
 * Course order for the picker's groups + "Choose another course…" list.
 * Mirrors the host `compareCoursesForDisplay`: most-recently-viewed first
 * (when `lastViewed` is on the wire), then alphabetical by title.
 */
export function compareCoursesForPicker(a: ContextItem, b: ContextItem): number {
    return (b.lastViewed ?? 0) - (a.lastViewed ?? 0)
        || a.title.localeCompare(b.title, undefined, { sensitivity: 'base' });
}
