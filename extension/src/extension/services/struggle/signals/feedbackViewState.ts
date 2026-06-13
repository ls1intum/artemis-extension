/**
 * Task-feedback view state (E1, f_fb): open/close intervals per viewId; the
 * window query mirrors Python's (start <= t) & (end > w0) with open views
 * extending to infinity. Unmatched closes are ignored (live tolerance; the
 * offline pipeline raised — declared engineering difference, log-only).
 */
export class FeedbackViewTracker {
    private readonly _openAt = new Map<string, number>();
    private readonly _closed: Array<{ start: number; end: number }> = [];

    ingest(tsS: number, action: 'opened' | 'closed', viewId: string): void {
        if (action === 'opened') {
            this._openAt.set(viewId, tsS);
            return;
        }
        const start = this._openAt.get(viewId);
        if (start === undefined) {
            return;                                  // unmatched close: tolerate
        }
        this._openAt.delete(viewId);
        this._closed.push({ start, end: tsS });
    }

    /** Was a feedback view open anywhere in (w0, t]? (Python overlap predicate) */
    openOverlapping(w0S: number, tS: number): boolean {
        for (const start of this._openAt.values()) {
            if (start <= tS) { return true; }        // open view: end = infinity > w0
        }
        return this._closed.some(iv => iv.start <= tS && iv.end > w0S);
    }

    reset(): void {
        this._openAt.clear();
        this._closed.length = 0;
    }
}
