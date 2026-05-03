import { TrackedCourse, TrackedExercise } from '../../../types';

/**
 * Priority scoring weights for exercise ranking in the context selector.
 *
 * The priority system uses additive scores to surface the most relevant exercise:
 * - WORKSPACE_BOOST (1000): Dominant — current workspace always ranks first.
 * - DUE_SOON_MAX/FLOOR (200/170): Upcoming deadlines get high urgency.
 *   Floor of 170 ensures even exercises due in 7 days outrank RECENTLY_RELEASED (100).
 *   Score decays linearly from 200→170 as daysUntilDue goes 0→7.
 * - RECENTLY_RELEASED (100): Newly released exercises surface for a week.
 * - VIEWED_RECENTLY (50): Small recency bonus for exercises opened in last 24h.
 * - FULLY_SCORED_PENALTY (-100): Completed exercises deprioritized.
 *
 * Tiebreaker: newer release dates get a micro-bonus (~0.001 points/day).
 */
const PRIORITY = {
    WORKSPACE_BOOST: 1000,
    RECENTLY_RELEASED: 100,
    DUE_SOON_MAX: 200,
    DUE_SOON_FLOOR: 170,
    VIEWED_RECENTLY: 50,
    FULLY_SCORED_PENALTY: -100,
    COURSE_VIEWED_RECENTLY: 100,
} as const;

/** Time windows for priority scoring (see PRIORITY for how these are used). */
const TIME_WINDOW = {
    RECENT_RELEASE_DAYS: 7,
    DUE_SOON_DAYS: 7,
    VIEWED_RECENTLY_HOURS: 24,
} as const;

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MS_PER_HOUR = 60 * 60 * 1000;

function now(): number {
    return Date.now();
}

// ── Comparators ───────────────────────────────────────────────────

/** Sort by priority descending, break ties by most-recently-viewed. */
export function byPriorityThenRecency(
    a: { priority: number; lastViewed?: number },
    b: { priority: number; lastViewed?: number },
): number {
    return b.priority - a.priority || (b.lastViewed ?? 0) - (a.lastViewed ?? 0);
}

/** Sort by lastViewed descending (most recent first). */
export function byLastViewedDesc(
    a: { lastViewed?: number },
    b: { lastViewed?: number },
): number {
    return (b.lastViewed ?? 0) - (a.lastViewed ?? 0);
}

export function calculateExercisePriority(exercise: TrackedExercise): number {
    const current = now();
    let priority = 0;

    if (exercise.isWorkspace) {
        priority += PRIORITY.WORKSPACE_BOOST;
    }

    if (exercise.releaseDate) {
        const releaseTime = new Date(exercise.releaseDate).getTime();
        const daysSinceRelease = (current - releaseTime) / MS_PER_DAY;
        if (daysSinceRelease >= 0 && daysSinceRelease <= TIME_WINDOW.RECENT_RELEASE_DAYS) {
            priority += PRIORITY.RECENTLY_RELEASED;
        }
    }

    if (exercise.dueDate) {
        const dueTime = new Date(exercise.dueDate).getTime();
        const daysUntilDue = (dueTime - current) / MS_PER_DAY;
        if (daysUntilDue >= 0 && daysUntilDue <= TIME_WINDOW.DUE_SOON_DAYS) {
            // Higher urgency closer to deadline (scales from DUE_SOON_MAX down to DUE_SOON_FLOOR)
            const dueSoonSpread = PRIORITY.DUE_SOON_MAX - PRIORITY.DUE_SOON_FLOOR;
            const urgencyDecay = Math.floor(daysUntilDue * dueSoonSpread / TIME_WINDOW.DUE_SOON_DAYS);
            priority += Math.max(PRIORITY.DUE_SOON_MAX - urgencyDecay, PRIORITY.DUE_SOON_FLOOR);
        }
    }

    if (exercise.lastViewed) {
        const hoursSinceView = (current - exercise.lastViewed) / MS_PER_HOUR;
        if (hoursSinceView <= TIME_WINDOW.VIEWED_RECENTLY_HOURS) {
            priority += PRIORITY.VIEWED_RECENTLY;
        }
    }

    // Tiny tiebreaker: newer releases rank slightly higher
    if (exercise.releaseDate) {
        const releaseTime = new Date(exercise.releaseDate).getTime();
        priority += Math.floor(releaseTime / MS_PER_DAY / 1000);
    }

    if (exercise.score === 100) {
        priority += PRIORITY.FULLY_SCORED_PENALTY;
    }

    return priority;
}

export function calculateCoursePriority(course: TrackedCourse): number {
    const current = now();
    let priority = 0;

    if (course.lastViewed) {
        const hoursSinceView = (current - course.lastViewed) / MS_PER_HOUR;
        if (hoursSinceView <= TIME_WINDOW.VIEWED_RECENTLY_HOURS) {
            priority += PRIORITY.COURSE_VIEWED_RECENTLY;
        }
    }

    // Tiny tiebreaker: more recently viewed courses rank slightly higher
    priority += Math.floor(((course.lastViewed ?? current) / MS_PER_DAY) / 1000);
    return priority;
}
