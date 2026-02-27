import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useExamConductionStore } from '../../../src/views/webview/react/stores/useExamConductionStore';

const makeExamPayload = (overrides: Record<string, unknown> = {}) => ({
	studentExam: { id: 1, exercises: [] },
	courseId: 10,
	examId: 100,
	endTime: Date.now() + 7200000,
	startTime: Date.now(),
	totalDuration: 7200,
	workspaceExerciseId: null,
	...overrides,
});

describe('useExamConductionStore', () => {
	beforeEach(() => {
		useExamConductionStore.setState({
			studentExam: null,
			courseId: null,
			examId: null,
			endTime: null,
			startTime: null,
			totalDuration: null,
			workspaceExerciseId: null,
			loading: true,
			error: null,
		});
	});

	it('initializes with null values and loading true', () => {
		const { result } = renderHook(() => useExamConductionStore());

		expect(result.current.studentExam).toBeNull();
		expect(result.current.courseId).toBeNull();
		expect(result.current.examId).toBeNull();
		expect(result.current.endTime).toBeNull();
		expect(result.current.startTime).toBeNull();
		expect(result.current.totalDuration).toBeNull();
		expect(result.current.workspaceExerciseId).toBeNull();
		expect(result.current.loading).toBe(true);
		expect(result.current.error).toBeNull();
	});

	it('setExamData populates all fields and stops loading', () => {
		const { result } = renderHook(() => useExamConductionStore());
		const now = Date.now();
		const payload = makeExamPayload({ startTime: now, endTime: now + 3600000, totalDuration: 3600 });

		act(() => {
			result.current.setExamData(payload as Parameters<typeof result.current.setExamData>[0]);
		});

		expect(result.current.studentExam).toEqual(payload.studentExam);
		expect(result.current.courseId).toBe(10);
		expect(result.current.examId).toBe(100);
		expect(result.current.startTime).toBe(now);
		expect(result.current.endTime).toBe(now + 3600000);
		expect(result.current.totalDuration).toBe(3600);
		expect(result.current.loading).toBe(false);
		expect(result.current.error).toBeNull();
	});

	it('setExamData stores workspaceExerciseId when provided', () => {
		const { result } = renderHook(() => useExamConductionStore());

		act(() => {
			result.current.setExamData(makeExamPayload({ workspaceExerciseId: 42 }) as Parameters<typeof result.current.setExamData>[0]);
		});

		expect(result.current.workspaceExerciseId).toBe(42);
	});

	it('setExamData with null workspaceExerciseId sets it to null', () => {
		const { result } = renderHook(() => useExamConductionStore());

		act(() => {
			result.current.setExamData(makeExamPayload({ workspaceExerciseId: null }) as Parameters<typeof result.current.setExamData>[0]);
		});

		expect(result.current.workspaceExerciseId).toBeNull();
	});

	it('setLoading updates the loading flag', () => {
		const { result } = renderHook(() => useExamConductionStore());

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
		const { result } = renderHook(() => useExamConductionStore());

		act(() => {
			result.current.setError('Exam conduction failed');
		});

		expect(result.current.error).toBe('Exam conduction failed');
		expect(result.current.loading).toBe(false);
	});

	it('setError can clear error with null', () => {
		const { result } = renderHook(() => useExamConductionStore());

		act(() => {
			result.current.setError('Some error');
		});

		act(() => {
			result.current.setError(null);
		});

		expect(result.current.error).toBeNull();
	});

	it('reset restores initial state after exam data is set', () => {
		const { result } = renderHook(() => useExamConductionStore());

		act(() => {
			result.current.setExamData(makeExamPayload() as Parameters<typeof result.current.setExamData>[0]);
		});

		expect(result.current.studentExam).not.toBeNull();
		expect(result.current.loading).toBe(false);

		act(() => {
			result.current.reset();
		});

		expect(result.current.studentExam).toBeNull();
		expect(result.current.courseId).toBeNull();
		expect(result.current.examId).toBeNull();
		expect(result.current.endTime).toBeNull();
		expect(result.current.startTime).toBeNull();
		expect(result.current.totalDuration).toBeNull();
		expect(result.current.workspaceExerciseId).toBeNull();
		expect(result.current.loading).toBe(true);
		expect(result.current.error).toBeNull();
	});

	it('stores timing data for time remaining calculation', () => {
		const { result } = renderHook(() => useExamConductionStore());
		const startTime = 1000000000;
		const endTime = 1000007200000;

		act(() => {
			result.current.setExamData(makeExamPayload({ startTime, endTime, totalDuration: 7200 }) as Parameters<typeof result.current.setExamData>[0]);
		});

		expect(result.current.startTime).toBe(startTime);
		expect(result.current.endTime).toBe(endTime);
		expect(result.current.totalDuration).toBe(7200);
		// Time remaining can be calculated as endTime - Date.now()
		expect(result.current.endTime! - result.current.startTime!).toBe(endTime - startTime);
	});

	it('loading state transitions: loading -> loaded', () => {
		const { result } = renderHook(() => useExamConductionStore());

		expect(result.current.loading).toBe(true);

		act(() => {
			result.current.setExamData(makeExamPayload() as Parameters<typeof result.current.setExamData>[0]);
		});

		expect(result.current.loading).toBe(false);
	});

	it('loading state transitions: loading -> error', () => {
		const { result } = renderHook(() => useExamConductionStore());

		expect(result.current.loading).toBe(true);

		act(() => {
			result.current.setError('Server error');
		});

		expect(result.current.loading).toBe(false);
		expect(result.current.error).toBe('Server error');
	});

	it('setExamData stores studentExam as-is (opaque object)', () => {
		const { result } = renderHook(() => useExamConductionStore());
		const customExam = {
			id: 99,
			exercises: [{ id: 1, title: 'Programming Task' }],
			workingTime: 5400,
		};

		act(() => {
			result.current.setExamData(makeExamPayload({ studentExam: customExam }) as Parameters<typeof result.current.setExamData>[0]);
		});

		expect(result.current.studentExam).toEqual(customExam);
	});

	it('courseId and examId are stored independently', () => {
		const { result } = renderHook(() => useExamConductionStore());

		act(() => {
			result.current.setExamData(makeExamPayload({ courseId: 777, examId: 888 }) as Parameters<typeof result.current.setExamData>[0]);
		});

		expect(result.current.courseId).toBe(777);
		expect(result.current.examId).toBe(888);
	});
});
