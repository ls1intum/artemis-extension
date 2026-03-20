/**
 * Exam timer Worker integration test.
 *
 * Tests tick accuracy, warning state, expiry notification, and edge cases.
 * Per CONTEXT.md: tests Worker behavior through useExamTimer hook mock
 * (esbuild-plugin-inline-worker is not available in Vitest SSR environment).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';

// Mock useExamTimer hook — the worker module uses esbuild-plugin-inline-worker
// which is not available in Vitest's SSR transform environment.
vi.mock('../../../src/views/webview/hooks/useExamTimer', () => ({
    useExamTimer: vi.fn(() => ({ remaining: 0, expired: false })),
}));

import { ExamTimer } from '../../../src/views/webview/components/ExamTimer/ExamTimer';
import { useExamTimer } from '../../../src/views/webview/hooks/useExamTimer';

const mockUseExamTimer = vi.mocked(useExamTimer);

const NOW = 1_700_000_000_000;
const ONE_HOUR_MS = 60 * 60 * 1000; // 3_600_000
const ONE_MIN_MS = 60 * 1000;        // 60_000

// ============================================================================
// Tick accuracy: display updates on Worker messages
// ============================================================================

describe('ExamTimer flow: tick accuracy', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(NOW);
        mockUseExamTimer.mockReturnValue({ remaining: 0, expired: false });
    });

    afterEach(() => {
        vi.runOnlyPendingTimers();
        vi.useRealTimers();
    });

    it('displays "10min" when Worker tick reports 600000ms remaining', () => {
        mockUseExamTimer.mockReturnValue({ remaining: 600_000, expired: false });

        render(
            <ExamTimer endTime={NOW + 600_000} startTime={NOW} totalDuration={ONE_HOUR_MS} />
        );

        // 600_000ms = exactly 10 minutes → "10min" format (>= 10min rule)
        expect(screen.getByText('10min')).toBeInTheDocument();
    });

    it('displays "9min 0s" when Worker tick updates remaining to 540000ms', () => {
        mockUseExamTimer.mockReturnValue({ remaining: 540_000, expired: false });

        render(
            <ExamTimer endTime={NOW + 540_000} startTime={NOW} totalDuration={ONE_HOUR_MS} />
        );

        // 540_000ms = 9 minutes → "9min 0s" format (1-10min rule)
        expect(screen.getByText('9min 0s')).toBeInTheDocument();
    });

    it('display updates correctly across multiple tick values', () => {
        // Simulate the component receiving multiple consecutive ticks
        const { rerender } = render(
            <ExamTimer endTime={NOW + 600_000} startTime={NOW} totalDuration={ONE_HOUR_MS} />
        );

        // Tick 1: 10 minutes
        mockUseExamTimer.mockReturnValue({ remaining: 600_000, expired: false });
        rerender(
            <ExamTimer endTime={NOW + 600_000} startTime={NOW} totalDuration={ONE_HOUR_MS} />
        );
        expect(screen.getByText('10min')).toBeInTheDocument();

        // Tick 2: 5 minutes
        mockUseExamTimer.mockReturnValue({ remaining: 5 * ONE_MIN_MS, expired: false });
        rerender(
            <ExamTimer endTime={NOW + 5 * ONE_MIN_MS} startTime={NOW} totalDuration={ONE_HOUR_MS} />
        );
        expect(screen.getByText('5min 0s')).toBeInTheDocument();

        // Tick 3: 30 seconds
        mockUseExamTimer.mockReturnValue({ remaining: 30_000, expired: false });
        rerender(
            <ExamTimer endTime={NOW + 30_000} startTime={NOW} totalDuration={ONE_HOUR_MS} />
        );
        expect(screen.getByText('30s')).toBeInTheDocument();
    });

    it('displays correct format for 1 hour exactly', () => {
        mockUseExamTimer.mockReturnValue({ remaining: ONE_HOUR_MS, expired: false });

        render(
            <ExamTimer endTime={NOW + ONE_HOUR_MS} startTime={NOW} totalDuration={ONE_HOUR_MS} />
        );

        expect(screen.getByText('1h 0min')).toBeInTheDocument();
    });

    it('displays hours + minutes format for large remaining time (2h 30min)', () => {
        const twoHoursThirty = 2 * ONE_HOUR_MS + 30 * ONE_MIN_MS;
        mockUseExamTimer.mockReturnValue({ remaining: twoHoursThirty, expired: false });

        render(
            <ExamTimer endTime={NOW + twoHoursThirty} startTime={NOW} totalDuration={twoHoursThirty} />
        );

        expect(screen.getByText('2h 30min')).toBeInTheDocument();
    });
});

// ============================================================================
// Warning state: visual indicator when time is low
// ============================================================================

describe('ExamTimer flow: warning state', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(NOW);
        mockUseExamTimer.mockReturnValue({ remaining: 0, expired: false });
    });

    afterEach(() => {
        vi.runOnlyPendingTimers();
        vi.useRealTimers();
    });

    it('shows warning state when remaining time is 4 minutes (< 5min threshold)', () => {
        const fourMinutes = 4 * ONE_MIN_MS;
        mockUseExamTimer.mockReturnValue({ remaining: fourMinutes, expired: false });

        const { container } = render(
            <ExamTimer endTime={NOW + fourMinutes} startTime={NOW} totalDuration={ONE_HOUR_MS} />
        );

        // Warning class applied to timer element when < 5min remaining
        const timerEl = container.querySelector('[class*="warning"]');
        expect(timerEl).toBeInTheDocument();
    });

    it('shows warning state when remaining time is 4min 59s', () => {
        const nearFive = 4 * ONE_MIN_MS + 59_000;
        mockUseExamTimer.mockReturnValue({ remaining: nearFive, expired: false });

        const { container } = render(
            <ExamTimer endTime={NOW + nearFive} startTime={NOW} totalDuration={ONE_HOUR_MS} />
        );

        const timerEl = container.querySelector('[class*="warning"]');
        expect(timerEl).toBeInTheDocument();
        expect(screen.getByText('4min 59s')).toBeInTheDocument();
    });

    it('does NOT show warning state at 5 minutes exactly', () => {
        const fiveMinutes = 5 * ONE_MIN_MS;
        mockUseExamTimer.mockReturnValue({ remaining: fiveMinutes, expired: false });

        const { container } = render(
            <ExamTimer endTime={NOW + fiveMinutes} startTime={NOW} totalDuration={ONE_HOUR_MS} />
        );

        // Exactly 5 minutes: isWarning = remaining < 5 * 60 * 1000 → false
        const warningEl = container.querySelector('[class*="warning"]');
        expect(warningEl).not.toBeInTheDocument();
    });

    it('does NOT show warning state when not expired and time > 5min', () => {
        mockUseExamTimer.mockReturnValue({ remaining: 15 * ONE_MIN_MS, expired: false });

        const { container } = render(
            <ExamTimer endTime={NOW + 15 * ONE_MIN_MS} startTime={NOW} totalDuration={ONE_HOUR_MS} />
        );

        const warningEl = container.querySelector('[class*="warning"]');
        expect(warningEl).not.toBeInTheDocument();
    });

    it('does NOT show warning class when expired (expired takes precedence)', () => {
        mockUseExamTimer.mockReturnValue({ remaining: 0, expired: true });

        const { container } = render(
            <ExamTimer endTime={NOW} startTime={NOW - ONE_HOUR_MS} totalDuration={ONE_HOUR_MS} />
        );

        // When expired=true, isWarning is false (remaining < threshold AND !expired)
        const warningEl = container.querySelector('[class*="warning"]');
        expect(warningEl).not.toBeInTheDocument();
    });
});

// ============================================================================
// Expiry: timer shows expired state and displays zero time
// ============================================================================

describe('ExamTimer flow: expiry notification', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(NOW);
        mockUseExamTimer.mockReturnValue({ remaining: 0, expired: false });
    });

    afterEach(() => {
        vi.runOnlyPendingTimers();
        vi.useRealTimers();
    });

    it('shows expired UI state when tick reports remaining=0, expired=true', () => {
        mockUseExamTimer.mockReturnValue({ remaining: 0, expired: true });

        const { container } = render(
            <ExamTimer endTime={NOW} startTime={NOW - ONE_HOUR_MS} totalDuration={ONE_HOUR_MS} />
        );

        // Expired class applied to timer element
        const expiredEl = container.querySelector('[class*="expired"]');
        expect(expiredEl).toBeInTheDocument();
    });

    it('shows 0s display when expired', () => {
        mockUseExamTimer.mockReturnValue({ remaining: 0, expired: true });

        render(
            <ExamTimer endTime={NOW} startTime={NOW - ONE_HOUR_MS} totalDuration={ONE_HOUR_MS} />
        );

        expect(screen.getByText('0s')).toBeInTheDocument();
    });

    it('transitions from active to expired display', () => {
        const { rerender, container } = render(
            <ExamTimer endTime={NOW + 60_000} startTime={NOW} totalDuration={ONE_HOUR_MS} />
        );

        // Active state
        mockUseExamTimer.mockReturnValue({ remaining: 60_000, expired: false });
        rerender(
            <ExamTimer endTime={NOW + 60_000} startTime={NOW} totalDuration={ONE_HOUR_MS} />
        );
        expect(screen.getByText('1min 0s')).toBeInTheDocument();

        // Expired state
        mockUseExamTimer.mockReturnValue({ remaining: 0, expired: true });
        rerender(
            <ExamTimer endTime={NOW} startTime={NOW - ONE_HOUR_MS} totalDuration={ONE_HOUR_MS} />
        );
        expect(screen.getByText('0s')).toBeInTheDocument();
        expect(container.querySelector('[class*="expired"]')).toBeInTheDocument();
    });
});

// ============================================================================
// Edge cases
// ============================================================================

describe('ExamTimer flow: edge cases', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(NOW);
        mockUseExamTimer.mockReturnValue({ remaining: 0, expired: false });
    });

    afterEach(() => {
        vi.runOnlyPendingTimers();
        vi.useRealTimers();
    });

    it('handles zero initial remaining time gracefully', () => {
        mockUseExamTimer.mockReturnValue({ remaining: 0, expired: false });

        render(
            <ExamTimer endTime={NOW} startTime={NOW} totalDuration={ONE_HOUR_MS} />
        );

        expect(screen.getByText('0s')).toBeInTheDocument();
    });

    it('handles very large remaining time without crashing (8 hours)', () => {
        const eightHours = 8 * ONE_HOUR_MS;
        mockUseExamTimer.mockReturnValue({ remaining: eightHours, expired: false });

        render(
            <ExamTimer endTime={NOW + eightHours} startTime={NOW} totalDuration={eightHours} />
        );

        expect(screen.getByText('8h 0min')).toBeInTheDocument();
    });

    it('renders progress bar element', () => {
        mockUseExamTimer.mockReturnValue({ remaining: ONE_HOUR_MS, expired: false });

        const { container } = render(
            <ExamTimer endTime={NOW + ONE_HOUR_MS} startTime={NOW} totalDuration={ONE_HOUR_MS} />
        );

        expect(container.querySelector('[class*="progressBar"]')).toBeInTheDocument();
    });

    it('useExamTimer hook is called with the provided endTime', () => {
        const endTime = NOW + ONE_HOUR_MS;
        mockUseExamTimer.mockReturnValue({ remaining: ONE_HOUR_MS, expired: false });

        render(
            <ExamTimer endTime={endTime} startTime={NOW} totalDuration={ONE_HOUR_MS} />
        );

        expect(mockUseExamTimer).toHaveBeenCalledWith(endTime);
    });

    it('handles 1 second remaining correctly (1s)', () => {
        mockUseExamTimer.mockReturnValue({ remaining: 1_000, expired: false });

        render(
            <ExamTimer endTime={NOW + 1_000} startTime={NOW} totalDuration={ONE_HOUR_MS} />
        );

        expect(screen.getByText('1s')).toBeInTheDocument();
    });
});
