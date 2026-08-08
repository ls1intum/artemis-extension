export type HistoryBucket = 'today' | 'yesterday' | 'last7' | 'last30' | 'older';

/** The only field the bucketing reads, so both entry shapes can use it. */
interface HasLastActivity {
    /** epoch ms; `<= 0` or non-finite is the host's "could not parse" sentinel. */
    lastActivity: number;
}

const byNewestFirst = (a: HasLastActivity, b: HasLastActivity) => b.lastActivity - a.lastActivity;

/**
 * Start of the local-timezone day `daysBack` days before `now`, as epoch ms.
 *
 * Calendar arithmetic, not a fixed 24-hour span: passing a negative
 * day-of-month into the `Date` constructor and letting it roll the calendar
 * back resolves the correct year/month/day in the local timezone even when a
 * DST transition falls between `now` and the target day (a 23-hour
 * spring-forward day or a 25-hour fall-back day). Subtracting a fixed
 * `daysBack * 24 * 60 * 60 * 1000` instead would land an hour into the wrong
 * day whenever that happens.
 */
function startOfDayOffset(now: Date, daysBack: number): number {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysBack).getTime();
}

/**
 * Groups course-wide history entries into fixed time buckets for the
 * ConversationHistory popover: Today, Yesterday, Last 7 days, Last 30 days,
 * Older (in that order). Within a bucket entries sort newest-first.
 *
 * Pure: `nowMs` is always supplied by the caller, this function never calls
 * `Date.now()` itself, so bucket boundaries stay deterministic and testable.
 * Boundaries are computed from local-timezone midnights via
 * `startOfDayOffset` (the `Date` constructor used there resolves
 * year/month/day in the local timezone).
 *
 * An entry with an invalid or unparseable timestamp (`lastActivity <= 0` or
 * non-finite, which is what the host sends when neither `lastActivityDate`
 * nor `creationDate` parses) always lands in Older, sorted after every
 * validly dated Older entry.
 *
 * Empty buckets are omitted from the result so the popover never renders a
 * heading with nothing under it.
 */
export function bucketHistoryByTime<T extends HasLastActivity>(
    entries: T[],
    nowMs: number,
): { bucket: HistoryBucket; entries: T[] }[] {
    const now = new Date(nowMs);
    const startOfToday = startOfDayOffset(now, 0);
    const startOfYesterday = startOfDayOffset(now, 1);
    const startOfLast7 = startOfDayOffset(now, 7);
    const startOfLast30 = startOfDayOffset(now, 30);

    const today: T[] = [];
    const yesterday: T[] = [];
    const last7: T[] = [];
    const last30: T[] = [];
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
        } else if (t >= startOfLast30) {
            last30.push(entry);
        } else {
            olderValid.push(entry);
        }
    }

    today.sort(byNewestFirst);
    yesterday.sort(byNewestFirst);
    last7.sort(byNewestFirst);
    last30.sort(byNewestFirst);
    olderValid.sort(byNewestFirst);

    const groups: { bucket: HistoryBucket; entries: T[] }[] = [
        { bucket: 'today', entries: today },
        { bucket: 'yesterday', entries: yesterday },
        { bucket: 'last7', entries: last7 },
        { bucket: 'last30', entries: last30 },
        { bucket: 'older', entries: [...olderValid, ...olderInvalid] },
    ];

    return groups.filter((group) => group.entries.length > 0);
}
