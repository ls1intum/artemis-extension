import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ExtensionMsg } from '@shared/messageContracts';
import type { ExerciseDetailsResponse } from '@shared/types/apiResponses';

import { createMockVsCodeApi, dispatchExtensionMessage } from '@test/react/__helpers__/vscodeApi';
import { useExerciseDetailStore } from '@webview/stores/useExerciseDetailStore';
import { ExerciseDetailView } from '@webview/views/ExerciseDetail/ExerciseDetailView';

// useWebSocketUpdates is not under test here.
vi.mock('@webview/hooks/useWebSocketUpdates', () => ({
	useWebSocketUpdates: vi.fn(),
}));

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
		pendingSubmissionsByParticipationId: {},
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

	it('re-requests the proactive card when the .noai status changes (live freshness, spec §14)', async () => {
		const mockApi = createMockVsCodeApi();
		render(<ExerciseDetailView vscodeApi={mockApi} />);

		dispatchExtensionMessage({
			type: 'exerciseDetailInit',
			exerciseData: makeExerciseData(),
			hideDeveloperTools: false,
		});
		await waitFor(() => expect(screen.getByText('My Exercise')).toBeInTheDocument());

		const post = vi.mocked(mockApi.postMessage);
		post.mockClear();
		act(() => {
			dispatchExtensionMessage({ type: ExtensionMsg.UpdateNoAiStatus, isNoAiDetected: true });
		});

		// Reads the live exercise from the store at message time (not a closed-over render value).
		expect(post).toHaveBeenCalledWith(
			expect.objectContaining({
				type: 'command',
				command: 'requestProactiveControl',
				payload: { exerciseId: 42, courseId: 1 },
			})
		);
	});

	it('UpdateProactiveConsent re-requests the proactive control with the live exercise (#342)', () => {
		useExerciseDetailStore.setState({ exerciseData: makeExerciseData(), isLoading: false });
		const mockApi = createMockVsCodeApi();
		render(<ExerciseDetailView vscodeApi={mockApi} />);
		const post = vi.mocked(mockApi.postMessage);
		post.mockClear();
		act(() => {
			dispatchExtensionMessage({ type: ExtensionMsg.UpdateProactiveConsent });
		});
		expect(post).toHaveBeenCalledWith(
			expect.objectContaining({
				type: 'command',
				command: 'requestProactiveControl',
				payload: { exerciseId: 42, courseId: 1 },
			})
		);
	});

	it('consent-missing settings link posts openSettings with the egress key (#342)', () => {
		useExerciseDetailStore.setState({
			exerciseData: makeExerciseData(),
			isLoading: false,
			proactiveControl: { exerciseId: 42, level: 'off', cardState: 'degraded', reason: 'consent-missing', proactiveControlAvailable: true },
		});
		const mockApi = createMockVsCodeApi();
		render(<ExerciseDetailView vscodeApi={mockApi} />);
		fireEvent.click(screen.getByRole('button', { name: /enable in settings/i }));
		expect(vi.mocked(mockApi.postMessage)).toHaveBeenCalledWith(
			expect.objectContaining({
				type: 'command',
				command: 'openSettings',
				payload: { setting: 'artemis.iris.proactiveCodeEgress' },
			})
		);
	});

	it('unavailable/noai renders the notice inside the AskIris card, not a standalone banner', () => {
		useExerciseDetailStore.setState({
			exerciseData: makeExerciseData(),
			isLoading: false,
			proactiveControl: { exerciseId: 42, level: 'off', cardState: 'unavailable', reason: 'noai', proactiveControlAvailable: false },
		});
		const mockApi = createMockVsCodeApi();
		render(<ExerciseDetailView vscodeApi={mockApi} />);
		const card = screen.getByTestId('ask-iris-card');
		const notice = 'A .noai file disables Iris for this repository, including the chat.';
		expect(screen.getAllByText(notice)).toHaveLength(1);
		expect(within(card).getByText(notice)).toBeInTheDocument();
		expect(screen.queryByText(/Open the Iris chat/i)).toBeNull();
		expect(document.querySelector('[data-variant="warning"]')).toBeNull();
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
			exerciseId: 42,
		});

		await waitFor(() => {
			expect(screen.getByText('Solve the problem.')).toBeInTheDocument();
		});
	});

	it('ignores a server-rendered problem statement broadcast for a different exercise', async () => {
		useExerciseDetailStore.setState({ exerciseData: makeExerciseData(), isLoading: false });
		const mockApi = createMockVsCodeApi();
		render(<ExerciseDetailView vscodeApi={mockApi} />);

		// The current exercise is 42; a broadcast tagged for another exercise must not paint here.
		dispatchExtensionMessage({
			type: ExtensionMsg.ProblemStatementRendered,
			html: '<html><body><p>Other exercise content.</p></body></html>',
			exerciseId: 999,
		});

		await new Promise(r => setTimeout(r, 50));
		expect(screen.queryByText('Other exercise content.')).not.toBeInTheDocument();
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

	it('posts openRepository command with the repositoryUri when Open Repository is clicked', async () => {
		useExerciseDetailStore.setState({
			exerciseData: makeExerciseDataWithParticipation(),
			repoStatus: { isConnected: true, hasChanges: false, isPracticeRepo: false },
			isLoading: false,
		});
		const mockApi = createMockVsCodeApi();
		render(<ExerciseDetailView vscodeApi={mockApi} />);

		await userEvent.click(screen.getByRole('button', { name: 'More ▾' }));
		await userEvent.click(screen.getByRole('button', { name: /Open Repository/i }));

		expect(mockApi.postMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				type: 'command',
				command: 'openRepository',
				payload: expect.objectContaining({ repositoryUri: 'https://git.example.com/repo' }),
			})
		);
	});

	describe('managed environment (EduIDE)', () => {
		it('shows "Open in Artemis" (not Clone) when managed and the workspace is disconnected', async () => {
			const mockApi = createMockVsCodeApi();
			render(<ExerciseDetailView vscodeApi={mockApi} />);

			dispatchExtensionMessage({
				type: 'exerciseDetailInit',
				exerciseData: makeExerciseDataWithParticipation(),
				hideDeveloperTools: false,
				repoStatus: { isConnected: false, hasChanges: false, isPracticeRepo: false },
				isManagedEnvironment: true,
			});

			await waitFor(() => {
				expect(screen.getByRole('button', { name: 'Open in Artemis' })).toBeInTheDocument();
			});
			expect(screen.queryByRole('button', { name: 'Clone Repository' })).not.toBeInTheDocument();
		});

		it('shows no "Open in Artemis" and no Clone/Open Repository when managed and connected (open exercise)', async () => {
			const mockApi = createMockVsCodeApi();
			render(<ExerciseDetailView vscodeApi={mockApi} />);

			dispatchExtensionMessage({
				type: 'exerciseDetailInit',
				exerciseData: makeExerciseDataWithParticipation(),
				hideDeveloperTools: false,
				repoStatus: { isConnected: true, hasChanges: false, isPracticeRepo: false },
				isManagedEnvironment: true,
			});

			await waitFor(() => {
				expect(screen.getByRole('button', { name: /Submit/i })).toBeInTheDocument();
			});
			// The open/connected exercise must not surface "Open in Artemis".
			expect(screen.queryByRole('button', { name: 'Open in Artemis' })).not.toBeInTheDocument();

			await userEvent.click(screen.getByRole('button', { name: 'More ▾' }));
			expect(screen.queryByRole('button', { name: 'Clone Repository' })).not.toBeInTheDocument();
			expect(screen.queryByRole('button', { name: /Open Repository/i })).not.toBeInTheDocument();
		});

		it('hides the "Repository cloned" banner when managed', async () => {
			const mockApi = createMockVsCodeApi();
			render(<ExerciseDetailView vscodeApi={mockApi} />);

			dispatchExtensionMessage({
				type: 'exerciseDetailInit',
				exerciseData: makeExerciseData(),
				hideDeveloperTools: false,
				isManagedEnvironment: true,
			});
			await waitFor(() => expect(screen.getByText('My Exercise')).toBeInTheDocument());

			// clonedNotice is set later (store ← ShowClonedRepoNotice), after init resets it.
			act(() => {
				useExerciseDetailStore.getState().setClonedNotice('My Exercise', 99);
			});

			expect(screen.queryByText(/Repository cloned for/i)).not.toBeInTheDocument();
		});

		it('shows the "Repository cloned" banner in non-managed (desktop) mode', async () => {
			const mockApi = createMockVsCodeApi();
			render(<ExerciseDetailView vscodeApi={mockApi} />);

			dispatchExtensionMessage({
				type: 'exerciseDetailInit',
				exerciseData: makeExerciseData(),
				hideDeveloperTools: false,
				isManagedEnvironment: false,
			});
			await waitFor(() => expect(screen.getByText('My Exercise')).toBeInTheDocument());

			act(() => {
				useExerciseDetailStore.getState().setClonedNotice('My Exercise', 99);
			});

			expect(screen.getByText(/Repository cloned for/i)).toBeInTheDocument();
		});
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

		await userEvent.click(screen.getByRole('button', { name: 'See test results' }));

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

	it('overview lists test results when test names are hidden (showTestNamesToStudents=false)', async () => {
		// Feedbacks as Artemis sends them with hidden test names: no text, no
		// testCase.testName, only detailText + testCase.id. The list must still be
		// populated.
		useExerciseDetailStore.setState({
			exerciseData: makeExerciseData({
				exercise: {
					id: 42, title: 'My Exercise', type: 'programming',
					maxPoints: 10, bonusPoints: 0, problemStatement: 'Solve.',
					course: { id: 1, title: 'Test Course', shortName: 'TC' },
					studentParticipations: [{
						id: 99,
						repositoryUri: 'https://git.example.com/repo',
						submissions: [{
							id: 1,
							submissionDate: '2025-01-01T00:00:00Z',
							results: [{
								id: 10, score: 0, successful: false,
								completionDate: '2025-01-01T00:00:00Z',
								testCaseCount: 2, passedTestCaseCount: 0,
								feedbacks: [
									{ type: 'AUTOMATIC', positive: false, detailText: 'Method: isValidSelection', testCase: { id: 364902 } },
									{ type: 'AUTOMATIC', positive: false, detailText: 'Method: doOverlap', testCase: { id: 370396 } },
								],
							}],
						}],
					}],
				},
			}),
			isLoading: false,
		});
		const mockApi = createMockVsCodeApi();
		render(<ExerciseDetailView vscodeApi={mockApi} />);

		await userEvent.click(screen.getByRole('button', { name: 'See test results' }));

		expect(screen.queryByText('No test results available.')).not.toBeInTheDocument();
		expect(screen.getByText('Failed (2)')).toBeInTheDocument();
		expect(screen.getByText('Method: isValidSelection')).toBeInTheDocument();
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
			exerciseId: 42,
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

	// Task overlay state coverage: each test sets up exerciseData to drive
	// classifyTaskTests through a distinct branch, then clicks a task span and
	// verifies the rendered empty-state copy, covering the full
	// click -> classify -> overlay-render pipeline.

	function exerciseWithFeedbacks(feedbacks: unknown[] | undefined, successful = false): ExerciseDetailsResponse {
		const submission: Record<string, unknown> = {
			id: 1,
			submissionDate: '2025-01-01T00:00:00Z',
			results: [{
				id: 10,
				score: successful ? 100 : 50,
				successful,
				completionDate: '2025-01-01T00:00:00Z',
				...(feedbacks !== undefined ? { feedbacks } : {}),
			}],
		};
		return makeExerciseData({
			exercise: {
				id: 42, title: 'My Exercise', type: 'programming',
				maxPoints: 10, bonusPoints: 0, problemStatement: 'Solve.',
				course: { id: 1, title: 'Test Course', shortName: 'TC' },
				studentParticipations: [{
					id: 99,
					repositoryUri: 'https://git.example.com/repo',
					submissions: [submission],
				}],
			},
		});
	}

	function exerciseWithoutResult(): ExerciseDetailsResponse {
		return makeExerciseData({
			exercise: {
				id: 42, title: 'My Exercise', type: 'programming',
				maxPoints: 10, bonusPoints: 0, problemStatement: 'Solve.',
				course: { id: 1, title: 'Test Course', shortName: 'TC' },
				studentParticipations: [{
					id: 99,
					repositoryUri: 'https://git.example.com/repo',
					submissions: [],
				}],
			},
		});
	}

	const taskHtml = (testIds: string) =>
		`<html><body><span class="artemis-task" data-task-name="taskA" data-test-ids="${testIds}">taskA</span></body></html>`;

	async function clickTaskAndOpenOverlay(html: string) {
		const mockApi = createMockVsCodeApi();
		const { container } = render(<ExerciseDetailView vscodeApi={mockApi} />);
		dispatchExtensionMessage({ type: ExtensionMsg.ProblemStatementRendered, html, exerciseId: 42 });
		await waitFor(() => {
			expect(container.querySelector('.artemis-task[data-test-ids]')).not.toBeNull();
		});
		await userEvent.click(container.querySelector('.artemis-task[data-test-ids]')!);
	}

	it('task overlay shows no-result copy when there is no latest result', async () => {
		useExerciseDetailStore.setState({ exerciseData: exerciseWithoutResult(), isLoading: false });
		await clickTaskAndOpenOverlay(taskHtml('1,2'));
		expect(screen.getByText(/no build results yet/i)).toBeInTheDocument();
	});

	it('task overlay shows no-feedbacks copy when the latest build returned no feedbacks', async () => {
		useExerciseDetailStore.setState({ exerciseData: exerciseWithFeedbacks([], false), isLoading: false });
		await clickTaskAndOpenOverlay(taskHtml('1,2'));
		expect(screen.getByText(/produced no test feedback/i)).toBeInTheDocument();
	});

	it('task overlay shows legacy-success copy when result is successful without inline feedbacks', async () => {
		useExerciseDetailStore.setState({ exerciseData: exerciseWithFeedbacks(undefined, true), isLoading: false });
		await clickTaskAndOpenOverlay(taskHtml('1,2'));
		expect(screen.getByText(/All 2 tests passed/i)).toBeInTheDocument();
	});

	it('task overlay shows not-executed count when feedbacks do not cover the task tests', async () => {
		// Task references tests 50/51, but feedbacks only cover unrelated tests.
		useExerciseDetailStore.setState({
			exerciseData: exerciseWithFeedbacks([
				{ testCase: { id: 1, testName: 'other_test' }, positive: true },
			], false),
			isLoading: false,
		});
		await clickTaskAndOpenOverlay(taskHtml('50,51'));
		expect(screen.getByText(/2 tests in this task did not run/i)).toBeInTheDocument();
	});

	it('task overlay shows the Failed section plus a Not-executed note when partial coverage hits a failure', async () => {
		// Task references tests 1/2/99: 1 passes, 2 fails, 99 has no feedback (not-executed).
		useExerciseDetailStore.setState({
			exerciseData: exerciseWithFeedbacks([
				{ testCase: { id: 1, testName: 'pass_test' }, positive: true },
				{ testCase: { id: 2, testName: 'fail_test' }, positive: false, detailText: 'boom' },
			], false),
			isLoading: false,
		});
		await clickTaskAndOpenOverlay(taskHtml('1,2,99'));
		expect(screen.getByText('Failed (1)')).toBeInTheDocument();
		expect(screen.getByText('Passed (1)')).toBeInTheDocument();
		expect(screen.getByText(/1 test in this task did not run/i)).toBeInTheDocument();
	});

	it('task overlay re-classifies when exerciseData updates while the modal is open', async () => {
		// Start with no-result, open the modal, then push a successful result
		// via setState (mirroring the WS-driven store patch). The open modal
		// must reflect the new state without reopening.
		useExerciseDetailStore.setState({ exerciseData: exerciseWithoutResult(), isLoading: false });
		await clickTaskAndOpenOverlay(taskHtml('1,2'));
		expect(screen.getByText(/no build results yet/i)).toBeInTheDocument();

		// Patch in feedbacks that pass both task tests.
		useExerciseDetailStore.setState({
			exerciseData: exerciseWithFeedbacks([
				{ testCase: { id: 1, testName: 'tA' }, positive: true },
				{ testCase: { id: 2, testName: 'tB' }, positive: true },
			], false),
		});

		await waitFor(() => {
			expect(screen.queryByText(/no build results yet/i)).not.toBeInTheDocument();
		});
		expect(screen.getByText('Passed (2)')).toBeInTheDocument();
	});

	// Participation with a PREVIOUS result (submission 1) and a newer RESULTLESS
	// submission (submission 2), the exact state right after a submit while the
	// new build is running. pendingSubmissionsByParticipationId is seeded as a
	// sibling store field (it is NOT read from exerciseData).
	function exerciseBuildingOverPreviousResult(): ExerciseDetailsResponse {
		return makeExerciseData({
			exercise: {
				id: 42, title: 'My Exercise', type: 'programming',
				maxPoints: 10, bonusPoints: 0, problemStatement: 'Solve.',
				course: { id: 1, title: 'Test Course', shortName: 'TC' },
				studentParticipations: [{
					id: 99,
					repositoryUri: 'https://git.example.com/repo',
					submissions: [
						{
							id: 1,
							submissionDate: '2025-01-01T00:00:00Z',
							results: [{
								id: 10, score: 50, successful: false,
								completionDate: '2025-01-01T00:00:00Z',
								feedbacks: [
									{ testCase: { id: 1, testName: 'tA' }, positive: true },
									{ testCase: { id: 2, testName: 'tB' }, positive: false, detailText: 'old fail' },
								],
							}],
						},
						{ id: 2, submissionDate: '2025-01-02T00:00:00Z', results: [] },
					],
				}],
			},
		});
	}

	it('task overlay shows the previous result plus the rebuild banner while a build is running', async () => {
		useExerciseDetailStore.setState({
			exerciseData: exerciseBuildingOverPreviousResult(),
			pendingSubmissionsByParticipationId: { 99: { participationId: 99, state: 'BUILDING' } },
			isLoading: false,
		});
		await clickTaskAndOpenOverlay(taskHtml('1,2'));

		// Previous result is shown (NOT the no-result empty state)...
		expect(screen.queryByText(/no build results yet/i)).not.toBeInTheDocument();
		expect(screen.getByText('Failed (1)')).toBeInTheDocument();
		expect(screen.getByText('Passed (1)')).toBeInTheDocument();
		// ...with the rebuild banner.
		expect(screen.getByText(/a new build is running/i)).toBeInTheDocument();
	});

	it('task overlay drops the banner and shows the new result when the build finishes', async () => {
		useExerciseDetailStore.setState({
			exerciseData: exerciseBuildingOverPreviousResult(),
			pendingSubmissionsByParticipationId: { 99: { participationId: 99, state: 'BUILDING' } },
			isLoading: false,
		});
		await clickTaskAndOpenOverlay(taskHtml('1,2'));
		expect(screen.getByText(/a new build is running/i)).toBeInTheDocument();

		// Build finishes: result attaches to the newest submission (id 2), pending
		// cleared (single store mutation, mirrors the WS path).
		act(() => {
			useExerciseDetailStore.getState().updateBuildStatus({
				id: 11,
				participationId: 99,
				score: 100,
				successful: true,
				feedbacks: [
					{ testCase: { id: 1, testName: 'tA' }, positive: true },
					{ testCase: { id: 2, testName: 'tB' }, positive: true },
				],
			});
		});

		await waitFor(() => {
			expect(screen.queryByText(/a new build is running/i)).not.toBeInTheDocument();
		});
		expect(screen.getByText('Passed (2)')).toBeInTheDocument();
		expect(screen.queryByText(/^Failed/)).not.toBeInTheDocument();
	});

	it('taskFeedbackOpened reports the previous result id and counts while a build is running', async () => {
		// Telemetry must reflect what the modal actually shows (the previous
		// result), not undefined, when opened during a build.
		useExerciseDetailStore.setState({
			exerciseData: exerciseBuildingOverPreviousResult(),
			pendingSubmissionsByParticipationId: { 99: { participationId: 99, state: 'BUILDING' } },
			isLoading: false,
		});
		const mockApi = createMockVsCodeApi();
		const postMessageMock = vi.mocked(mockApi.postMessage);
		const { container } = render(<ExerciseDetailView vscodeApi={mockApi} />);
		dispatchExtensionMessage({ type: ExtensionMsg.ProblemStatementRendered, html: taskHtml('1,2'), exerciseId: 42 });
		await waitFor(() => expect(container.querySelector('.artemis-task[data-test-ids]')).not.toBeNull());
		await userEvent.click(container.querySelector('.artemis-task[data-test-ids]')!);

		const openedCall = postMessageMock.mock.calls.find(c => (c[0] as Record<string, unknown>).command === 'taskFeedbackOpened');
		const payload = (openedCall![0] as Record<string, unknown>).payload as Record<string, unknown>;
		expect(payload.resultId).toBe(10); // previous result, NOT undefined
		expect(payload.passedTests).toBe(1);
		expect(payload.failedTests).toBe(1);
	});

	it('task overlay shows no-result (not stale feedback) when the newest submission failed to build with no pending rebuild', async () => {
		useExerciseDetailStore.setState({
			exerciseData: makeExerciseData({
				exercise: {
					id: 42, title: 'My Exercise', type: 'programming',
					maxPoints: 10, bonusPoints: 0, problemStatement: 'Solve.',
					course: { id: 1, title: 'Test Course', shortName: 'TC' },
					studentParticipations: [{
						id: 99,
						repositoryUri: 'https://git.example.com/repo',
						submissions: [
							{
								id: 1, submissionDate: '2025-01-01T00:00:00Z',
								results: [{
									id: 10, score: 50, successful: false,
									completionDate: '2025-01-01T00:00:00Z',
									feedbacks: [
										{ testCase: { id: 1, testName: 'tA' }, positive: true },
										{ testCase: { id: 2, testName: 'tB' }, positive: false, detailText: 'old fail' },
									],
								}],
							},
							{ id: 2, submissionDate: '2025-01-02T00:00:00Z', buildFailed: true, results: [] },
						],
					}],
				},
			}),
			// No pendingSubmissionsByParticipationId entry -> no active build.
			isLoading: false,
		});
		await clickTaskAndOpenOverlay(taskHtml('1,2'));

		expect(screen.getByText(/no build results yet/i)).toBeInTheDocument();
		expect(screen.queryByText(/a new build is running/i)).not.toBeInTheDocument();
		// Must NOT resurface the previous submission's feedback.
		expect(screen.queryByText('Failed (1)')).not.toBeInTheDocument();
	});

	describe('sticky build status strip', () => {
		let observerCallback: IntersectionObserverCallback;

		beforeEach(() => {
			vi.stubGlobal(
				'IntersectionObserver',
				vi.fn(function (callback: IntersectionObserverCallback) {
					observerCallback = callback;
					return { observe: vi.fn(), disconnect: vi.fn(), unobserve: vi.fn() };
				}),
			);
		});

		afterEach(() => {
			vi.unstubAllGlobals();
		});

		it('shows the strip when a build runs and the card leaves the viewport', () => {
			// pendingSubmissionsByParticipationId is a TOP-LEVEL store field (not
			// read from exerciseData), so seed it as a sibling matching participation
			// id 99 from the helper. Now-relative timing dates keep the ETA
			// pass-through (view -> strip) exercised end-to-end.
			useExerciseDetailStore.setState({
				exerciseData: makeExerciseDataWithParticipation(),
				pendingSubmissionsByParticipationId: {
					99: {
						participationId: 99,
						state: 'BUILDING',
						buildTimingInfo: {
							buildStartDate: new Date(Date.now() - 1_000).toISOString(),
							estimatedCompletionDate: new Date(Date.now() + 60_000).toISOString(),
						},
					},
				},
				isLoading: false,
			});
			render(<ExerciseDetailView vscodeApi={createMockVsCodeApi()} />);

			// Card visible → no strip
			expect(screen.queryByText('Building…')).not.toBeInTheDocument();

			// Card scrolls out of view
			act(() => {
				observerCallback(
					[{ isIntersecting: false } as IntersectionObserverEntry],
					{} as IntersectionObserver,
				);
			});
			expect(screen.getByText('Building…')).toBeInTheDocument();
			// The card shows its own ETA message, so scope to the strip.
			const strip = screen.getByText('Building…').parentElement as HTMLElement;
			expect(within(strip).getByText(/ETA:/)).toBeInTheDocument();

			// Card scrolls back into view → strip disappears
			act(() => {
				observerCallback(
					[{ isIntersecting: true } as IntersectionObserverEntry],
					{} as IntersectionObserver,
				);
			});
			expect(screen.queryByText('Building…')).not.toBeInTheDocument();
		});

		it('flashes the result when the build finishes while the card is out of view', () => {
			useExerciseDetailStore.setState({
				exerciseData: makeExerciseDataWithParticipation(),
				pendingSubmissionsByParticipationId: {
					99: { participationId: 99, state: 'BUILDING' },
				},
				isLoading: false,
			});
			render(<ExerciseDetailView vscodeApi={createMockVsCodeApi()} />);

			act(() => {
				observerCallback(
					[{ isIntersecting: false } as IntersectionObserverEntry],
					{} as IntersectionObserver,
				);
			});
			expect(screen.getByText('Building…')).toBeInTheDocument();

			// Build finishes: the store deletes the pending entry and appends
			// the result in a single set(), so the view re-renders exactly
			// once with building → partial.
			act(() => {
				useExerciseDetailStore.getState().updateBuildStatus({
					id: 10,
					participationId: 99,
					score: 66.7,
					successful: false,
					testCaseCount: 3,
					passedTestCaseCount: 2,
					feedbacks: [],
				});
			});
			expect(screen.queryByText('Building…')).not.toBeInTheDocument();
			// The card badge renders the same text, so scope to the strip's
			// live region.
			expect(screen.getByRole('status')).toHaveTextContent('2/3 tests passed');
		});

		it('does not render the strip without a pending build', () => {
			useExerciseDetailStore.setState({
				exerciseData: makeExerciseDataWithParticipation({ hasResult: true }),
				isLoading: false,
			});
			render(<ExerciseDetailView vscodeApi={createMockVsCodeApi()} />);

			act(() => {
				observerCallback(
					[{ isIntersecting: false } as IntersectionObserverEntry],
					{} as IntersectionObserver,
				);
			});
			expect(screen.queryByText('Building…')).not.toBeInTheDocument();
			expect(screen.queryByRole('button', { name: 'Scroll to build status' })).not.toBeInTheDocument();
		});
	});
});
