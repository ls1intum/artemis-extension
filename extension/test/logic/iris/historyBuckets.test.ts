import { describe, expect, it } from 'vitest';

import type { CourseHistoryEntryVM } from '@webview/views/IrisChat/historyBuckets';
import { bucketHistoryByTime } from '@webview/views/IrisChat/historyBuckets';

// Fixed "now": July 21 2026, 15:00 local. All entry timestamps below are
// built the same way (new Date(y, m, d, h)) so the boundaries stay correct
// regardless of which timezone the test runner executes in.
const NOW = new Date(2026, 6, 21, 15, 0, 0).getTime();

let nextId = 1;
function entry(over: Partial<CourseHistoryEntryVM> & { lastActivity: number }): CourseHistoryEntryVM {
    const id = nextId++;
    return {
        artemisSessionId: id,
        courseId: 1,
        mode: 'COURSE_CHAT',
        entityId: 1,
        title: `entry-${id}`,
        ...over,
    };
}

describe('bucketHistoryByTime', () => {
    it('places an entry from today in the today bucket', () => {
        const e = entry({ lastActivity: new Date(2026, 6, 21, 9, 0, 0).getTime() });
        const out = bucketHistoryByTime([e], NOW);
        expect(out).toEqual([{ bucket: 'today', entries: [e] }]);
    });

    it('places an entry exactly at the start of today (midnight) in today, not yesterday', () => {
        const e = entry({ lastActivity: new Date(2026, 6, 21, 0, 0, 0).getTime() });
        const out = bucketHistoryByTime([e], NOW);
        expect(out).toEqual([{ bucket: 'today', entries: [e] }]);
    });

    it('places an entry one millisecond before midnight in yesterday', () => {
        const e = entry({ lastActivity: new Date(2026, 6, 21, 0, 0, 0).getTime() - 1 });
        const out = bucketHistoryByTime([e], NOW);
        expect(out).toEqual([{ bucket: 'yesterday', entries: [e] }]);
    });

    it('places an entry from yesterday in the yesterday bucket', () => {
        const e = entry({ lastActivity: new Date(2026, 6, 20, 23, 0, 0).getTime() });
        const out = bucketHistoryByTime([e], NOW);
        expect(out).toEqual([{ bucket: 'yesterday', entries: [e] }]);
    });

    it('places an entry from 5 days ago in the last7 bucket', () => {
        const e = entry({ lastActivity: new Date(2026, 6, 16, 12, 0, 0).getTime() });
        const out = bucketHistoryByTime([e], NOW);
        expect(out).toEqual([{ bucket: 'last7', entries: [e] }]);
    });

    it('places an entry exactly 7 days before today (the last7 lower boundary) in last7', () => {
        const e = entry({ lastActivity: new Date(2026, 6, 14, 0, 0, 0).getTime() });
        const out = bucketHistoryByTime([e], NOW);
        expect(out).toEqual([{ bucket: 'last7', entries: [e] }]);
    });

    it('places an entry one millisecond before the last7 lower boundary in older', () => {
        const e = entry({ lastActivity: new Date(2026, 6, 14, 0, 0, 0).getTime() - 1 });
        const out = bucketHistoryByTime([e], NOW);
        expect(out).toEqual([{ bucket: 'older', entries: [e] }]);
    });

    it('places a long-past entry in the older bucket', () => {
        const e = entry({ lastActivity: new Date(2024, 0, 1, 0, 0, 0).getTime() });
        const out = bucketHistoryByTime([e], NOW);
        expect(out).toEqual([{ bucket: 'older', entries: [e] }]);
    });

    it('sorts entries within a bucket newest-first', () => {
        const older = entry({ lastActivity: new Date(2026, 6, 21, 8, 0, 0).getTime() });
        const newer = entry({ lastActivity: new Date(2026, 6, 21, 12, 0, 0).getTime() });
        const out = bucketHistoryByTime([older, newer], NOW);
        expect(out).toEqual([{ bucket: 'today', entries: [newer, older] }]);
    });

    it('sorts invalid/zero timestamps after valid entries within older, valid ones still newest-first', () => {
        const validNewer = entry({ lastActivity: new Date(2025, 5, 1, 0, 0, 0).getTime() });
        const validOlder = entry({ lastActivity: new Date(2024, 0, 1, 0, 0, 0).getTime() });
        const invalidZero = entry({ lastActivity: 0 });
        const invalidNaN = entry({ lastActivity: Number.NaN });

        const out = bucketHistoryByTime([invalidNaN, validOlder, invalidZero, validNewer], NOW);

        // Among the invalid entries, input order is preserved (no data-driven
        // ordering is specified between them — only that they land after
        // every validly dated entry).
        expect(out).toEqual([
            { bucket: 'older', entries: [validNewer, validOlder, invalidNaN, invalidZero] },
        ]);
    });

    it('returns buckets in fixed order (today, yesterday, last7, older) regardless of input order, omitting empty ones', () => {
        const todayEntry = entry({ lastActivity: new Date(2026, 6, 21, 9, 0, 0).getTime() });
        const olderEntry = entry({ lastActivity: new Date(2024, 0, 1, 0, 0, 0).getTime() });
        const last7Entry = entry({ lastActivity: new Date(2026, 6, 16, 0, 0, 0).getTime() });

        // Deliberately out of bucket order, and no yesterday entry at all.
        const out = bucketHistoryByTime([olderEntry, todayEntry, last7Entry], NOW);

        expect(out.map((g) => g.bucket)).toEqual(['today', 'last7', 'older']);
    });

    it('returns an empty array for no entries', () => {
        expect(bucketHistoryByTime([], NOW)).toEqual([]);
    });
});
