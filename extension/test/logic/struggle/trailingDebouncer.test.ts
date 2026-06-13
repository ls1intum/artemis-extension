import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TrailingDebouncer } from '@extension/services/struggle/intake/trailingDebouncer';

describe('TrailingDebouncer (recorder-parity: trailing, per key, last payload+ts wins)', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it('emits the LAST payload of a burst after the quiet period', () => {
        const out: number[] = [];
        const d = new TrailingDebouncer<number>(300, v => out.push(v));
        d.push('a', 1); vi.advanceTimersByTime(100);
        d.push('a', 2); vi.advanceTimersByTime(100);
        d.push('a', 3);
        expect(out).toEqual([]);
        vi.advanceTimersByTime(300);
        expect(out).toEqual([3]);
    });

    it('keys debounce independently', () => {
        const out: number[] = [];
        const d = new TrailingDebouncer<number>(300, v => out.push(v));
        d.push('a', 1);
        d.push('b', 2);
        vi.advanceTimersByTime(300);
        expect(out.sort()).toEqual([1, 2]);
    });

    it('flush() emits all pending immediately; dispose() discards', () => {
        const out: number[] = [];
        const d = new TrailingDebouncer<number>(300, v => out.push(v));
        d.push('a', 1);
        d.flush();
        expect(out).toEqual([1]);
        d.push('a', 2);
        d.dispose();
        vi.advanceTimersByTime(1000);
        expect(out).toEqual([1]);
    });
});
