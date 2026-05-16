import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SubmissionStatus } from '@webview/components/exercise/SubmissionStatus';

describe('SubmissionStatus', () => {
	it('shows no-submission state for programming exercise', () => {
		render(<SubmissionStatus status="no-submission" exerciseType="programming" />);
		expect(screen.getByText('No submissions yet. Submit to see build results.')).toBeInTheDocument();
	});

	it('shows "Latest Build Status" title for no-submission programming exercise', () => {
		render(<SubmissionStatus status="no-submission" exerciseType="programming" />);
		expect(screen.getByText('Latest Build Status')).toBeInTheDocument();
	});

	it('shows building state with progress indicator', () => {
		render(<SubmissionStatus status="building" />);
		expect(screen.getByText('Build in Progress')).toBeInTheDocument();
		expect(screen.getByText('Building your submission...')).toBeInTheDocument();
	});

	it('shows pending state with queued message', () => {
		render(<SubmissionStatus status="pending" />);
		expect(screen.getByText('Build in Progress')).toBeInTheDocument();
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

	it('shows Build Failed badge when buildFailed is true', () => {
		render(<SubmissionStatus status="failed" buildFailed={true} score={0} maxScore={0} scorePercentage={0} />);
		expect(screen.getByText('Build Failed')).toBeInTheDocument();
	});

	it('displays score fraction in programming exercise', () => {
		render(<SubmissionStatus status="success" score={75} maxScore={100} scorePercentage={75} />);
		expect(screen.getByText(/75\/100/)).toBeInTheDocument();
	});

	it('shows test pass count badge when hasTestInfo is true', () => {
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
		expect(screen.getByText('8/10 tests passed')).toBeInTheDocument();
	});

	it('shows See test results button when hasTestInfo is true', () => {
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
		expect(screen.getByText('See test results')).toBeInTheDocument();
	});

	it('calls onOpenTestResults when See test results button is clicked', async () => {
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
		await userEvent.click(screen.getByText('See test results'));
		expect(onOpen).toHaveBeenCalledOnce();
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
});
