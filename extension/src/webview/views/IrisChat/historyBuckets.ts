import type { IrisChatMode } from '@shared/types/apiResponses';

/**
 * Webview mirror of the host's `CourseHistoryEntry`
 * (`@extension/services/iris/context/courseHistory.ts`). Kept as a plain
 * duplicate rather than a shared import because the webview bundle must not
 * pull in extension-host modules.
 */
export interface CourseHistoryEntryVM {
    artemisSessionId: number;
    courseId: number;
    /** COURSE_CHAT | programming-exercise chat */
    mode: IrisChatMode;
    entityId: number;
    /** exercise name (for the context label) */
    entityName?: string;
    /** conversation title */
    title?: string;
    /** epoch ms: lastActivityDate ?? creationDate; 0 = host could not parse either */
    lastActivity: number;
}

export type HistoryBucket = 'today' | 'yesterday' | 'last7' | 'older';

const DAY_MS = 24 * 60 * 60 * 1000;

/** The only field the bucketing reads, so both entry shapes can use it. */
interface HasLastActivity {
    /** epoch ms; `<= 0` or non-finite is the host's "could not parse" sentinel. */
    lastActivity: number;
}

const byNewestFirst = (a: HasLastActivity, b: HasLastActivity) => b.lastActivity - a.lastActivity;

/**
 * Groups course-wide history entries into fixed time buckets for the
 * ConversationHistory popover: Today, Yesterday, Last 7 days, Older (in that
 * order). Within a bucket entries sort newest-first.
 *
 * Pure: `nowMs` is always supplied by the caller, this function never calls
 * `Date.now()` itself, so bucket boundaries stay deterministic and testable.
 * Boundaries are computed from local-timezone midnights (the `Date`
 * constructor used below resolves year/month/day in the local timezone).
 *
 * An entry with an invalid or unparseable timestamp (`lastActivity <= 0` or
 * non-finite, the host's sentinel for a date it could not parse, see
 * `buildCourseHistory`) always lands in Older, sorted after every validly
 * dated Older entry.
 *
 * Empty buckets are omitted from the result so the popover never renders a
 * heading with nothing under it.
 */
export function bucketHistoryByTime<T extends HasLastActivity>(
    entries: T[],
    nowMs: number,
): { bucket: HistoryBucket; entries: T[] }[] {
    const now = new Date(nowMs);
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const startOfYesterday = startOfToday - DAY_MS;
    const startOfLast7 = startOfToday - 7 * DAY_MS;

    const today: T[] = [];
    const yesterday: T[] = [];
    const last7: T[] = [];
    const olderValid: T[] = [];
    const olderInvalid: T[] = [];

    for (const entry of entries) {
        const t = entry.lastActivity;
        if (!Number.isFinite(t) || t <= 0) {
            olderInvalid.push(entry);
        } else if (t >= startOfToday) {
            today.push(entry);
        } else if (t >= startOfYesterday) {
            yesterday.push(entry);
        } else if (t >= startOfLast7) {
            last7.push(entry);
        } else {
            olderValid.push(entry);
        }
    }

    today.sort(byNewestFirst);
    yesterday.sort(byNewestFirst);
    last7.sort(byNewestFirst);
    olderValid.sort(byNewestFirst);

    const groups: { bucket: HistoryBucket; entries: T[] }[] = [
        { bucket: 'today', entries: today },
        { bucket: 'yesterday', entries: yesterday },
        { bucket: 'last7', entries: last7 },
        { bucket: 'older', entries: [...olderValid, ...olderInvalid] },
    ];

    return groups.filter((group) => group.entries.length > 0);
}
