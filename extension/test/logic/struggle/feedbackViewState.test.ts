import { describe, expect, it } from 'vitest';

import { FeedbackViewTracker } from '@extension/services/struggle/signals/feedbackViewState';

describe('FeedbackViewTracker (f_fb interval overlap)', () => {
    it('open interval overlaps the window while open', () => {
        const f = new FeedbackViewTracker();
        f.ingest(15, 'opened', 'v1');
        expect(f.openOverlapping(0, 10)).toBe(false);   // opened after t=10
        expect(f.openOverlapping(0, 20)).toBe(true);
        expect(f.openOverlapping(60, 120)).toBe(true);  // still open
    });
    it('closed interval [a,b): start <= t AND end > w0', () => {
        const f = new FeedbackViewTracker();
        f.ingest(15, 'opened', 'v1');
        f.ingest(25, 'closed', 'v1');
        expect(f.openOverlapping(0, 20)).toBe(true);
        expect(f.openOverlapping(20, 80)).toBe(true);   // end 25 > w0 20
        expect(f.openOverlapping(25, 85)).toBe(false);  // end 25 NOT > w0 25
    });
    it('tracks independent viewIds; tolerates unmatched close (logged, not thrown)', () => {
        const f = new FeedbackViewTracker();
        f.ingest(10, 'opened', 'a');
        f.ingest(12, 'closed', 'b');                    // unmatched: ignored
        f.ingest(20, 'closed', 'a');
        expect(f.openOverlapping(15, 75)).toBe(true);
        expect(f.openOverlapping(20, 80)).toBe(false);
    });
});
