import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';

// Mock useExamTimer hook — the worker module uses esbuild-plugin-inline-worker
// which is not available in Vitest's SSR environment.
// Testing the component behavior through the hook's public interface is the correct approach.
vi.mock('../../../../src/webview/hooks/useExamTimer', () => ({
	useExamTimer: vi.fn(() => ({ remaining: 0, expired: false })),
}));

import { ExamTimer } from '../../../../src/webview/components/ExamTimer/ExamTimer';
import { useExamTimer } from '../../../../src/webview/hooks/useExamTimer';

const mockUseExamTimer = vi.mocked(useExamTimer);

const NOW = 1_700_000_000_000;
const ONE_HOUR_MS = 60 * 60 * 1000;
const ONE_MIN_MS = 60 * 1000;

describe('ExamTimer', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(NOW);
		mockUseExamTimer.mockReturnValue({ remaining: 0, expired: false });
	});

	afterEach(() => {
		vi.runOnlyPendingTimers();
		vi.useRealTimers();
	});

	it('renders the timer container', () => {
		mockUseExamTimer.mockReturnValue({ remaining: ONE_HOUR_MS, expired: false });
		const { container } = render(
			<ExamTimer endTime={NOW + ONE_HOUR_MS} startTime={NOW} totalDuration={ONE_HOUR_MS} />
		);
		expect(container.firstChild).toBeInTheDocument();
	});

	it('calls useExamTimer hook with the provided endTime', () => {
		const endTime = NOW + ONE_HOUR_MS;
		mockUseExamTimer.mockReturnValue({ remaining: ONE_HOUR_MS, expired: false });

		render(
			<ExamTimer endTime={endTime} startTime={NOW} totalDuration={ONE_HOUR_MS} />
		);

		expect(mockUseExamTimer).toHaveBeenCalledWith(endTime);
	});

	it('displays time in hours+minutes format for >= 1 hour remaining (1h 7min)', () => {
		mockUseExamTimer.mockReturnValue({ remaining: ONE_HOUR_MS + 7 * ONE_MIN_MS, expired: false });

		render(
			<ExamTimer endTime={NOW + ONE_HOUR_MS} startTime={NOW} totalDuration={ONE_HOUR_MS} />
		);

		expect(screen.getByText('1h 7min')).toBeInTheDocument();
	});

	it('displays time in minutes format for >= 10 minutes remaining (15min)', () => {
		mockUseExamTimer.mockReturnValue({ remaining: 15 * ONE_MIN_MS, expired: false });

		render(
			<ExamTimer endTime={NOW + 15 * ONE_MIN_MS} startTime={NOW} totalDuration={30 * ONE_MIN_MS} />
		);

		expect(screen.getByText('15min')).toBeInTheDocument();
	});

	it('displays time in minutes+seconds format for 1-10 minutes remaining (8min 0s)', () => {
		mockUseExamTimer.mockReturnValue({ remaining: 8 * ONE_MIN_MS, expired: false });

		render(
			<ExamTimer endTime={NOW + 8 * ONE_MIN_MS} startTime={NOW} totalDuration={30 * ONE_MIN_MS} />
		);

		expect(screen.getByText('8min 0s')).toBeInTheDocument();
	});

	it('displays time in seconds format for < 1 minute remaining (45s)', () => {
		mockUseExamTimer.mockReturnValue({ remaining: 45_000, expired: false });

		render(
			<ExamTimer endTime={NOW + 45_000} startTime={NOW} totalDuration={ONE_HOUR_MS} />
		);

		expect(screen.getByText('45s')).toBeInTheDocument();
	});

	it('shows 0s when expired', () => {
		mockUseExamTimer.mockReturnValue({ remaining: 0, expired: true });

		render(
			<ExamTimer endTime={NOW} startTime={NOW - ONE_HOUR_MS} totalDuration={ONE_HOUR_MS} />
		);

		expect(screen.getByText('0s')).toBeInTheDocument();
	});

	it('renders timer element with expected text', () => {
		mockUseExamTimer.mockReturnValue({ remaining: 5 * ONE_MIN_MS, expired: false });

		const { container } = render(
			<ExamTimer endTime={NOW + 5 * ONE_MIN_MS} startTime={NOW} totalDuration={ONE_HOUR_MS} />
		);

		expect(container.querySelector('[class*="timer"]')).toBeInTheDocument();
		expect(screen.getByText('5min 0s')).toBeInTheDocument();
	});

	it('renders progress bar container', () => {
		mockUseExamTimer.mockReturnValue({ remaining: ONE_HOUR_MS, expired: false });

		const { container } = render(
			<ExamTimer endTime={NOW + ONE_HOUR_MS} startTime={NOW} totalDuration={ONE_HOUR_MS} />
		);

		expect(container.querySelector('[class*="progressBar"]')).toBeInTheDocument();
	});

	it('displays correct format for very large remaining time (2h 30min)', () => {
		const twoHours = 2 * ONE_HOUR_MS + 30 * ONE_MIN_MS;
		mockUseExamTimer.mockReturnValue({ remaining: twoHours, expired: false });

		render(
			<ExamTimer endTime={NOW + twoHours} startTime={NOW} totalDuration={twoHours} />
		);

		expect(screen.getByText('2h 30min')).toBeInTheDocument();
	});

	it('displays warning-zone time correctly (4min 59s)', () => {
		const warningRemaining = 4 * ONE_MIN_MS + 59 * 1000;
		mockUseExamTimer.mockReturnValue({ remaining: warningRemaining, expired: false });

		render(
			<ExamTimer endTime={NOW + warningRemaining} startTime={NOW} totalDuration={ONE_HOUR_MS} />
		);

		expect(screen.getByText('4min 59s')).toBeInTheDocument();
	});

	it('displays only seconds format at exactly 59 seconds (59s)', () => {
		mockUseExamTimer.mockReturnValue({ remaining: 59_000, expired: false });

		render(
			<ExamTimer endTime={NOW + 59_000} startTime={NOW} totalDuration={ONE_HOUR_MS} />
		);

		expect(screen.getByText('59s')).toBeInTheDocument();
	});

	it('handles exactly 10 minutes remaining (10min)', () => {
		mockUseExamTimer.mockReturnValue({ remaining: 10 * ONE_MIN_MS, expired: false });

		render(
			<ExamTimer endTime={NOW + 10 * ONE_MIN_MS} startTime={NOW} totalDuration={ONE_HOUR_MS} />
		);

		expect(screen.getByText('10min')).toBeInTheDocument();
	});
});
