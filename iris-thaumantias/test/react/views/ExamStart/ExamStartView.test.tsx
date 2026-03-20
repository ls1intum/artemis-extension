import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ExamStartView } from '../../../../src/views/webview/views/ExamStart/ExamStartView';
import { useExamStartStore } from '../../../../src/views/webview/stores/useExamStartStore';
import { createMockVsCodeApi, dispatchExtensionMessage } from '../../__helpers__/vscodeApi';

// Mock useExamTimer to avoid Web Worker
vi.mock('../../../../src/views/webview/hooks/useExamTimer', () => ({
	useExamTimer: () => ({ remaining: 60000, expired: false }),
}));

// Mock useRelativeTime to avoid date calculations in tests
vi.mock('../../../../src/views/webview/hooks/useRelativeTime', () => ({
	useRelativeTime: (date: Date | null) => (date ? date.toISOString() : 'N/A'),
}));

function makeFutureDate(offsetMs: number): string {
	return new Date(Date.now() + offsetMs).toISOString();
}

function makePastDate(offsetMs: number): string {
	return new Date(Date.now() - offsetMs).toISOString();
}

function makeStudentExam(overrides: Record<string, unknown> = {}) {
	return {
		id: 1,
		started: false,
		workingTime: 7200,
		exam: {
			id: 100,
			title: 'Final Exam',
			startDate: makeFutureDate(60 * 60 * 1000), // 1 hour from now
			endDate: makeFutureDate(3 * 60 * 60 * 1000), // 3 hours from now
			startText: 'Please read carefully before beginning.',
		},
		...overrides,
	};
}

describe('ExamStartView', () => {
	it('shows loading skeleton when loading is true', () => {
		useExamStartStore.setState({ isLoading: true });
		const mockApi = createMockVsCodeApi();
		render(<ExamStartView vscodeApi={mockApi} />);
		const busyElements = document.querySelectorAll('[aria-busy]');
		expect(busyElements.length).toBeGreaterThan(0);
	});

	it('shows back link during loading', () => {
		useExamStartStore.setState({ isLoading: true });
		const mockApi = createMockVsCodeApi();
		render(<ExamStartView vscodeApi={mockApi} />);
		expect(screen.getByText('Back to Course')).toBeInTheDocument();
	});

	it('shows error message when error is set', () => {
		useExamStartStore.setState({ error: 'Failed to load exam', isLoading: false });
		const mockApi = createMockVsCodeApi();
		render(<ExamStartView vscodeApi={mockApi} />);
		expect(screen.getByText('Failed to load exam')).toBeInTheDocument();
	});

	it('shows retry button on error', () => {
		useExamStartStore.setState({ error: 'Failed to load exam', isLoading: false });
		const mockApi = createMockVsCodeApi();
		render(<ExamStartView vscodeApi={mockApi} />);
		expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
	});

	it('retry button sends ready postMessage', async () => {
		useExamStartStore.setState({ error: 'Failed to load exam', isLoading: false });
		const mockApi = createMockVsCodeApi();
		render(<ExamStartView vscodeApi={mockApi} />);

		const retryButton = screen.getByRole('button', { name: /retry/i });
		await userEvent.click(retryButton);

		expect(mockApi.postMessage).toHaveBeenCalledWith({ type: 'requestInit' });
	});

	it('shows no data message when studentExam is null and not loading', () => {
		useExamStartStore.setState({ isLoading: false, studentExam: null });
		const mockApi = createMockVsCodeApi();
		render(<ExamStartView vscodeApi={mockApi} />);
		expect(screen.getByText('No exam data available.')).toBeInTheDocument();
	});

	it('populates exam data from examStartInit message', async () => {
		const mockApi = createMockVsCodeApi();
		render(<ExamStartView vscodeApi={mockApi} />);

		dispatchExtensionMessage({
			type: 'examStartInit',
			studentExam: makeStudentExam(),
			courseId: 10,
			examId: 100,
		});

		await waitFor(() => {
			expect(screen.getByText('Final Exam')).toBeInTheDocument();
		});
	});

	it('displays exam title from store', () => {
		useExamStartStore.setState({
			studentExam: makeStudentExam() as never,
			courseId: 10,
			examId: 100,
			isLoading: false,
		});
		const mockApi = createMockVsCodeApi();
		render(<ExamStartView vscodeApi={mockApi} />);
		expect(screen.getByText('Final Exam')).toBeInTheDocument();
	});

	it('shows working time', () => {
		useExamStartStore.setState({
			studentExam: makeStudentExam({ workingTime: 3600 }) as never,
			courseId: 10,
			examId: 100,
			isLoading: false,
		});
		const mockApi = createMockVsCodeApi();
		render(<ExamStartView vscodeApi={mockApi} />);
		expect(screen.getByText('1h')).toBeInTheDocument();
	});

	it('shows exam rules section', () => {
		useExamStartStore.setState({
			studentExam: makeStudentExam() as never,
			courseId: 10,
			examId: 100,
			isLoading: false,
		});
		const mockApi = createMockVsCodeApi();
		render(<ExamStartView vscodeApi={mockApi} />);
		expect(screen.getByText('Exam Rules')).toBeInTheDocument();
	});

	it('shows Open in Browser button', () => {
		useExamStartStore.setState({
			studentExam: makeStudentExam() as never,
			courseId: 10,
			examId: 100,
			isLoading: false,
		});
		const mockApi = createMockVsCodeApi();
		render(<ExamStartView vscodeApi={mockApi} />);
		expect(screen.getByRole('button', { name: /open in browser/i })).toBeInTheDocument();
	});

	it('Open in Browser sends openExamInBrowser postMessage', async () => {
		useExamStartStore.setState({
			studentExam: makeStudentExam() as never,
			courseId: 10,
			examId: 100,
			isLoading: false,
		});
		const mockApi = createMockVsCodeApi();
		render(<ExamStartView vscodeApi={mockApi} />);

		await userEvent.click(screen.getByRole('button', { name: /open in browser/i }));

		expect(mockApi.postMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				type: 'command',
				command: 'openExamInBrowser',
				payload: expect.objectContaining({ courseId: 10, examId: 100 }),
			})
		);
	});

	it('shows Refresh button when exam has not started', () => {
		useExamStartStore.setState({
			studentExam: makeStudentExam() as never, // exam starts in future
			courseId: 10,
			examId: 100,
			isLoading: false,
		});
		const mockApi = createMockVsCodeApi();
		render(<ExamStartView vscodeApi={mockApi} />);
		expect(screen.getByRole('button', { name: /refresh/i })).toBeInTheDocument();
	});

	it('shows Enter Exam button when exam has started', () => {
		useExamStartStore.setState({
			studentExam: makeStudentExam({
				started: true,
				startedDate: makePastDate(30 * 60 * 1000),
				exam: {
					id: 100,
					title: 'Final Exam',
					startDate: makePastDate(60 * 60 * 1000), // started 1 hour ago
					endDate: makeFutureDate(2 * 60 * 60 * 1000),
					startText: 'Please read carefully.',
				},
			}) as never,
			courseId: 10,
			examId: 100,
			isLoading: false,
		});
		const mockApi = createMockVsCodeApi();
		render(<ExamStartView vscodeApi={mockApi} />);
		expect(screen.getByRole('button', { name: /enter exam/i })).toBeInTheDocument();
	});

	it('shows Test Exam badge for test exams', () => {
		useExamStartStore.setState({
			studentExam: makeStudentExam({
				exam: {
					id: 100,
					title: 'Practice Exam',
					startDate: makeFutureDate(3600000),
					endDate: makeFutureDate(7200000),
					testExam: true,
					startText: '',
				},
			}) as never,
			courseId: 10,
			examId: 100,
			isLoading: false,
		});
		const mockApi = createMockVsCodeApi();
		render(<ExamStartView vscodeApi={mockApi} />);
		expect(screen.getByText('Test Exam')).toBeInTheDocument();
	});

	it('back link sends backToCourseDetails postMessage', async () => {
		useExamStartStore.setState({
			studentExam: makeStudentExam() as never,
			courseId: 10,
			examId: 100,
			isLoading: false,
		});
		const mockApi = createMockVsCodeApi();
		render(<ExamStartView vscodeApi={mockApi} />);

		const backLink = screen.getByText('Back to Course');
		await userEvent.click(backLink);

		expect(mockApi.postMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				type: 'command',
				command: 'backToCourseDetails',
			})
		);
	});
});

