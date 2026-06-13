/**
 * Rolling-window core features (spec §0/§1): 1-char-insert rate, scroll/insert
 * ratio (N4), longest edit gap — computed at tick t over (t - eff, t] with
 * eff = max(10, min(60, t)). Port of compute_features (engine_v2.py).
 *
 * Inputs are session-relative seconds; ingestion in non-decreasing ts order.
 * Scroll events are the DEBOUNCED visibleRange stream (see Decision 5).
 */
import { SPEC } from '@extension/services/struggle/constants';

/** Index of the first element > x (upper bound) in an ascending array. */
function upperBound(arr: readonly number[], x: number): number {
    let lo = 0;
    let hi = arr.length;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (arr[mid] <= x) { lo = mid + 1; } else { hi = mid; }
    }
    return lo;
}

export interface WindowFeatures {
    readonly effectiveWindowS: number;
    readonly nOneCharInserts: number;
    readonly scrollEvents: number;
    readonly typingRate: number;
    readonly n4Ratio: number;
    readonly longestGapS: number;
    readonly fTyping: number;
    readonly fGap: number;
    readonly fN4: number;
    readonly tsState: boolean;
    readonly n4State: boolean;
}

const clip01 = (x: number): number => Math.min(1, Math.max(0, x));

export class FeatureWindowTracker {
    private readonly _ins1: number[] = [];
    private readonly _tc: number[] = [];
    private readonly _scroll: number[] = [];

    /** One textChange EVENT at ts with its count of 1-char inserts (rangeLength==0, text.length==1). */
    ingestTextChange(tsS: number, oneCharInserts: number): void {
        this._tc.push(tsS);
        for (let i = 0; i < oneCharInserts; i++) {
            this._ins1.push(tsS);
        }
    }

    /** One debounced scroll (visibleRange) event at ts. */
    ingestScroll(tsS: number): void {
        this._scroll.push(tsS);
    }

    computeAt(tS: number): WindowFeatures {
        const eff = Math.max(SPEC.MIN_EFFECTIVE_WINDOW_S, Math.min(SPEC.WINDOW_S, tS));
        const w0 = tS - eff;

        const nIns1 = upperBound(this._ins1, tS) - upperBound(this._ins1, w0);
        const nScroll = upperBound(this._scroll, tS) - upperBound(this._scroll, w0);
        const typingRate = 60 * nIns1 / eff;
        const ratio = (nScroll + 0.5) / (nIns1 + 0.5);

        const lo = upperBound(this._tc, w0);
        const hi = upperBound(this._tc, tS);
        let longestGap: number;
        if (hi > lo) {
            longestGap = 0;
            let prev = w0;
            for (let i = lo; i <= hi; i++) {
                const cur = i < hi ? this._tc[i] : tS;
                longestGap = Math.max(longestGap, cur - prev);
                prev = cur;
            }
        } else {
            const last = hi >= 1 ? this._tc[hi - 1] : 0;
            longestGap = Math.min(eff, tS - last);
        }

        return {
            effectiveWindowS: eff,
            nOneCharInserts: nIns1,
            scrollEvents: nScroll,
            typingRate,
            n4Ratio: ratio,
            longestGapS: longestGap,
            fTyping: clip01(1 - typingRate / SPEC.TYPING_ANCHOR_PER_MIN),
            fGap: clip01(longestGap / SPEC.GAP_NORM_S),
            fN4: clip01(ratio / SPEC.N4_RATIO_THRESH),
            tsState: typingRate < SPEC.TS_TYPING_THRESH_PER_MIN,
            n4State: ratio >= SPEC.N4_RATIO_THRESH,
        };
    }

    reset(): void {
        this._ins1.length = 0;
        this._tc.length = 0;
        this._scroll.length = 0;
    }
}
