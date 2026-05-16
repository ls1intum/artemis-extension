import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { StudentExam } from '@extension/types';
import { useExamStartStore } from '@webview/stores/useExamStartStore';

const makeStudentExam = (overrides: Partial<StudentExam> = {}): StudentExam => ({
	id: 1,
	started: false,
	exam: {
		id: 100,
		title: 'Final Exam',
		startText: 'Please read the instructions carefully.',
	},
	workingTime: 7200,
	exercises: [],
	...overrides,
});

describe('useExamStartStore', () => {
	it('initializes with null exam and loading true', () => {
		const { result } = renderHook(() => useExamStartStore());

		expect(result.current.studentExam).toBeNull();
		expect(result.current.courseId).toBeNull();
		expect(result.current.examId).toBeNull();
		expect(result.current.isLoading).toBe(true);
		expect(result.current.error).toBeNull();
	});

	it('setExamStartData populates exam data and stops loading', () => {
		const { result } = renderHook(() => useExamStartStore());
		const studentExam = makeStudentExam();

		act(() => {
			result.current.setExamStartData({
				studentExam,
				courseId: 10,
				examId: 100,
			});
		});

		expect(result.current.studentExam).toEqual(studentExam);
		expect(result.current.courseId).toBe(10);
		expect(result.current.examId).toBe(100);
		expect(result.current.isLoading).toBe(false);
		expect(result.current.error).toBeNull();
	});

	it('setExamStartData stores exam exercises', () => {
		const { result } = renderHook(() => useExamStartStore());
		const exercises = [
			{ id: 1, title: 'Exercise 1', type: 'programming' },
			{ id: 2, title: 'Exercise 2', type: 'modeling' },
		];
		const studentExam = makeStudentExam({ exercises });

		act(() => {
			result.current.setExamStartData({ studentExam, courseId: 10, examId: 100 });
		});

		expect(result.current.studentExam?.exercises).toHaveLength(2);
		expect(result.current.studentExam?.exercises?.[0].title).toBe('Exercise 1');
	});

	it('setExamStartData stores exam start text', () => {
		const { result } = renderHook(() => useExamStartStore());
		const studentExam = makeStudentExam({
			exam: { id: 100, title: 'Final Exam', startText: 'Read carefully before starting.' },
		});

		act(() => {
			result.current.setExamStartData({ studentExam, courseId: 10, examId: 100 });
		});

		expect(result.current.studentExam?.exam?.startText).toBe('Read carefully before starting.');
	});

	it('setLoading updates the loading flag', () => {
		const { result } = renderHook(() => useExamStartStore());

		act(() => {
			result.current.setLoading(false);
		});

		expect(result.current.isLoading).toBe(false);

		act(() => {
			result.current.setLoading(true);
		});

		expect(result.current.isLoading).toBe(true);
	});

	it('setError sets error and stops loading', () => {
		const { result } = renderHook(() => useExamStartStore());

		act(() => {
			result.current.setError('Failed to load exam');
		});

		expect(result.current.error).toBe('Failed to load exam');
		expect(result.current.isLoading).toBe(false);
	});

	it('setError can clear error with null', () => {
		const { result } = renderHook(() => useExamStartStore());

		act(() => {
			result.current.setError('Some error');
		});

		act(() => {
			result.current.setError(null);
		});

		expect(result.current.error).toBeNull();
	});

	it('reset restores initial state', () => {
		const { result } = renderHook(() => useExamStartStore());

		act(() => {
			result.current.setExamStartData({
				studentExam: makeStudentExam(),
				courseId: 10,
				examId: 100,
			});
		});

		expect(result.current.studentExam).not.toBeNull();

		act(() => {
			result.current.reset();
		});

		expect(result.current.studentExam).toBeNull();
		expect(result.current.courseId).toBeNull();
		expect(result.current.examId).toBeNull();
		expect(result.current.isLoading).toBe(true);
		expect(result.current.error).toBeNull();
	});

	it('setExamStartData stores workingTime from exam', () => {
		const { result } = renderHook(() => useExamStartStore());
		const studentExam = makeStudentExam({ workingTime: 3600 });

		act(() => {
			result.current.setExamStartData({ studentExam, courseId: 5, examId: 50 });
		});

		expect(result.current.studentExam?.workingTime).toBe(3600);
	});

	it('stores courseId and examId independently from studentExam', () => {
		const { result } = renderHook(() => useExamStartStore());

		act(() => {
			result.current.setExamStartData({
				studentExam: makeStudentExam({ id: 999 }),
				courseId: 777,
				examId: 888,
			});
		});

		expect(result.current.courseId).toBe(777);
		expect(result.current.examId).toBe(888);
		expect(result.current.studentExam?.id).toBe(999);
	});

	it('loading state transitions: loading -> loaded', () => {
		const { result } = renderHook(() => useExamStartStore());

		expect(result.current.isLoading).toBe(true);

		act(() => {
			result.current.setExamStartData({
				studentExam: makeStudentExam(),
				courseId: 10,
				examId: 100,
			});
		});

		expect(result.current.isLoading).toBe(false);
	});

	it('loading state transitions: loading -> error', () => {
		const { result } = renderHook(() => useExamStartStore());

		expect(result.current.isLoading).toBe(true);

		act(() => {
			result.current.setError('Exam fetch failed');
		});

		expect(result.current.isLoading).toBe(false);
		expect(result.current.error).toBe('Exam fetch failed');
	});

	it('exam started flag is stored in studentExam', () => {
		const { result } = renderHook(() => useExamStartStore());
		const startedExam = makeStudentExam({
			started: true,
			startedDate: '2025-06-01T09:00:00Z',
		});

		act(() => {
			result.current.setExamStartData({ studentExam: startedExam, courseId: 10, examId: 100 });
		});

		expect(result.current.studentExam?.started).toBe(true);
		expect(result.current.studentExam?.startedDate).toBe('2025-06-01T09:00:00Z');
	});
});
