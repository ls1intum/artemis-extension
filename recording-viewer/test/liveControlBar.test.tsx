import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, act } from '@testing-library/react';
import { LiveControlBar } from '../src/components/LiveControlBar';

const baseProps = {
    connected: true,
    bufferSize: 10,
    totalReceived: 10,
    latestEventTimestamp: null,
} as const;

describe('LiveControlBar elapsed timer', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-05-31T12:00:00Z'));
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it('shows the elapsed time during live mode and ticks every second', () => {
        const start = Date.now() - 65_000; // 1m 5s ago
        const { container } = render(<LiveControlBar {...baseProps} startTime={start} />);

        const elapsed = () => container.querySelector('.live-elapsed')?.textContent ?? '';
        expect(elapsed()).toBe('1m 5s');

        act(() => { vi.advanceTimersByTime(5_000); });
        expect(elapsed()).toBe('1m 10s');
    });

    it('hides the elapsed timer when the start time is unknown', () => {
        const { container } = render(<LiveControlBar {...baseProps} startTime={0} />);
        expect(container.querySelector('.live-elapsed')).toBeNull();
    });
});
