import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useBuildProgress } from '@webview/hooks/useBuildProgress';

describe('useBuildProgress', () => {
    // 60-second build window starting exactly at the mocked system time
    const start = '2026-01-01T10:00:00.000Z';
    const eta = '2026-01-01T10:01:00.000Z';

    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(start));
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('returns nulls when not building', () => {
        const { result } = renderHook(() => useBuildProgress(false, start, eta));
        expect(result.current.etaSeconds).toBeNull();
        expect(result.current.progressPercent).toBeNull();
    });

    it('returns nulls when timing info is missing', () => {
        const { result } = renderHook(() => useBuildProgress(true, undefined, undefined));
        expect(result.current.etaSeconds).toBeNull();
        expect(result.current.progressPercent).toBeNull();
    });

    it('returns nulls when eta is not after start', () => {
        const { result } = renderHook(() => useBuildProgress(true, eta, start));
        expect(result.current.etaSeconds).toBeNull();
        expect(result.current.progressPercent).toBeNull();
    });

    it('counts down and reports clamped progress', () => {
        const { result } = renderHook(() => useBuildProgress(true, start, eta));

        // t=0: full ETA remaining, percent clamped to the 5% floor
        expect(result.current.etaSeconds).toBe(60);
        expect(result.current.progressPercent).toBe(5);

        act(() => {
            vi.advanceTimersByTime(30_000);
        });
        expect(result.current.etaSeconds).toBe(30);
        expect(result.current.progressPercent).toBe(50);
    });

    it('returns nulls once the estimated window has elapsed', () => {
        const { result } = renderHook(() => useBuildProgress(true, start, eta));

        act(() => {
            vi.advanceTimersByTime(61_000);
        });
        expect(result.current.etaSeconds).toBeNull();
        expect(result.current.progressPercent).toBeNull();
    });

    it('resets to nulls when building stops', () => {
        const { result, rerender } = renderHook(
            ({ building }: { building: boolean }) => useBuildProgress(building, start, eta),
            { initialProps: { building: true } },
        );
        expect(result.current.etaSeconds).toBe(60);

        rerender({ building: false });
        expect(result.current.etaSeconds).toBeNull();
        expect(result.current.progressPercent).toBeNull();
    });
});
