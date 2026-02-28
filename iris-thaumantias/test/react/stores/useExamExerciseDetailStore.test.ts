import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useExamExerciseDetailStore } from '../../../src/views/webview/react/stores/useExamExerciseDetailStore';
import type { StudentExam, ExerciseDetailsResponse } from '../../../src/types/apiResponses';

const makeStudentExam = (overrides: Partial<StudentExam> = {}): StudentExam => ({
	id: 1,
	started: true,
	startedDate: '2025-06-01T09:00:00Z',
	exercises: [],
	workingTime: 7200,
	...overrides,
});

const makeExerciseData = (overrides: Partial<ExerciseDetailsResponse> = {}): ExerciseDetailsResponse => ({
	exercise: {
		id: 10,
		title: 'Sorting Exercise',
		type: 'programming',
		studentParticipations: [],
		...overrides.exercise,
	},
	...overrides,
});

const makeExamContext = (overrides: Record<string, unknown> = {}) => ({
	courseId: 5,
	examId: 50,
	studentExam: makeStudentExam(),
	endTime: Date.now() + 7200000,
	startTime: Date.now(),
	totalDuration: 7200,
	...overrides,
});

describe('useExamExerciseDetailStore', () => {
	it('initializes with null examContext and loading true', () => {
		const { result } = renderHook(() => useExamExerciseDetailStore());

		expect(result.current.examContext).toBeNull();
		expect(result.current.loading).toBe(true);
		expect(result.current.error).toBeNull();
	});

	it('setExamExerciseData populates examContext and stops loading', () => {
		const { result } = renderHook(() => useExamExerciseDetailStore());
		const examContext = makeExamContext();

		act(() => {
			result.current.setExamExerciseData({
				exerciseData: makeExerciseData(),
				examContext: examContext as Parameters<typeof result.current.setExamExerciseData>[0]['examContext'],
				hideDeveloperTools: false,
			});
		});

		expect(result.current.examContext).toBeDefined();
		expect(result.current.examContext?.courseId).toBe(5);
		expect(result.current.examContext?.examId).toBe(50);
		expect(result.current.loading).toBe(false);
		expect(result.current.error).toBeNull();
	});

	it('setExamExerciseData stores studentExam within examContext', () => {
		const { result } = renderHook(() => useExamExerciseDetailStore());
		const studentExam = makeStudentExam({ id: 99, workingTime: 3600 });
		const examContext = makeExamContext({ studentExam });

		act(() => {
			result.current.setExamExerciseData({
				exerciseData: makeExerciseData(),
				examContext: examContext as Parameters<typeof result.current.setExamExerciseData>[0]['examContext'],
				hideDeveloperTools: false,
			});
		});

		expect(result.current.examContext?.studentExam.id).toBe(99);
		expect(result.current.examContext?.studentExam.workingTime).toBe(3600);
	});

	it('setExamExerciseData stores timing fields in examContext', () => {
		const { result } = renderHook(() => useExamExerciseDetailStore());
		const startTime = 1000000000;
		const endTime = 1000007200000;
		const examContext = makeExamContext({ startTime, endTime, totalDuration: 7200 });

		act(() => {
			result.current.setExamExerciseData({
				exerciseData: makeExerciseData(),
				examContext: examContext as Parameters<typeof result.current.setExamExerciseData>[0]['examContext'],
				hideDeveloperTools: false,
			});
		});

		expect(result.current.examContext?.startTime).toBe(startTime);
		expect(result.current.examContext?.endTime).toBe(endTime);
		expect(result.current.examContext?.totalDuration).toBe(7200);
	});

	it('setLoading updates the loading flag', () => {
		const { result } = renderHook(() => useExamExerciseDetailStore());

		act(() => {
			result.current.setLoading(false);
		});

		expect(result.current.loading).toBe(false);

		act(() => {
			result.current.setLoading(true);
		});

		expect(result.current.loading).toBe(true);
	});

	it('setError sets error and stops loading', () => {
		const { result } = renderHook(() => useExamExerciseDetailStore());

		act(() => {
			result.current.setError('Failed to load exam exercise');
		});

		expect(result.current.error).toBe('Failed to load exam exercise');
		expect(result.current.loading).toBe(false);
	});

	it('setError can clear error with null', () => {
		const { result } = renderHook(() => useExamExerciseDetailStore());

		act(() => {
			result.current.setError('Some error');
		});

		act(() => {
			result.current.setError(null);
		});

		expect(result.current.error).toBeNull();
	});

	it('loading state transitions: loading -> loaded', () => {
		const { result } = renderHook(() => useExamExerciseDetailStore());

		expect(result.current.loading).toBe(true);

		act(() => {
			result.current.setExamExerciseData({
				exerciseData: makeExerciseData(),
				examContext: makeExamContext() as Parameters<typeof result.current.setExamExerciseData>[0]['examContext'],
				hideDeveloperTools: false,
			});
		});

		expect(result.current.loading).toBe(false);
	});

	it('loading state transitions: loading -> error', () => {
		const { result } = renderHook(() => useExamExerciseDetailStore());

		expect(result.current.loading).toBe(true);

		act(() => {
			result.current.setError('Network failure');
		});

		expect(result.current.loading).toBe(false);
		expect(result.current.error).toBe('Network failure');
	});

	it('hideDeveloperTools flag is accepted in payload (store ignores it)', () => {
		// The store only keeps examContext, not exerciseData or hideDeveloperTools —
		// those are handled by the view or useExerciseDetailStore. This verifies
		// the store correctly ignores unknown fields in the payload.
		const { result } = renderHook(() => useExamExerciseDetailStore());

		act(() => {
			result.current.setExamExerciseData({
				exerciseData: makeExerciseData(),
				examContext: makeExamContext() as Parameters<typeof result.current.setExamExerciseData>[0]['examContext'],
				hideDeveloperTools: true,
			});
		});

		// examContext is set; the hideDeveloperTools field is not stored
		expect(result.current.examContext).not.toBeNull();
	});

	it('successive calls to setExamExerciseData overwrite previous examContext', () => {
		const { result } = renderHook(() => useExamExerciseDetailStore());

		const firstContext = makeExamContext({ courseId: 1, examId: 10 });
		const secondContext = makeExamContext({ courseId: 2, examId: 20 });

		act(() => {
			result.current.setExamExerciseData({
				exerciseData: makeExerciseData(),
				examContext: firstContext as Parameters<typeof result.current.setExamExerciseData>[0]['examContext'],
				hideDeveloperTools: false,
			});
		});

		expect(result.current.examContext?.courseId).toBe(1);

		act(() => {
			result.current.setExamExerciseData({
				exerciseData: makeExerciseData(),
				examContext: secondContext as Parameters<typeof result.current.setExamExerciseData>[0]['examContext'],
				hideDeveloperTools: false,
			});
		});

		expect(result.current.examContext?.courseId).toBe(2);
		expect(result.current.examContext?.examId).toBe(20);
	});

	it('examContext null/courseId null during initial state', () => {
		const { result } = renderHook(() => useExamExerciseDetailStore());

		expect(result.current.examContext?.courseId).toBeUndefined();
	});
});
