import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SubmissionStatus } from '@webview/components/exercise/SubmissionStatus';

describe('SubmissionStatus', () => {
	it('shows no-submission state for programming exercise', () => {
		render(<SubmissionStatus status="no-submission" exerciseType="programming" />);
		expect(screen.getByText('No builds yet — submit to see results')).toBeInTheDocument();
	});

	it('shows building state with an indeterminate bar (no fixed width) and message', () => {
		render(<SubmissionStatus status="building" />);
		expect(screen.getByText('Building your submission...')).toBeInTheDocument();
		// No timing info -> indeterminate bar carries no inline width.
		expect(screen.getByTestId('build-progress-bar').style.width).toBe('');
	});

	it('shows pending state with queued message', () => {
		render(<SubmissionStatus status="pending" />);
		expect(screen.getByText(/Build queued/)).toBeInTheDocument();
	});

	it('shows success build status badge for success state', () => {
		render(<SubmissionStatus status="success" score={80} maxScore={100} scorePercentage={80} />);
		expect(screen.getByText('Build Success')).toBeInTheDocument();
	});

	it('shows failed build status badge for failed state', () => {
		render(<SubmissionStatus status="failed" score={0} maxScore={100} scorePercentage={0} />);
		expect(screen.getByText('Tests Failed')).toBeInTheDocument();
	});

	it('shows Build failed text with Go to source and Open log when buildFailed is true', () => {
		render(<SubmissionStatus status="failed" buildFailed={true} score={0} maxScore={0} scorePercentage={0} />);
		expect(screen.getByText('Build failed')).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Go to source' })).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Open log' })).toBeInTheDocument();
		expect(screen.queryByRole('button', { name: 'See test results' })).not.toBeInTheDocument();
	});

	it('appends a Results link when buildFailed and hasTestInfo', () => {
		render(
			<SubmissionStatus
				status="failed"
				buildFailed={true}
				hasTestInfo={true}
				totalTests={5}
				passedTests={1}
				score={4}
				maxScore={100}
				scorePercentage={4}
			/>
		);
		expect(screen.getByText('Build failed')).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'See test results' })).toBeInTheDocument();
	});

	it('displays score fraction in programming exercise', () => {
		render(<SubmissionStatus status="success" score={75} maxScore={100} scorePercentage={75} />);
		expect(screen.getByText(/75\/100/)).toBeInTheDocument();
	});

	it('shows test pass count badge (X/Y tests) when hasTestInfo is true', () => {
		render(
			<SubmissionStatus
				status="success"
				hasTestInfo={true}
				totalTests={10}
				passedTests={8}
				score={80}
				maxScore={100}
				scorePercentage={80}
			/>
		);
		expect(screen.getByText('8/10 tests')).toBeInTheDocument();
	});

	it('shows Results link when hasTestInfo is true', () => {
		render(
			<SubmissionStatus
				status="success"
				hasTestInfo={true}
				totalTests={5}
				passedTests={5}
				score={100}
				maxScore={100}
				scorePercentage={100}
			/>
		);
		expect(screen.getByRole('button', { name: 'See test results' })).toBeInTheDocument();
	});

	it('calls onOpenTestResults when Results link is clicked', async () => {
		const onOpen = vi.fn();
		render(
			<SubmissionStatus
				status="success"
				hasTestInfo={true}
				totalTests={5}
				passedTests={4}
				score={80}
				maxScore={100}
				scorePercentage={80}
				onOpenTestResults={onOpen}
			/>
		);
		await userEvent.click(screen.getByRole('button', { name: 'See test results' }));
		expect(onOpen).toHaveBeenCalledOnce();
	});

	it('renders points expression "pts/max p (pct%)" when the exercise has points', () => {
		render(
			<SubmissionStatus
				status="failed"
				hasTestInfo={true}
				totalTests={35}
				passedTests={8}
				score={23.1}
				maxScore={101}
				scorePercentage={22.9}
			/>
		);
		expect(screen.getByText(/23\.1\/101 points/)).toBeInTheDocument();
		expect(screen.getByText(/\(22\.9%\)/)).toBeInTheDocument();
	});

	it('falls back to just the percent when the exercise has no points (maxScore 0)', () => {
		render(
			<SubmissionStatus
				status="failed"
				hasTestInfo={true}
				totalTests={35}
				passedTests={8}
				score={0}
				maxScore={0}
				scorePercentage={22.9}
			/>
		);
		expect(screen.getByText('22.9%')).toBeInTheDocument();
		expect(screen.queryByText(/points/)).not.toBeInTheDocument();
	});

	it('shows Submitted badge for non-programming success state', () => {
		render(<SubmissionStatus status="success" exerciseType="text" score={0} maxScore={0} />);
		expect(screen.getByText('Submitted')).toBeInTheDocument();
	});

	it('shows No Submission badge for non-programming failed state', () => {
		render(<SubmissionStatus status="failed" exerciseType="text" score={0} maxScore={0} />);
		expect(screen.getByText('No Submission')).toBeInTheDocument();
	});

	it('shows Draft Saved badge for non-programming partial state', () => {
		render(<SubmissionStatus status="partial" exerciseType="text" score={0} maxScore={0} />);
		expect(screen.getByText('Draft Saved')).toBeInTheDocument();
	});

	it('shows score in non-programming exercise when maxScore > 0', () => {
		render(
			<SubmissionStatus
				status="success"
				exerciseType="text"
				score={8}
				maxScore={10}
				scorePercentage={80}
			/>
		);
		expect(screen.getByText(/8\/10/)).toBeInTheDocument();
	});

	describe('building ETA countdown', () => {
		const start = '2026-01-01T10:00:00.000Z';
		const eta = '2026-01-01T10:01:00.000Z';

		beforeEach(() => {
			vi.useFakeTimers();
			vi.setSystemTime(new Date(start));
		});

		afterEach(() => {
			vi.useRealTimers();
		});

		it('shows the ETA countdown when building with timing info', () => {
			render(
				<SubmissionStatus
					status="building"
					buildStartDate={start}
					estimatedCompletionDate={eta}
				/>,
			);
			expect(screen.getByText('Building your submission... (ETA: 60s)')).toBeInTheDocument();
		});

		it('renders a determinate bar (fixed width, not indeterminate) with timing info', () => {
			render(
				<SubmissionStatus
					status="building"
					buildStartDate={start}
					estimatedCompletionDate={eta}
				/>,
			);
			// Determinate builds carry an inline width (>= 5%); indeterminate ones do not.
			expect(screen.getByTestId('build-progress-bar').style.width).not.toBe('');
		});
	});
});
