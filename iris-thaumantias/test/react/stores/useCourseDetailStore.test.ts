import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCourseDetailStore } from '../../../src/views/webview/react/stores/useCourseDetailStore';
import type { CourseDetailData, Exercise, Exam } from '../../../src/shared/messageContracts';
import { createMockVsCodeApi } from '../__helpers__/vscodeApi';

const makeCourseDetailData = (overrides: Partial<CourseDetailData['course']> = {}): CourseDetailData => ({
	course: {
		id: 42,
		title: 'Test Course',
		semester: 'SS25',
		exercises: [],
		exams: [],
		...overrides,
	},
});

const makeExercise = (overrides: Partial<Exercise> = {}): Exercise => ({
	id: 1,
	title: 'Test Exercise',
	type: 'programming',
	...overrides,
});

const makeExam = (overrides: Partial<Exam> = {}): Exam => ({
	id: 100,
	title: 'Final Exam',
	...overrides,
});

describe('useCourseDetailStore', () => {
	it('initializes with null course and loading state', () => {
		const { result } = renderHook(() => useCourseDetailStore());

		expect(result.current.courseData).toBeNull();
		expect(result.current.workspaceExerciseId).toBeNull();
		expect(result.current.isLoading).toBe(true);
		expect(result.current.exerciseSearchTerm).toBe('');
		expect(result.current.exerciseSortBy).toBe('id-desc');
	});

	it('loadCourseDetail sets loading true and sends postMessage with courseId', () => {
		const { result } = renderHook(() => useCourseDetailStore());
		const mockApi = createMockVsCodeApi();

		act(() => {
			result.current.loadCourseDetail(mockApi, 42);
		});

		expect(result.current.isLoading).toBe(true);
		expect(mockApi.postMessage).toHaveBeenCalledWith({
			type: 'command',
			command: 'reloadCourseDetail',
			payload: { courseId: 42 },
		});
	});

	it('loadCourseDetail uses courseId 0 when not provided', () => {
		const { result } = renderHook(() => useCourseDetailStore());
		const mockApi = createMockVsCodeApi();

		act(() => {
			result.current.loadCourseDetail(mockApi);
		});

		expect(mockApi.postMessage).toHaveBeenCalledWith({
			type: 'command',
			command: 'reloadCourseDetail',
			payload: { courseId: 0 },
		});
	});

	it('setCourseData populates course and stops loading', () => {
		const { result } = renderHook(() => useCourseDetailStore());
		const data = makeCourseDetailData({ title: 'My Course' });

		act(() => {
			result.current.setLoading(true);
		});

		act(() => {
			result.current.setCourseData(data);
		});

		expect(result.current.courseData).toEqual(data);
		expect(result.current.isLoading).toBe(false);
	});

	it('setCourseData sets workspaceExerciseId when provided', () => {
		const { result } = renderHook(() => useCourseDetailStore());
		const data = makeCourseDetailData();

		act(() => {
			result.current.setCourseData(data, 99);
		});

		expect(result.current.workspaceExerciseId).toBe(99);
	});

	it('setCourseData clears workspaceExerciseId when null provided', () => {
		const { result } = renderHook(() => useCourseDetailStore());
		const data = makeCourseDetailData();

		act(() => {
			result.current.setCourseData(data, null);
		});

		expect(result.current.workspaceExerciseId).toBeNull();
	});

	it('setExerciseSearchTerm updates search term', () => {
		const { result } = renderHook(() => useCourseDetailStore());

		act(() => {
			result.current.setExerciseSearchTerm('sorting');
		});

		expect(result.current.exerciseSearchTerm).toBe('sorting');
	});

	it('setExerciseSortBy updates sort setting', () => {
		const { result } = renderHook(() => useCourseDetailStore());

		act(() => {
			result.current.setExerciseSortBy('title-asc');
		});

		expect(result.current.exerciseSortBy).toBe('title-asc');
	});

	it('filteredExercises returns empty array when no courseData', () => {
		const { result } = renderHook(() => useCourseDetailStore());

		const exercises = result.current.filteredExercises();
		expect(exercises).toEqual([]);
	});

	it('filteredExercises returns all exercises when no search term', () => {
		const { result } = renderHook(() => useCourseDetailStore());
		const exercises = [
			makeExercise({ id: 1, title: 'Exercise 1' }),
			makeExercise({ id: 2, title: 'Exercise 2' }),
		];

		act(() => {
			result.current.setCourseData(makeCourseDetailData({ exercises }));
		});

		const result2 = result.current.filteredExercises();
		expect(result2).toHaveLength(2);
	});

	it('filteredExercises filters by search term (case-insensitive)', () => {
		const { result } = renderHook(() => useCourseDetailStore());
		const exercises = [
			makeExercise({ id: 1, title: 'Sorting Algorithms' }),
			makeExercise({ id: 2, title: 'Graph Theory' }),
		];

		act(() => {
			result.current.setCourseData(makeCourseDetailData({ exercises }));
			result.current.setExerciseSearchTerm('SORT');
		});

		const filtered = result.current.filteredExercises();
		expect(filtered).toHaveLength(1);
		expect(filtered[0].title).toBe('Sorting Algorithms');
	});

	it('filteredExercises filters by exercise type', () => {
		const { result } = renderHook(() => useCourseDetailStore());
		const exercises = [
			makeExercise({ id: 1, title: 'Java Exercise', type: 'programming' }),
			makeExercise({ id: 2, title: 'Quiz Exercise', type: 'quiz' }),
		];

		act(() => {
			result.current.setCourseData(makeCourseDetailData({ exercises }));
			result.current.setExerciseSearchTerm('programming');
		});

		const filtered = result.current.filteredExercises();
		expect(filtered).toHaveLength(1);
		expect(filtered[0].id).toBe(1);
	});

	it('filteredExercises sorts by id descending by default', () => {
		const { result } = renderHook(() => useCourseDetailStore());
		const exercises = [
			makeExercise({ id: 1, title: 'First' }),
			makeExercise({ id: 3, title: 'Third' }),
			makeExercise({ id: 2, title: 'Second' }),
		];

		act(() => {
			result.current.setCourseData(makeCourseDetailData({ exercises }));
		});

		const sorted = result.current.filteredExercises();
		expect(sorted[0].id).toBe(3);
		expect(sorted[1].id).toBe(2);
		expect(sorted[2].id).toBe(1);
	});

	it('filteredExercises sorts by title ascending', () => {
		const { result } = renderHook(() => useCourseDetailStore());
		const exercises = [
			makeExercise({ id: 2, title: 'Zebra Exercise' }),
			makeExercise({ id: 1, title: 'Alpha Exercise' }),
		];

		act(() => {
			result.current.setCourseData(makeCourseDetailData({ exercises }));
			result.current.setExerciseSortBy('title-asc');
		});

		const sorted = result.current.filteredExercises();
		expect(sorted[0].title).toBe('Alpha Exercise');
		expect(sorted[1].title).toBe('Zebra Exercise');
	});

	it('sortedExams returns empty array when no courseData', () => {
		const { result } = renderHook(() => useCourseDetailStore());

		const exams = result.current.sortedExams();
		expect(exams).toEqual([]);
	});

	it('sortedExams returns exams sorted by status (active first)', () => {
		const { result } = renderHook(() => useCourseDetailStore());
		const now = new Date();
		const past = new Date(now.getTime() - 2 * 60 * 60 * 1000); // 2 hours ago
		const future = new Date(now.getTime() + 2 * 60 * 60 * 1000); // 2 hours from now

		const exams = [
			makeExam({ id: 1, title: 'Finished Exam', startDate: past.toISOString(), endDate: past.toISOString() }),
			makeExam({ id: 2, title: 'Active Exam', startDate: past.toISOString(), endDate: future.toISOString() }),
		];

		act(() => {
			result.current.setCourseData(makeCourseDetailData({ exams }));
		});

		const sorted = result.current.sortedExams();
		expect(sorted[0].title).toBe('Active Exam');
		expect(sorted[1].title).toBe('Finished Exam');
	});
});
