import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ExerciseDetailView } from '@webview/views/ExerciseDetail/ExerciseDetailView';
import { useExerciseDetailStore } from '@webview/stores/useExerciseDetailStore';
import type { ExerciseDetailsResponse } from '@shared/types/apiResponses';
import { createMockVsCodeApi, dispatchExtensionMessage } from '../../__helpers__/vscodeApi';
import { ExtensionMsg } from '@shared/messageContracts';

// Mock useWebSocketUpdates — not under test here
vi.mock('../../../../src/webview/hooks/useWebSocketUpdates', () => ({
	useWebSocketUpdates: vi.fn(),
}));

// Mock useExamTimer (used transitively via ExamTimer component from useWebSocketUpdates)
vi.mock('../../../../src/webview/hooks/useExamTimer', () => ({
	useExamTimer: () => ({ remaining: 0, expired: false }),
}));

// Helper to build minimal exerciseData
function makeExerciseData(overrides: Partial<ExerciseDetailsResponse> = {}): ExerciseDetailsResponse {
	return {
		exercise: {
			id: 42,
			title: 'My Exercise',
			type: 'programming',
			maxPoints: 10,
			bonusPoints: 0,
			problemStatement: 'Solve the problem.',
			course: {
				id: 1,
				title: 'Test Course',
				shortName: 'TC',
			},
			studentParticipations: [],
			...((overrides.exercise as Partial<ExerciseDetailsResponse['exercise']>) ?? {}),
		},
		pendingSubmission: null,
		...overrides,
	};
}

function makeExerciseDataWithParticipation(opts: { hasResult?: boolean; hasSubmission?: boolean } = {}): ExerciseDetailsResponse {
	const submission: Record<string, unknown> = {
		id: 1,
		submissionDate: '2025-01-01T00:00:00Z',
		results: [],
	};
	const participation: Record<string, unknown> = {
		id: 99,
		repositoryUri: 'https://git.example.com/repo',
		submissions: [submission],
	};

	if (opts.hasResult) {
		submission.results = [
			{
				id: 10,
				score: 70,
				successful: false,
				completionDate: '2025-01-01T00:00:00Z',
				testCaseCount: 3,
				passedTestCaseCount: 2,
				feedbacks: [
					{ testCase: { id: 1, testName: 'taskA_test1' }, positive: true },
					{ testCase: { id: 2, testName: 'taskA_test2' }, positive: true },
					{ testCase: { id: 3, testName: 'taskB_test1' }, positive: false, detailText: 'fail' },
				],
			},
		];
	}

	return makeExerciseData({
		exercise: {
			id: 42, title: 'My Exercise', type: 'programming',
			maxPoints: 10, bonusPoints: 0, problemStatement: 'Solve.',
			course: { id: 1, title: 'Test Course', shortName: 'TC' },
			studentParticipations: [participation],
		},
	});
}

describe('ExerciseDetailView', () => {
	it('shows loading skeleton when isLoading is true', () => {
		useExerciseDetailStore.setState({ isLoading: true });
		const mockApi = createMockVsCodeApi();
		render(<ExerciseDetailView vscodeApi={mockApi} />);
		// SkeletonList renders aria-busy elements
		const busyElements = document.querySelectorAll('[aria-busy]');
		expect(busyElements.length).toBeGreaterThan(0);
	});

	it('shows back link during loading', () => {
		useExerciseDetailStore.setState({ isLoading: true });
		const mockApi = createMockVsCodeApi();
		render(<ExerciseDetailView vscodeApi={mockApi} />);
		expect(screen.getByText('Back to Course')).toBeInTheDocument();
	});

	it('shows no data message when exerciseData is null and not loading', () => {
		useExerciseDetailStore.setState({ isLoading: false });
		const mockApi = createMockVsCodeApi();
		render(<ExerciseDetailView vscodeApi={mockApi} />);
		expect(screen.getByText('No exercise data available.')).toBeInTheDocument();
	});

	it('displays exercise title after exerciseDetailInit message', async () => {
		const mockApi = createMockVsCodeApi();
		render(<ExerciseDetailView vscodeApi={mockApi} />);

		dispatchExtensionMessage({
			type: 'exerciseDetailInit',
			exerciseData: makeExerciseData(),
			hideDeveloperTools: false,
		});

		await waitFor(() => {
			expect(screen.getByText('My Exercise')).toBeInTheDocument();
		});
	});

	it('renders exercise title from store data', () => {
		useExerciseDetailStore.setState({ exerciseData: makeExerciseData(), isLoading: false });
		const mockApi = createMockVsCodeApi();
		render(<ExerciseDetailView vscodeApi={mockApi} />);
		expect(screen.getByText('My Exercise')).toBeInTheDocument();
	});

	it('renders problem statement section once server-rendered HTML arrives', async () => {
		useExerciseDetailStore.setState({ exerciseData: makeExerciseData(), isLoading: false });
		const mockApi = createMockVsCodeApi();
		render(<ExerciseDetailView vscodeApi={mockApi} />);

		dispatchExtensionMessage({
			type: ExtensionMsg.ProblemStatementRendered,
			html: '<html><body><p>Solve the problem.</p></body></html>',
		});

		await waitFor(() => {
			expect(screen.getByText('Solve the problem.')).toBeInTheDocument();
		});
	});

	it('shows "Ask Iris" section', () => {
		useExerciseDetailStore.setState({ exerciseData: makeExerciseData(), isLoading: false });
		const mockApi = createMockVsCodeApi();
		render(<ExerciseDetailView vscodeApi={mockApi} />);
		expect(screen.getByText('Ask Iris')).toBeInTheDocument();
	});

	it('clicking Ask Iris sends askIrisAboutExercise postMessage', async () => {
		useExerciseDetailStore.setState({ exerciseData: makeExerciseData(), isLoading: false });
		const mockApi = createMockVsCodeApi();
		render(<ExerciseDetailView vscodeApi={mockApi} />);

		const askIrisButton = screen.getByRole('button', { name: 'Ask' });
		await userEvent.click(askIrisButton);

		expect(mockApi.postMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				type: 'command',
				command: 'askIrisAboutExercise',
				payload: expect.objectContaining({ exerciseId: 42 }),
			})
		);
	});

	it('clicking back link sends backToCourseDetails postMessage', async () => {
		useExerciseDetailStore.setState({ exerciseData: makeExerciseData(), isLoading: false });
		const mockApi = createMockVsCodeApi();
		render(<ExerciseDetailView vscodeApi={mockApi} />);

		const backLink = screen.getByText('Back to Course');
		await userEvent.click(backLink);

		expect(mockApi.postMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				type: 'command',
				command: 'backToCourseDetails',
			})
		);
	});

	it('shows startExercise action button when no participation', () => {
		useExerciseDetailStore.setState({ exerciseData: makeExerciseData(), isLoading: false });
		const mockApi = createMockVsCodeApi();
		render(<ExerciseDetailView vscodeApi={mockApi} />);
		// ParticipationActions shows "Start" when no participation
		expect(screen.getByRole('button', { name: /start/i })).toBeInTheDocument();
	});

	it('start exercise button sends startExercise postMessage', async () => {
		useExerciseDetailStore.setState({ exerciseData: makeExerciseData(), isLoading: false });
		const mockApi = createMockVsCodeApi();
		render(<ExerciseDetailView vscodeApi={mockApi} />);

		const startButton = screen.getByRole('button', { name: /start/i });
		await userEvent.click(startButton);

		expect(mockApi.postMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				type: 'command',
				command: 'startExercise',
				payload: expect.objectContaining({ exerciseId: 42 }),
			})
		);
	});

	it('shows submit button when participation exists', () => {
		useExerciseDetailStore.setState({
			exerciseData: makeExerciseDataWithParticipation(),
			repoStatus: { isConnected: true, hasChanges: true, isPracticeRepo: false },
			isLoading: false,
		});
		const mockApi = createMockVsCodeApi();
		render(<ExerciseDetailView vscodeApi={mockApi} />);
		expect(screen.getByRole('button', { name: /submit/i })).toBeInTheDocument();
	});

	it('submit button sends submitExercise postMessage', async () => {
		useExerciseDetailStore.setState({
			exerciseData: makeExerciseDataWithParticipation(),
			repoStatus: { isConnected: true, hasChanges: true, isPracticeRepo: false },
			isLoading: false,
		});
		const mockApi = createMockVsCodeApi();
		render(<ExerciseDetailView vscodeApi={mockApi} />);

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

	it('shows developer tools by default (hideDeveloperTools = false)', () => {
		useExerciseDetailStore.setState({
			exerciseData: makeExerciseData(),
			hideDeveloperTools: false,
			isLoading: false,
		});
		const mockApi = createMockVsCodeApi();
		render(<ExerciseDetailView vscodeApi={mockApi} />);
		expect(screen.getByText('Developer Tools')).toBeInTheDocument();
	});

	it('hides developer tools when hideDeveloperTools is true', () => {
		useExerciseDetailStore.setState({
			exerciseData: makeExerciseData(),
			hideDeveloperTools: true,
			isLoading: false,
		});
		const mockApi = createMockVsCodeApi();
		render(<ExerciseDetailView vscodeApi={mockApi} />);
		expect(screen.queryByText('Developer Tools')).not.toBeInTheDocument();
	});

	it('clicking Reload in empty state sends requestInit message', async () => {
		useExerciseDetailStore.setState({ exerciseData: null, isLoading: false });
		const mockApi = createMockVsCodeApi();
		render(<ExerciseDetailView vscodeApi={mockApi} />);

		const reloadButton = screen.getByRole('button', { name: /reload/i });
		await userEvent.click(reloadButton);

		expect(mockApi.postMessage).toHaveBeenCalledWith(
			expect.objectContaining({ type: 'requestInit' })
		);
	});

	// --- error state ---

	it('shows error message when error is set', () => {
		useExerciseDetailStore.setState({ error: 'Failed to load exercise', isLoading: false });
		const mockApi = createMockVsCodeApi();
		render(<ExerciseDetailView vscodeApi={mockApi} />);
		expect(screen.getByText('Failed to load exercise')).toBeInTheDocument();
	});

	it('shows Retry button in error state', () => {
		useExerciseDetailStore.setState({ error: 'Network error', isLoading: false });
		const mockApi = createMockVsCodeApi();
		render(<ExerciseDetailView vscodeApi={mockApi} />);
		expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
	});

	it('clicking Retry in error state sends requestInit message', async () => {
		useExerciseDetailStore.setState({ error: 'Network error', isLoading: false });
		const mockApi = createMockVsCodeApi();
		render(<ExerciseDetailView vscodeApi={mockApi} />);

		await userEvent.click(screen.getByRole('button', { name: 'Retry' }));

		expect(mockApi.postMessage).toHaveBeenCalledWith(
			expect.objectContaining({ type: 'requestInit' })
		);
	});

	it('posts testResultsOverviewOpened + Closed pair with matching viewId on open and close', async () => {
		useExerciseDetailStore.setState({
			exerciseData: makeExerciseDataWithParticipation({ hasResult: true }),
			isLoading: false,
		});
		const mockApi = createMockVsCodeApi();
		const postMessageMock = vi.mocked(mockApi.postMessage);
		render(<ExerciseDetailView vscodeApi={mockApi} />);

		await userEvent.click(screen.getByRole('button', { name: /see test results/i }));

		const openedCall = postMessageMock.mock.calls.find(c => (c[0] as Record<string, unknown>).command === 'testResultsOverviewOpened');
		expect(openedCall).toBeDefined();
		const openedPayload = (openedCall![0] as Record<string, unknown>).payload as Record<string, unknown>;
		const openedViewId = openedPayload.viewId;
		expect(typeof openedViewId).toBe('string');

		fireEvent.keyDown(document, { key: 'Escape' });

		const closedCall = postMessageMock.mock.calls.find(c => (c[0] as Record<string, unknown>).command === 'testResultsOverviewClosed');
		expect(closedCall).toBeDefined();
		const closedPayload = (closedCall![0] as Record<string, unknown>).payload as Record<string, unknown>;
		expect(closedPayload.viewId).toBe(openedViewId);
		expect(closedPayload.closeReason).toBe('escape');
		expect(closedPayload.durationMs).toBeGreaterThanOrEqual(0);
	});

	it('posts taskFeedbackOpened with filtered testIds and counts when a [task] span is clicked', async () => {
		useExerciseDetailStore.setState({
			exerciseData: makeExerciseDataWithParticipation({ hasResult: true }),
			isLoading: false,
		});
		const mockApi = createMockVsCodeApi();
		const postMessageMock = vi.mocked(mockApi.postMessage);
		const { container } = render(<ExerciseDetailView vscodeApi={mockApi} />);

		dispatchExtensionMessage({
			type: ExtensionMsg.ProblemStatementRendered,
			html: '<html><body><span class="artemis-task" data-task-name="taskA" data-test-ids="1,2">taskA</span></body></html>',
		});

		await waitFor(() => {
			expect(container.querySelector('.artemis-task[data-test-ids]')).not.toBeNull();
		});
		await userEvent.click(container.querySelector('.artemis-task[data-test-ids]')!);

		const openedCall = postMessageMock.mock.calls.find(c => (c[0] as Record<string, unknown>).command === 'taskFeedbackOpened');
		expect(openedCall).toBeDefined();
		const payload = (openedCall![0] as Record<string, unknown>).payload as Record<string, unknown>;
		expect(payload.taskName).toBe('taskA');
		expect(payload.testIds).toEqual([1, 2]);
		expect(payload.totalTests).toBe(2);
		expect(payload.passedTests).toBe(2);
		expect(payload.failedTests).toBe(0);
		expect(typeof payload.viewId).toBe('string');
	});
});
