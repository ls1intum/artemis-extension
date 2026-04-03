import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ExamConductionView } from '../../../../src/webview/views/ExamConduction/ExamConductionView';
import { useExamConductionStore } from '../../../../src/webview/stores/useExamConductionStore';
import { createMockVsCodeApi, dispatchExtensionMessage } from '../../__helpers__/vscodeApi';

// Mock useExamTimer used by ExamTimer component
vi.mock('../../../../src/webview/hooks/useExamTimer', () => ({
	useExamTimer: () => ({ remaining: 300000, expired: false }),
}));

function makeExamData() {
	const now = Date.now();
	return {
		studentExam: {
			exam: {
				title: 'Midterm Exam',
				testExam: false,
			},
			exercises: [
				{ id: 1, title: 'Exercise 1', type: 'programming', maxPoints: 10 },
				{ id: 2, title: 'Exercise 2', type: 'text', maxPoints: 5 },
			],
		},
		courseId: 10,
		examId: 100,
		endTime: now + 3600000,
		startTime: now,
		totalDuration: 3600000,
		workspaceExerciseId: null as number | null,
		isLoading: false,
		error: null as string | null,
	};
}

describe('ExamConductionView', () => {
	it('shows loading skeleton when loading is true', () => {
		useExamConductionStore.setState({ isLoading: true });
		const mockApi = createMockVsCodeApi();
		render(<ExamConductionView vscodeApi={mockApi} />);
		const busyElements = document.querySelectorAll('[aria-busy]');
		expect(busyElements.length).toBeGreaterThan(0);
	});

	it('shows error message when error is set', () => {
		useExamConductionStore.setState({ error: 'Failed to load exam', isLoading: false });
		const mockApi = createMockVsCodeApi();
		render(<ExamConductionView vscodeApi={mockApi} />);
		expect(screen.getByText('Failed to load exam')).toBeInTheDocument();
	});

	it('shows no data error when studentExam is null and not loading', () => {
		useExamConductionStore.setState({ isLoading: false, studentExam: null });
		const mockApi = createMockVsCodeApi();
		render(<ExamConductionView vscodeApi={mockApi} />);
		expect(screen.getByText('No exam data available')).toBeInTheDocument();
	});

	it('populates exam data from examConductionInit message', async () => {
		const mockApi = createMockVsCodeApi();
		render(<ExamConductionView vscodeApi={mockApi} />);

		dispatchExtensionMessage({
			type: 'examConductionInit',
			...makeExamData(),
		});

		await waitFor(() => {
			expect(screen.getByText('Midterm Exam')).toBeInTheDocument();
		});
	});

	it('displays exam title from store', () => {
		useExamConductionStore.setState(makeExamData() );
		const mockApi = createMockVsCodeApi();
		render(<ExamConductionView vscodeApi={mockApi} />);
		expect(screen.getByText('Midterm Exam')).toBeInTheDocument();
	});

	it('displays exercise list with exercise titles', () => {
		useExamConductionStore.setState(makeExamData() );
		const mockApi = createMockVsCodeApi();
		render(<ExamConductionView vscodeApi={mockApi} />);
		// Exercise titles appear as headings in the exercise cards
		const allExercise1 = screen.getAllByText('Exercise 1');
		expect(allExercise1.length).toBeGreaterThan(0);
		const allExercise2 = screen.getAllByText('Exercise 2');
		expect(allExercise2.length).toBeGreaterThan(0);
	});

	it('clicking an exercise sends openExamExerciseDetails postMessage', async () => {
		useExamConductionStore.setState(makeExamData() );
		const mockApi = createMockVsCodeApi();
		render(<ExamConductionView vscodeApi={mockApi} />);

		// Find the first clickable exercise item (ListItem renders a button/div with onClick)
		const exerciseItems = document.querySelectorAll('[class*="listItem"]');
		expect(exerciseItems.length).toBeGreaterThan(0);

		await userEvent.click(exerciseItems[0] as HTMLElement);

		expect(mockApi.postMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				type: 'command',
				command: 'openExamExerciseDetails',
			})
		);
	});

	it('shows Test Exam badge for test exam', () => {
		useExamConductionStore.setState({
			...makeExamData(),
			studentExam: {
				exam: { title: 'Practice Exam', testExam: true },
				exercises: [],
			},
		} );
		const mockApi = createMockVsCodeApi();
		render(<ExamConductionView vscodeApi={mockApi} />);
		expect(screen.getByText('Test Exam')).toBeInTheDocument();
	});

	it('shows back link to course', () => {
		useExamConductionStore.setState(makeExamData() );
		const mockApi = createMockVsCodeApi();
		render(<ExamConductionView vscodeApi={mockApi} />);
		expect(screen.getByText('Back to Course')).toBeInTheDocument();
	});

	it('clicking back link sends backToCourseDetails postMessage', async () => {
		useExamConductionStore.setState(makeExamData() );
		const mockApi = createMockVsCodeApi();
		render(<ExamConductionView vscodeApi={mockApi} />);

		const backLink = screen.getByText('Back to Course');
		await userEvent.click(backLink);

		expect(mockApi.postMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				type: 'command',
				command: 'backToCourseDetails',
			})
		);
	});

	it('reload button sends reloadExamConduction command', async () => {
		useExamConductionStore.setState(makeExamData() );
		const mockApi = createMockVsCodeApi();
		render(<ExamConductionView vscodeApi={mockApi} />);

		const reloadButton = screen.getByTitle('Refresh');
		await userEvent.click(reloadButton);

		expect(mockApi.postMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				type: 'command',
				command: 'reloadExamConduction',
			})
		);
	});

	it('marks workspace exercise with Open badge', () => {
		useExamConductionStore.setState({
			...makeExamData(),
			workspaceExerciseId: 1,
		} );
		const mockApi = createMockVsCodeApi();
		render(<ExamConductionView vscodeApi={mockApi} />);
		expect(screen.getByText('Open')).toBeInTheDocument();
	});

	it('renders exam timer when timing data available', () => {
		useExamConductionStore.setState(makeExamData() );
		const mockApi = createMockVsCodeApi();
		const { container } = render(<ExamConductionView vscodeApi={mockApi} />);
		// ExamTimer renders a timer container div
		const timerContainer = container.querySelector('[class*="timerContainer"]');
		expect(timerContainer).toBeInTheDocument();
	});
});

