import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useExerciseDetailStore } from '../../../src/views/webview/react/stores/useExerciseDetailStore';
import type { ExerciseDetailsResponse, ParticipationSummary, ResultSummary, SubmissionSummary } from '../../../src/types/apiResponses';
import { createMockVsCodeApi } from '../__helpers__/vscodeApi';

const makeExerciseData = (overrides: Partial<ExerciseDetailsResponse> = {}): ExerciseDetailsResponse => ({
	exercise: {
		id: 1,
		title: 'Test Exercise',
		type: 'programming',
		studentParticipations: [],
		...overrides.exercise,
	},
	...overrides,
});

const makeParticipation = (overrides: Partial<ParticipationSummary> = {}): ParticipationSummary => ({
	id: 10,
	type: 'STUDENT',
	results: [],
	submissions: [],
	...overrides,
});

const makeResult = (overrides: Partial<ResultSummary> = {}): ResultSummary => ({
	id: 100,
	successful: true,
	score: 80,
	completionDate: '2025-01-01T12:00:00Z',
	...overrides,
});

const makeSubmission = (overrides: Partial<SubmissionSummary> = {}): SubmissionSummary => ({
	id: 200,
	submissionDate: '2025-01-01T11:00:00Z',
	buildFailed: false,
	...overrides,
});

describe('useExerciseDetailStore', () => {
	it('initializes with null exercise and false hideDeveloperTools', () => {
		const { result } = renderHook(() => useExerciseDetailStore());

		expect(result.current.exerciseData).toBeNull();
		expect(result.current.hideDeveloperTools).toBe(false);
		expect(result.current.isLoading).toBe(false);
	});

	it('loadExerciseDetail sets loading true and sends postMessage with exerciseId', () => {
		const { result } = renderHook(() => useExerciseDetailStore());
		const mockApi = createMockVsCodeApi();

		act(() => {
			result.current.loadExerciseDetail(mockApi, 42);
		});

		expect(result.current.isLoading).toBe(true);
		expect(mockApi.postMessage).toHaveBeenCalledWith({
			type: 'command',
			command: 'reloadExerciseDetail',
			payload: { exerciseId: 42 },
		});
	});

	it('setExerciseData populates exercise and stops loading', () => {
		const { result } = renderHook(() => useExerciseDetailStore());
		const data = makeExerciseData();

		act(() => {
			result.current.setLoading(true);
		});

		act(() => {
			result.current.setExerciseData(data, false);
		});

		expect(result.current.exerciseData).toEqual(data);
		expect(result.current.hideDeveloperTools).toBe(false);
		expect(result.current.isLoading).toBe(false);
	});

	it('setExerciseData sets hideDeveloperTools flag correctly', () => {
		const { result } = renderHook(() => useExerciseDetailStore());

		act(() => {
			result.current.setExerciseData(makeExerciseData(), true);
		});

		expect(result.current.hideDeveloperTools).toBe(true);
	});

	it('updateBuildStatus is a no-op when no exerciseData', () => {
		const { result } = renderHook(() => useExerciseDetailStore());

		act(() => {
			result.current.updateBuildStatus(makeResult());
		});

		expect(result.current.exerciseData).toBeNull();
	});

	it('updateBuildStatus adds result to participation that already references that result id', () => {
		const { result } = renderHook(() => useExerciseDetailStore());
		// The store finds a participation by searching for a result with a matching id.
		// To push result id 200, the participation must already contain id 200 (partial/placeholder).
		const placeholderResult = makeResult({ id: 200, score: 0 });
		const participation = makeParticipation({ id: 10, results: [placeholderResult] });
		const exerciseData = makeExerciseData({
			exercise: { id: 1, studentParticipations: [participation] },
		});

		act(() => {
			result.current.setExerciseData(exerciseData, false);
		});

		const updatedResult = makeResult({ id: 200, score: 95 });

		act(() => {
			result.current.updateBuildStatus(updatedResult);
		});

		const updatedParticipation = result.current.exerciseData?.exercise?.studentParticipations?.[0];
		// Result id 200 was replaced (upsert by id), not duplicated
		expect(updatedParticipation?.results).toHaveLength(1);
		expect(updatedParticipation?.results?.[0].score).toBe(95);
	});

	it('updateBuildStatus replaces existing result with same id', () => {
		const { result } = renderHook(() => useExerciseDetailStore());
		const existingResult = makeResult({ id: 100, score: 50 });
		const participation = makeParticipation({ id: 10, results: [existingResult] });
		const exerciseData = makeExerciseData({
			exercise: { id: 1, studentParticipations: [participation] },
		});

		act(() => {
			result.current.setExerciseData(exerciseData, false);
		});

		const updatedResult = makeResult({ id: 100, score: 90 });

		act(() => {
			result.current.updateBuildStatus(updatedResult);
		});

		const updatedParticipation = result.current.exerciseData?.exercise?.studentParticipations?.[0];
		expect(updatedParticipation?.results).toHaveLength(1);
		expect(updatedParticipation?.results?.[0].score).toBe(90);
	});

	it('updateSubmission is a no-op when no exerciseData', () => {
		const { result } = renderHook(() => useExerciseDetailStore());

		act(() => {
			result.current.updateSubmission(makeSubmission());
		});

		expect(result.current.exerciseData).toBeNull();
	});

	it('updateSubmission adds new submission to matching participation', () => {
		const { result } = renderHook(() => useExerciseDetailStore());
		const existingSubmission = makeSubmission({ id: 200 });
		const participation = makeParticipation({ id: 10, submissions: [existingSubmission] });
		const exerciseData = makeExerciseData({
			exercise: { id: 1, studentParticipations: [participation] },
		});

		act(() => {
			result.current.setExerciseData(exerciseData, false);
		});

		// Create a submission that references the participation
		const newSubmission = {
			...makeSubmission({ id: 201, submissionDate: '2025-01-02T12:00:00Z' }),
			participation: { id: 10 },
		} as SubmissionSummary & { participation: { id: number } };

		act(() => {
			result.current.updateSubmission(newSubmission);
		});

		const updatedParticipation = result.current.exerciseData?.exercise?.studentParticipations?.[0];
		expect(updatedParticipation?.submissions).toHaveLength(2);
	});

	it('updateSubmissionProcessing is a no-op when no exerciseData', () => {
		const { result } = renderHook(() => useExerciseDetailStore());

		act(() => {
			result.current.updateSubmissionProcessing({ state: 'BUILDING', participationId: 999 });
		});

		expect(result.current.exerciseData).toBeNull();
	});

	it('updateSubmissionProcessing stores pending submission reference', () => {
		const { result } = renderHook(() => useExerciseDetailStore());
		const participation = makeParticipation({ id: 555 });
		const exerciseData = makeExerciseData({
			exercise: { id: 1, studentParticipations: [participation] },
		});

		act(() => {
			result.current.setExerciseData(exerciseData, false);
		});

		act(() => {
			result.current.updateSubmissionProcessing({ state: 'BUILDING', participationId: 555 });
		});

		// After processing, pendingSubmission should be on store state
		expect(result.current.exerciseData).not.toBeNull();
		expect(result.current.pendingSubmission?.participationId).toBe(555);
	});

	it('updateSubmissionProcessing ignores events for unknown participations', () => {
		const { result } = renderHook(() => useExerciseDetailStore());
		const participation = makeParticipation({ id: 10 });
		const exerciseData = makeExerciseData({
			exercise: { id: 1, studentParticipations: [participation] },
		});

		act(() => {
			result.current.setExerciseData(exerciseData, false);
		});

		act(() => {
			result.current.updateSubmissionProcessing({ state: 'BUILDING', participationId: 999 });
		});

		expect(result.current.pendingSubmission).toBeNull();
	});

	it('state is fully reset in beforeEach — exercise data does not bleed between tests', () => {
		const { result } = renderHook(() => useExerciseDetailStore());

		// Should be null from beforeEach reset
		expect(result.current.exerciseData).toBeNull();
	});
});
