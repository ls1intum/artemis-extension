import { describe, expect, it } from 'vitest';

import type { CourseHistoryEntryVM } from '@webview/views/IrisChat/historyBuckets';
import { bucketHistoryByTime } from '@webview/views/IrisChat/historyBuckets';

const entry = (lastActivity: number, id = 1): CourseHistoryEntryVM =>
    ({ artemisSessionId: id, courseId: 42, mode: 'COURSE_CHAT', entityId: 42, lastActivity });
const bucketOf = (lastActivity: number, nowMs: number) =>
    bucketHistoryByTime([entry(lastActivity)], nowMs)[0]?.bucket;

describe('bucketHistoryByTime', () => {
    it('has five buckets, in order', () => {
        const now = Date.parse('2026-07-29T12:00:00+02:00');
        const DAY = 24 * 60 * 60 * 1000;
        const entries = [
            entry(now - 3600_000, 1),      // today
            entry(now - 26 * 3600_000, 2), // yesterday
            entry(now - 3 * DAY, 3),       // last7
            entry(now - 10 * DAY, 4),      // last30
            entry(now - 60 * DAY, 5),      // older
        ];
        expect(bucketHistoryByTime(entries, now).map((g) => g.bucket))
            .toEqual(['today', 'yesterday', 'last7', 'last30', 'older']);
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
        expect(groups.at(-1)?.entries.map((e) => e.artemisSessionId)).toEqual([2, 1, 3]);
    });

    it('omits empty buckets', () => {
        const now = Date.parse('2026-07-29T12:00:00+02:00');
        expect(bucketHistoryByTime([entry(now - 3600_000)], now).map((g) => g.bucket)).toEqual(['today']);
    });
});
