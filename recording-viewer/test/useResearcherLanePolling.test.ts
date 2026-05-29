import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useRef } from 'react';
import { useResearcherLanePolling, type ResearcherLane } from '../src/hooks/useResearcherLanePolling';

const LANES: ResearcherLane[] = [{ raterId: 'r_a', raterName: 'Alice', annotations: [] }];
const okRes = (body: unknown) => ({ ok: true, json: async () => body } as unknown as Response);

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('useResearcherLanePolling', () => {
    it('polls /annotations/all and forwards lanes while enabled', async () => {
        const apiFetch = vi.fn().mockResolvedValue(okRes(LANES));
        const onLanes = vi.fn();
        renderHook(() => {
            const ref = useRef<string | null>('s1');
            ref.current = 's1';
            useResearcherLanePolling(true, ref, apiFetch, onLanes, 1000);
        });
        await vi.advanceTimersByTimeAsync(1000);
        expect(apiFetch).toHaveBeenCalledWith('/api/recordings/s1/annotations/all');
        expect(onLanes).toHaveBeenCalledWith(LANES);
    });

    it('does not poll while disabled', async () => {
        const apiFetch = vi.fn().mockResolvedValue(okRes(LANES));
        const onLanes = vi.fn();
        renderHook(() => {
            const ref = useRef<string | null>('s1');
            ref.current = 's1';
            useResearcherLanePolling(false, ref, apiFetch, onLanes, 1000);
        });
        await vi.advanceTimersByTimeAsync(3000);
        expect(apiFetch).not.toHaveBeenCalled();
        expect(onLanes).not.toHaveBeenCalled();
    });

    it('re-targets the poll when the active session id changes', async () => {
        const apiFetch = vi.fn().mockResolvedValue(okRes(LANES));
        const onLanes = vi.fn();
        const { rerender } = renderHook(
            ({ id }: { id: string }) => {
                const ref = useRef<string | null>(id);
                ref.current = id;
                useResearcherLanePolling(true, ref, apiFetch, onLanes, 1000);
            },
            { initialProps: { id: 's1' } },
        );
        await vi.advanceTimersByTimeAsync(1000);
        expect(apiFetch).toHaveBeenLastCalledWith('/api/recordings/s1/annotations/all');
        rerender({ id: 's2' });
        await vi.advanceTimersByTimeAsync(1000);
        expect(apiFetch).toHaveBeenLastCalledWith('/api/recordings/s2/annotations/all');
    });

    it('stops polling once disabled', async () => {
        const apiFetch = vi.fn().mockResolvedValue(okRes(LANES));
        const onLanes = vi.fn();
        const { rerender } = renderHook(
            ({ enabled }: { enabled: boolean }) => {
                const ref = useRef<string | null>('s1');
                ref.current = 's1';
                useResearcherLanePolling(enabled, ref, apiFetch, onLanes, 1000);
            },
            { initialProps: { enabled: true } },
        );
        await vi.advanceTimersByTimeAsync(1000);
        const callsWhileEnabled = apiFetch.mock.calls.length;
        expect(callsWhileEnabled).toBeGreaterThan(0);
        rerender({ enabled: false });
        await vi.advanceTimersByTimeAsync(3000);
        expect(apiFetch.mock.calls.length).toBe(callsWhileEnabled);
    });

    it('drops a poll result that resolves after polling is disabled', async () => {
        let resolve!: (r: Response) => void;
        const apiFetch = vi.fn().mockImplementation(() => new Promise<Response>((r) => { resolve = r; }));
        const onLanes = vi.fn();
        const { rerender } = renderHook(
            ({ enabled }: { enabled: boolean }) => {
                const ref = useRef<string | null>('s1');
                ref.current = 's1';
                useResearcherLanePolling(enabled, ref, apiFetch, onLanes, 1000);
            },
            { initialProps: { enabled: true } },
        );
        await vi.advanceTimersByTimeAsync(1000); // starts a fetch that has not resolved
        expect(apiFetch).toHaveBeenCalledTimes(1);
        rerender({ enabled: false });           // effect cleanup sets cancelled = true
        resolve(okRes(LANES));                  // poll resolves AFTER being disabled
        await vi.advanceTimersByTimeAsync(0);   // flush the awaited continuation
        expect(onLanes).not.toHaveBeenCalled(); // stale write must be dropped
    });

    it('does not overlap requests when a poll is still in flight', async () => {
        let resolve!: (r: Response) => void;
        const apiFetch = vi.fn().mockImplementation(() => new Promise<Response>((r) => { resolve = r; }));
        const onLanes = vi.fn();
        renderHook(() => {
            const ref = useRef<string | null>('s1');
            ref.current = 's1';
            useResearcherLanePolling(true, ref, apiFetch, onLanes, 1000);
        });
        // First tick starts a fetch that never resolves yet.
        await vi.advanceTimersByTimeAsync(1000);
        // Subsequent ticks must not start a second concurrent fetch.
        await vi.advanceTimersByTimeAsync(3000);
        expect(apiFetch).toHaveBeenCalledTimes(1);
        // Once it resolves, the guard releases and polling can resume.
        resolve(okRes(LANES));
        await vi.advanceTimersByTimeAsync(1000);
        expect(apiFetch).toHaveBeenCalledTimes(2);
    });
});
