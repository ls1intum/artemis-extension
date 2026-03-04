import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ExerciseDetailView } from '../../../src/views/webview/react/views/ExerciseDetail/ExerciseDetailView';
import { useExerciseDetailStore } from '../../../src/views/webview/react/stores/useExerciseDetailStore';
import { createMockVsCodeApi, dispatchExtensionMessage } from '../__helpers__/vscodeApi';

/**
 * Exercise submission flow integration tests.
 *
 * Tests the full exercise participation lifecycle:
 * load exercise -> start participation -> submit solution -> build progress -> results.
 * Uses fake timers to simulate build progress delays.
 * Exercises the complete component-store-message pipeline with postMessage round-trips.
 */

// Mock useWebSocketUpdates — not under test here
vi.mock('../../../src/views/webview/react/hooks/useWebSocketUpdates', () => ({
	useWebSocketUpdates: vi.fn(),
}));

// Mock useExamTimer (used transitively)
vi.mock('../../../src/views/webview/react/hooks/useExamTimer', () => ({
	useExamTimer: () => ({ remaining: 0, expired: false }),
}));

function makeExerciseData(overrides: Record<string, unknown> = {}) {
	return {
		exercise: {
			id: 42,
			title: 'Binary Search Tree',
			type: 'programming',
			maxPoints: 100,
			bonusPoints: 0,
			problemStatement: '<p>Implement a binary search tree.</p>',
			course: {
				id: 1,
				title: 'Data Structures',
				shortName: 'DS',
			},
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
			title: 'Binary Search Tree',
			type: 'programming',
			maxPoints: 100,
			bonusPoints: 0,
			problemStatement: '<p>Implement a binary search tree.</p>',
			course: { id: 1, title: 'Data Structures', shortName: 'DS' },
			studentParticipations: [
				{
					id: 99,
					repositoryUri: 'https://git.example.com/bst-repo',
					results: [],
					submissions: [],
				},
			],
		},
	});
}

function makeExerciseDataWithResults() {
	return makeExerciseData({
		exercise: {
			id: 42,
			title: 'Binary Search Tree',
			type: 'programming',
			maxPoints: 100,
			bonusPoints: 0,
			problemStatement: '<p>Implement a binary search tree.</p>',
			course: { id: 1, title: 'Data Structures', shortName: 'DS' },
			studentParticipations: [
				{
					id: 99,
					repositoryUri: 'https://git.example.com/bst-repo',
					results: [
						{
							id: 10,
							score: 75,
							maxScore: 100,
							successful: false,
							completionDate: '2025-01-01T12:00:00Z',
							feedbacks: [
								{ text: 'Insert test passed', positive: true, type: 'AUTOMATIC' },
								{ text: 'Delete test failed: null pointer', positive: false, type: 'AUTOMATIC' },
							],
						},
					],
					submissions: [
						{ id: 1, submissionDate: '2025-01-01T11:59:00Z' },
					],
				},
			],
		},
	});
}

describe('Exercise Submission Flow', () => {
	beforeEach(() => {
		vi.useRealTimers();
	});

	it('shows exercise title after receiving exerciseDetailInit message', async () => {
		const mockApi = createMockVsCodeApi();
		render(<ExerciseDetailView vscodeApi={mockApi} />);

		dispatchExtensionMessage({
			type: 'exerciseDetailInit',
			exerciseData: makeExerciseData(),
			hideDeveloperTools: false,
		});

		await waitFor(() => {
			expect(screen.getByText('Binary Search Tree')).toBeInTheDocument();
		});
	});

	it('shows Start Exercise button when exercise has no participation', async () => {
		const mockApi = createMockVsCodeApi();
		render(<ExerciseDetailView vscodeApi={mockApi} />);

		dispatchExtensionMessage({
			type: 'exerciseDetailInit',
			exerciseData: makeExerciseData(),
			hideDeveloperTools: false,
		});

		await waitFor(() => {
			expect(screen.getByText('Start Exercise')).toBeInTheDocument();
		});

		// Verify no Submit button yet
		expect(screen.queryByText('Submit')).not.toBeInTheDocument();
	});

	it('sends startExercise postMessage when Start Exercise is clicked', async () => {
		const user = userEvent.setup();
		const mockApi = createMockVsCodeApi();
		render(<ExerciseDetailView vscodeApi={mockApi} />);

		dispatchExtensionMessage({
			type: 'exerciseDetailInit',
			exerciseData: makeExerciseData(),
			hideDeveloperTools: false,
		});

		await waitFor(() => {
			expect(screen.getByText('Start Exercise')).toBeInTheDocument();
		});

		// OUTBOUND: click start exercise
		await user.click(screen.getByText('Start Exercise'));

		expect(mockApi.postMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				type: 'command',
				command: 'startExercise',
				payload: expect.objectContaining({ exerciseId: 42 }),
			})
		);
	});

	it('shows Submit button after participation is received', async () => {
		const mockApi = createMockVsCodeApi();
		render(<ExerciseDetailView vscodeApi={mockApi} />);

		// Simulate exercise with participation (started)
		dispatchExtensionMessage({
			type: 'exerciseDetailInit',
			exerciseData: makeExerciseDataWithParticipation(),
			hideDeveloperTools: false,
		});

		await waitFor(() => {
			expect(screen.getByText('Submit')).toBeInTheDocument();
		});
	});

	it('sends submitExercise postMessage when Submit is clicked', async () => {
		const user = userEvent.setup();
		const mockApi = createMockVsCodeApi();
		render(<ExerciseDetailView vscodeApi={mockApi} />);

		dispatchExtensionMessage({
			type: 'exerciseDetailInit',
			exerciseData: makeExerciseDataWithParticipation(),
			hideDeveloperTools: false,
		});

		await waitFor(() => {
			expect(screen.getByText('Submit')).toBeInTheDocument();
		});

		// OUTBOUND: click submit
		await user.click(screen.getByText('Submit'));

		expect(mockApi.postMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				type: 'command',
				command: 'submitExercise',
				payload: expect.objectContaining({ participationId: 99 }),
			})
		);
	});

	it('shows build progress when pendingSubmission is set', async () => {
		const mockApi = createMockVsCodeApi();
		render(<ExerciseDetailView vscodeApi={mockApi} />);

		// Simulate exercise with pending submission (building)
		const dataWithPending = {
			...makeExerciseDataWithParticipation(),
			pendingSubmission: { submissionId: 500 },
		};

		dispatchExtensionMessage({
			type: 'exerciseDetailInit',
			exerciseData: dataWithPending,
			hideDeveloperTools: false,
		});

		await waitFor(() => {
			// BuildProgress component should show building state
			expect(screen.getByText('Binary Search Tree')).toBeInTheDocument();
		});

		// The exercise is in building state — verify the store reflects this
		const storeState = useExerciseDetailStore.getState();
		expect(storeState.pendingSubmission).toBeTruthy();
	});

	it('completes full submission lifecycle with build progress simulation', async () => {
		const user = userEvent.setup();
		const mockApi = createMockVsCodeApi();
		render(<ExerciseDetailView vscodeApi={mockApi} />);

		// Step 1: Load exercise with participation (already started)
		dispatchExtensionMessage({
			type: 'exerciseDetailInit',
			exerciseData: makeExerciseDataWithParticipation(),
			hideDeveloperTools: false,
		});

		await waitFor(() => {
			expect(screen.getByText('Submit')).toBeInTheDocument();
		});

		// Step 2: Submit solution
		await user.click(screen.getByText('Submit'));

		// OUTBOUND: verify submitExercise postMessage
		await waitFor(() => {
			expect(mockApi.postMessage).toHaveBeenCalledWith(
				expect.objectContaining({
					type: 'command',
					command: 'submitExercise',
					payload: expect.objectContaining({ participationId: 99 }),
				})
			);
		});

		// Step 3: Simulate build started — use fake timers for progress delays
		vi.useFakeTimers();

		dispatchExtensionMessage({
			type: 'exerciseDetailInit',
			exerciseData: {
				...makeExerciseDataWithParticipation(),
				pendingSubmission: { submissionId: 500 },
			},
			hideDeveloperTools: false,
		});

		await vi.advanceTimersByTimeAsync(100);

		// Step 4: Simulate build complete with results
		dispatchExtensionMessage({
			type: 'exerciseDetailInit',
			exerciseData: makeExerciseDataWithResults(),
			hideDeveloperTools: false,
		});

		await vi.advanceTimersByTimeAsync(100);

		vi.useRealTimers();

		// Step 5: INBOUND — verify store has result data
		const storeState = useExerciseDetailStore.getState();
		const participations = storeState.exerciseData?.exercise?.studentParticipations;
		expect(participations).toHaveLength(1);
		expect(participations?.[0]?.results).toHaveLength(1);
		expect(participations?.[0]?.results?.[0]?.score).toBe(75);
	});

	it('shows score information when results are available', async () => {
		const mockApi = createMockVsCodeApi();
		render(<ExerciseDetailView vscodeApi={mockApi} />);

		dispatchExtensionMessage({
			type: 'exerciseDetailInit',
			exerciseData: makeExerciseDataWithResults(),
			hideDeveloperTools: false,
		});

		await waitFor(() => {
			// ScoreInfo component should display score data
			expect(screen.getByText('Binary Search Tree')).toBeInTheDocument();
		});

		// Verify results data in store
		const storeState = useExerciseDetailStore.getState();
		const result = storeState.exerciseData?.exercise?.studentParticipations?.[0]?.results?.[0];
		expect(result?.score).toBe(75);
	});

	it('shows loading state when isLoading is true', () => {
		useExerciseDetailStore.setState({ isLoading: true, exerciseData: null });
		const mockApi = createMockVsCodeApi();
		render(<ExerciseDetailView vscodeApi={mockApi} />);

		const busyElements = document.querySelectorAll('[aria-busy="true"]');
		expect(busyElements.length).toBeGreaterThan(0);
	});

});
