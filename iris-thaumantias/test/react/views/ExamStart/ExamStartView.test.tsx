import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ExamStartView } from '../../../../src/views/webview/react/views/ExamStart/ExamStartView';
import { useExamStartStore } from '../../../../src/views/webview/react/stores/useExamStartStore';
import { createMockVsCodeApi, dispatchExtensionMessage } from '../../__helpers__/vscodeApi';

// Mock useExamTimer to avoid Web Worker
vi.mock('../../../../src/views/webview/react/hooks/useExamTimer', () => ({
	useExamTimer: () => ({ remaining: 60000, expired: false }),
}));

// Mock useRelativeTime to avoid date calculations in tests
vi.mock('../../../../src/views/webview/react/hooks/useRelativeTime', () => ({
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
	it('sends ready postMessage on mount', () => {
		const mockApi = createMockVsCodeApi();
		render(<ExamStartView vscodeApi={mockApi} />);
		expect(mockApi.postMessage).toHaveBeenCalledWith({ type: 'ready' });
	});

	it('shows loading skeleton when loading is true', () => {
		useExamStartStore.setState({ loading: true });
		const mockApi = createMockVsCodeApi();
		render(<ExamStartView vscodeApi={mockApi} />);
		const busyElements = document.querySelectorAll('[aria-busy]');
		expect(busyElements.length).toBeGreaterThan(0);
	});

	it('shows back link during loading', () => {
		useExamStartStore.setState({ loading: true });
		const mockApi = createMockVsCodeApi();
		render(<ExamStartView vscodeApi={mockApi} />);
		expect(screen.getByText('Back to Course')).toBeInTheDocument();
	});

	it('shows error message when error is set', () => {
		useExamStartStore.setState({ error: 'Failed to load exam', loading: false });
		const mockApi = createMockVsCodeApi();
		render(<ExamStartView vscodeApi={mockApi} />);
		expect(screen.getByText('Failed to load exam')).toBeInTheDocument();
	});

	it('shows retry button on error', () => {
		useExamStartStore.setState({ error: 'Failed to load exam', loading: false });
		const mockApi = createMockVsCodeApi();
		render(<ExamStartView vscodeApi={mockApi} />);
		expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
	});

	it('retry button sends ready postMessage', async () => {
		useExamStartStore.setState({ error: 'Failed to load exam', loading: false });
		const mockApi = createMockVsCodeApi();
		render(<ExamStartView vscodeApi={mockApi} />);

		const retryButton = screen.getByRole('button', { name: /retry/i });
		await userEvent.click(retryButton);

		expect(mockApi.postMessage).toHaveBeenCalledWith({ type: 'ready' });
	});

	it('shows no data message when studentExam is null and not loading', () => {
		useExamStartStore.setState({ loading: false, studentExam: null });
		const mockApi = createMockVsCodeApi();
		render(<ExamStartView vscodeApi={mockApi} />);
		expect(screen.getByText('No exam data available.')).toBeInTheDocument();
	});

	it('populates exam data from examStartInit message', async () => {
		const mockApi = createMockVsCodeApi();
		render(<ExamStartView vscodeApi={mockApi} />);

		dispatchExtensionMessage({
			type: 'examStartInit',
			payload: {
				studentExam: makeStudentExam(),
				courseId: 10,
				examId: 100,
			},
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
			loading: false,
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
			loading: false,
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
			loading: false,
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
			loading: false,
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
			loading: false,
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
			loading: false,
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
			loading: false,
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
			loading: false,
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
			loading: false,
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

describe('exam fetch error handling', () => {
	it('displays error message when extension host sends error', async () => {
		const mockApi = createMockVsCodeApi();
		render(<ExamStartView vscodeApi={mockApi} />);

		await act(async () => {
			dispatchExtensionMessage({
				type: 'error',
				payload: { message: 'Failed to load exam: Network error' },
			});
		});

		expect(screen.getByText('Failed to load exam: Network error')).toBeInTheDocument();
		expect(screen.getByRole('button', { name: /Retry/i })).toBeInTheDocument();
	});

	it('clears error and re-sends ready on retry click', async () => {
		const mockApi = createMockVsCodeApi();
		render(<ExamStartView vscodeApi={mockApi} />);

		await act(async () => {
			dispatchExtensionMessage({
				type: 'error',
				payload: { message: 'Server error' },
			});
		});

		expect(screen.getByText('Server error')).toBeInTheDocument();

		await userEvent.click(screen.getByRole('button', { name: /Retry/i }));

		// Ready message re-sent (first call is on mount, second is on retry)
		const readyCalls = (mockApi.postMessage as any).mock.calls.filter(
			(call: any[]) => call[0]?.type === 'ready'
		);
		expect(readyCalls.length).toBeGreaterThanOrEqual(2);
	});
});
