import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ExamExerciseDetailView } from '../../../../src/views/webview/react/views/ExamExerciseDetail/ExamExerciseDetailView';
import { useExamExerciseDetailStore } from '../../../../src/views/webview/react/stores/useExamExerciseDetailStore';
import { useExerciseDetailStore } from '../../../../src/views/webview/react/stores/useExerciseDetailStore';
import { createMockVsCodeApi, dispatchExtensionMessage } from '../../__helpers__/vscodeApi';

// Mock useWebSocketUpdates — not under test here
vi.mock('../../../../src/views/webview/react/hooks/useWebSocketUpdates', () => ({
	useWebSocketUpdates: vi.fn(),
}));

// Mock useExamTimer to avoid Web Worker
vi.mock('../../../../src/views/webview/react/hooks/useExamTimer', () => ({
	useExamTimer: () => ({ remaining: 1800000, expired: false }),
}));

function makeExamContext(overrides: Record<string, unknown> = {}) {
	const now = Date.now();
	return {
		courseId: 10,
		examId: 100,
		studentExam: { id: 1, started: true, workingTime: 7200, exam: { id: 100, title: 'Midterm' }, exercises: [] },
		endTime: now + 1800000,
		startTime: now,
		totalDuration: 7200000,
		...overrides,
	};
}

function makeExerciseData(overrides: Record<string, unknown> = {}) {
	return {
		exercise: {
			id: 42,
			title: 'Exam Exercise 1',
			type: 'programming',
			maxPoints: 10,
			bonusPoints: 0,
			problemStatement: 'Implement the solution.',
			course: { id: 1, title: 'Test Course', shortName: 'TC' },
			studentParticipations: [],
			...((overrides.exercise as Record<string, unknown>) ?? {}),
		},
		pendingSubmission: null,
		...overrides,
	};
}

function makeExerciseDataWithParticipation() {
	return makeExerciseData({
		exercise: {
			id: 42,
			title: 'Exam Exercise 1',
			type: 'programming',
			maxPoints: 10,
			bonusPoints: 0,
			problemStatement: 'Implement the solution.',
			course: { id: 1, title: 'Test Course', shortName: 'TC' },
			studentParticipations: [
				{
					id: 99,
					repositoryUri: 'https://git.example.com/repo',
					results: [],
					submissions: [{ id: 1, submissionDate: '2025-01-01T00:00:00Z' }],
				},
			],
		},
	});
}

describe('ExamExerciseDetailView', () => {
	beforeEach(() => {
		// hideDeveloperTools: true is scenario-specific (non-default false) — must remain
		useExerciseDetailStore.setState({
			exerciseData: null,
			hideDeveloperTools: true,
			isLoading: false,
			error: null,
		});
	});

	it('sends ready postMessage on mount', () => {
		const mockApi = createMockVsCodeApi();
		render(<ExamExerciseDetailView vscodeApi={mockApi} />);
		expect(mockApi.postMessage).toHaveBeenCalledWith({ type: 'ready' });
	});

	it('shows loading skeleton when loading', () => {
		useExamExerciseDetailStore.setState({ loading: true });
		const mockApi = createMockVsCodeApi();
		render(<ExamExerciseDetailView vscodeApi={mockApi} />);
		const busyElements = document.querySelectorAll('[aria-busy]');
		expect(busyElements.length).toBeGreaterThan(0);
	});

	it('shows back link during loading', () => {
		useExamExerciseDetailStore.setState({ loading: true });
		const mockApi = createMockVsCodeApi();
		render(<ExamExerciseDetailView vscodeApi={mockApi} />);
		expect(screen.getByText('← Back to Exam')).toBeInTheDocument();
	});

	it('shows error message when error is set', () => {
		useExamExerciseDetailStore.setState({ error: 'Load failed', loading: false });
		const mockApi = createMockVsCodeApi();
		render(<ExamExerciseDetailView vscodeApi={mockApi} />);
		expect(screen.getByText('Load failed')).toBeInTheDocument();
	});

	it('shows no data message when neither exercise nor examContext', () => {
		useExamExerciseDetailStore.setState({ loading: false, examContext: null });
		useExerciseDetailStore.setState({ exerciseData: null, isLoading: false });
		const mockApi = createMockVsCodeApi();
		render(<ExamExerciseDetailView vscodeApi={mockApi} />);
		expect(screen.getByText('No exercise data available.')).toBeInTheDocument();
	});

	it('populates data from examExerciseDetailInit message', async () => {
		const mockApi = createMockVsCodeApi();
		render(<ExamExerciseDetailView vscodeApi={mockApi} />);

		dispatchExtensionMessage({
			type: 'examExerciseDetailInit',
			payload: {
				exerciseData: makeExerciseData(),
				examContext: makeExamContext(),
				hideDeveloperTools: true,
			},
		});

		await waitFor(() => {
			expect(screen.getByText('Exam Exercise 1')).toBeInTheDocument();
		});
	});

	it('displays exercise title from stores', () => {
		useExamExerciseDetailStore.setState({ examContext: makeExamContext() as never, loading: false });
		useExerciseDetailStore.setState({ exerciseData: makeExerciseData() as never, isLoading: false });
		const mockApi = createMockVsCodeApi();
		render(<ExamExerciseDetailView vscodeApi={mockApi} />);
		expect(screen.getByText('Exam Exercise 1')).toBeInTheDocument();
	});

	it('displays problem statement', () => {
		useExamExerciseDetailStore.setState({ examContext: makeExamContext() as never, loading: false });
		useExerciseDetailStore.setState({ exerciseData: makeExerciseData() as never, isLoading: false });
		const mockApi = createMockVsCodeApi();
		render(<ExamExerciseDetailView vscodeApi={mockApi} />);
		expect(screen.getByText('Implement the solution.')).toBeInTheDocument();
	});

	it('back link sends backToExam postMessage', async () => {
		useExamExerciseDetailStore.setState({ examContext: makeExamContext() as never, loading: false });
		useExerciseDetailStore.setState({ exerciseData: makeExerciseData() as never, isLoading: false });
		const mockApi = createMockVsCodeApi();
		render(<ExamExerciseDetailView vscodeApi={mockApi} />);

		const backLink = screen.getByText('← Back to Exam');
		await userEvent.click(backLink);

		expect(mockApi.postMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				type: 'command',
				command: 'backToExam',
			})
		);
	});

	it('shows submit button when participation exists', () => {
		useExamExerciseDetailStore.setState({ examContext: makeExamContext() as never, loading: false });
		useExerciseDetailStore.setState({
			exerciseData: makeExerciseDataWithParticipation() as never,
			isLoading: false,
		});
		const mockApi = createMockVsCodeApi();
		render(<ExamExerciseDetailView vscodeApi={mockApi} />);
		expect(screen.getByRole('button', { name: /submit/i })).toBeInTheDocument();
	});

	it('submit button sends submitExercise postMessage', async () => {
		useExamExerciseDetailStore.setState({ examContext: makeExamContext() as never, loading: false });
		useExerciseDetailStore.setState({
			exerciseData: makeExerciseDataWithParticipation() as never,
			isLoading: false,
		});
		const mockApi = createMockVsCodeApi();
		render(<ExamExerciseDetailView vscodeApi={mockApi} />);

		const submitButton = screen.getByRole('button', { name: /submit/i });
		await userEvent.click(submitButton);

		expect(mockApi.postMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				type: 'command',
				command: 'submitExercise',
				payload: expect.objectContaining({ participationId: 99 }),
			})
		);
	});

	it('renders ExamTimer when examContext has endTime', () => {
		useExamExerciseDetailStore.setState({ examContext: makeExamContext() as never, loading: false });
		useExerciseDetailStore.setState({ exerciseData: makeExerciseData() as never, isLoading: false });
		const mockApi = createMockVsCodeApi();
		const { container } = render(<ExamExerciseDetailView vscodeApi={mockApi} />);
		const timerContainer = container.querySelector('[class*="timerContainer"]');
		expect(timerContainer).toBeInTheDocument();
	});
});
