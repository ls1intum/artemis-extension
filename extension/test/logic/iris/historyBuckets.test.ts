import { describe, expect, it } from 'vitest';

import { bucketHistoryByTime } from '@webview/views/IrisChat/historyBuckets';
import type { ConversationSummary } from '@webview/views/IrisChat/types';

const entry = (lastActivity: number, id = 1): ConversationSummary =>
    ({ sessionId: id, courseId: 42, mode: 'COURSE_CHAT', entityId: 42, lastActivity });
const bucketOf = (lastActivity: number, nowMs: number) =>
    bucketHistoryByTime([entry(lastActivity)], nowMs)[0]?.bucket;

describe('bucketHistoryByTime', () => {
    it('has five buckets, in order, regardless of input order', () => {
        const now = Date.parse('2026-07-29T12:00:00+02:00');
        // Deliberately not in bucket order, and each timestamp is an explicit
        // calendar date/time literal rather than `now - N * DAY_MS`, so this
        // fixture doesn't quietly lean on the fixed-24h-span assumption the
        // fix removes from the source.
        const entries = [
            entry(Date.parse('2026-07-10T09:00:00+02:00'), 4), // last30
            entry(Date.parse('2026-07-29T09:30:00+02:00'), 1), // today
            entry(Date.parse('2026-05-01T00:00:00+02:00'), 5), // older
            entry(Date.parse('2026-07-25T18:00:00+02:00'), 3), // last7
            entry(Date.parse('2026-07-28T09:00:00+02:00'), 2), // yesterday
        ];
        expect(bucketHistoryByTime(entries, now).map((g) => g.bucket))
            .toEqual(['today', 'yesterday', 'last7', 'last30', 'older']);
    });

    it('returns an empty array for no entries', () => {
        const now = Date.parse('2026-07-29T12:00:00+02:00');
        expect(bucketHistoryByTime([], now)).toEqual([]);
    });

    it('places an entry exactly at local midnight in today, and one millisecond earlier in yesterday', () => {
        const now = Date.parse('2026-07-29T12:00:00+02:00');
        const startOfToday = Date.parse('2026-07-29T00:00:00+02:00');
        expect(bucketOf(startOfToday, now)).toBe('today');
        expect(bucketOf(startOfToday - 1, now)).toBe('yesterday');
    });

    it('places an entry exactly on the last7 lower boundary in last7', () => {
        const now = Date.parse('2026-07-29T12:00:00+02:00');
        const startOfLast7 = Date.parse('2026-07-22T00:00:00+02:00');
        expect(bucketOf(startOfLast7, now)).toBe('last7');
    });

    it('places an entry one millisecond before the last7 lower boundary in last30', () => {
        // Under the old bucket taxonomy (no last30) this landed in older;
        // last30 now sits between last7 and older, so it belongs here instead.
        const now = Date.parse('2026-07-29T12:00:00+02:00');
        const startOfLast7 = Date.parse('2026-07-22T00:00:00+02:00');
        expect(bucketOf(startOfLast7 - 1, now)).toBe('last30');
    });

    it('places an entry exactly on the last30 lower boundary in last30, and one millisecond before it in older', () => {
        const now = Date.parse('2026-07-29T12:00:00+02:00');
        const startOfLast30 = Date.parse('2026-06-29T00:00:00+02:00');
        expect(bucketOf(startOfLast30, now)).toBe('last30');
        expect(bucketOf(startOfLast30 - 1, now)).toBe('older');
    });

    it('puts a conversation continued yesterday under Yesterday even if it was created last month', () => {
        // Keyed on lastActivity, not creationDate: a continued conversation must
        // stay findable where the student last touched it. The host already
        // resolves lastActivityDate ?? creationDate into this single number.
        const now = Date.parse('2026-07-29T12:00:00+02:00');
        expect(bucketOf(Date.parse('2026-07-28T13:00:00+02:00'), now)).toBe('yesterday');
    });

    it('is correct across a spring-forward DST boundary', () => {
        // 2026-03-29 is a 23-hour day in Europe/Berlin (clocks jump 02:00 CET
        // -> 03:00 CEST). Subtracting a fixed 24 * 60 * 60 * 1000 from local
        // midnight of the 30th lands the "yesterday" boundary an hour EARLIER
        // than true local midnight of the 29th, so this entry (23:30 CET on
        // the 28th, 30 minutes before the true boundary) was wrongly pulled
        // into "yesterday" instead of "last7".
        const now = Date.parse('2026-03-30T12:00:00+02:00');
        expect(bucketOf(Date.parse('2026-03-28T23:30:00+01:00'), now)).toBe('last7');
    });

    it('is correct across a fall-back DST boundary', () => {
        // 2026-10-25 is a 25-hour day (clocks fall back 03:00 CEST -> 02:00
        // CET). Subtracting a fixed 24 * 60 * 60 * 1000 from local midnight of
        // the 26th lands the "yesterday" boundary an hour LATER than true
        // local midnight of the 25th, so this entry (00:30 CEST on the 25th,
        // 30 minutes after the true boundary) was wrongly pushed out to
        // "last7" instead of "yesterday".
        const now = Date.parse('2026-10-26T12:00:00+01:00');
        expect(bucketOf(Date.parse('2026-10-25T00:30:00+02:00'), now)).toBe('yesterday');
    });

    it('files an unparseable timestamp in Older, after every valid Older entry', () => {
        // A NaN (not just a small/zero) lastActivity is the discriminating
        // case: mixed into the same array as valid entries and sorted
        // numerically, NaN comparisons don't reliably sink to the end (V8
        // treats a NaN comparator result as "equal" and leaves it roughly in
        // place), so this only holds if invalid entries are routed to a
        // separate, unsorted-but-appended-last bucket.
        const now = Date.parse('2026-07-29T12:00:00+02:00');
        const groups = bucketHistoryByTime(
            [entry(Number.NaN, 1), entry(Date.parse('2026-01-01T00:00:00Z'), 2), entry(0, 3)],
            now,
        );
        expect(groups.at(-1)?.entries.map((e) => e.sessionId)).toEqual([2, 1, 3]);
    });

    it('sorts entries within a bucket newest-first, including two valid entries inside older', () => {
        const now = Date.parse('2026-07-29T12:00:00+02:00');
        const todayOlder = entry(Date.parse('2026-07-29T08:00:00+02:00'), 1);
        const todayNewer = entry(Date.parse('2026-07-29T11:00:00+02:00'), 2);
        const olderOlder = entry(Date.parse('2026-01-01T00:00:00+01:00'), 3);
        const olderNewer = entry(Date.parse('2026-06-01T00:00:00+02:00'), 4);
        const groups = bucketHistoryByTime([todayOlder, olderOlder, todayNewer, olderNewer], now);
        expect(groups).toEqual([
            { bucket: 'today', entries: [todayNewer, todayOlder] },
            { bucket: 'older', entries: [olderNewer, olderOlder] },
        ]);
    });

    it('omits empty buckets', () => {
        const now = Date.parse('2026-07-29T12:00:00+02:00');
        expect(bucketHistoryByTime([entry(now - 3600_000)], now).map((g) => g.bucket)).toEqual(['today']);
    });
});
