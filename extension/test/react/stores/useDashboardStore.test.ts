import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { createMockVsCodeApi } from '@test/react/__helpers__/vscodeApi';
import { RecentCourseNode, useDashboardStore } from '@webview/stores/useDashboardStore';

describe('useDashboardStore', () => {
	it('initializes with empty state', () => {
		const { result } = renderHook(() => useDashboardStore());

		expect(result.current.recentCourses).toEqual([]);
		expect(result.current.isLoading).toBe(false);
		expect(result.current.workspaceExercise).toBe('loading');
	});

	it('sets loading state when loadDashboard called', () => {
		const { result } = renderHook(() => useDashboardStore());
		const mockVsCodeApi = createMockVsCodeApi();

		act(() => {
			result.current.loadDashboard(mockVsCodeApi);
		});

		expect(result.current.isLoading).toBe(true);
	});

	it('sends reloadDashboard command via postMessage', () => {
		const { result } = renderHook(() => useDashboardStore());
		const mockVsCodeApi = createMockVsCodeApi();

		act(() => {
			result.current.loadDashboard(mockVsCodeApi);
		});

		expect(mockVsCodeApi.postMessage).toHaveBeenCalledWith({
			type: 'command',
			command: 'reloadDashboard',
		});
	});

	it('preserves payload order — does not re-sort', () => {
		const { result } = renderHook(() => useDashboardStore());

		const makeCourse = (title: string, startDate: string): RecentCourseNode => ({
			courseData: { course: { id: 1, title, startDate } },
			exercises: [],
		});

		// Extension side is the source of truth for ordering and slicing.
		// Payload arrives already ordered (most-recently-accessed first).
		const courses = [
			makeCourse('Course 1', '2023-01-01'),
			makeCourse('Course 2', '2023-06-01'),
			makeCourse('Course 3', '2023-12-01'),
		];

		act(() => {
			result.current.setDashboardData(courses);
		});

		expect(result.current.recentCourses).toHaveLength(3);
		expect(result.current.recentCourses[0].courseData.course.title).toBe('Course 1');
		expect(result.current.recentCourses[1].courseData.course.title).toBe('Course 2');
		expect(result.current.recentCourses[2].courseData.course.title).toBe('Course 3');
	});

	it('sets isLoading to false after setDashboardData', () => {
		const { result } = renderHook(() => useDashboardStore());

		const makeCourse = (title: string, startDate: string): RecentCourseNode => ({
			courseData: { course: { id: 1, title, startDate } },
			exercises: [],
		});

		const courses = [
			makeCourse('Course 1', '2023-01-01'),
			makeCourse('Course 2', '2023-06-01'),
		];

		act(() => {
			result.current.setDashboardData(courses);
		});

		expect(result.current.isLoading).toBe(false);
	});

	it('sets workspace exercise', () => {
		const { result } = renderHook(() => useDashboardStore());

		act(() => {
			result.current.setWorkspaceExercise({ id: 1, title: 'Ex 1' });
		});

		expect(result.current.workspaceExercise).toEqual({ id: 1, title: 'Ex 1' });
	});

	it('clears workspace exercise with null', () => {
		const { result } = renderHook(() => useDashboardStore());

		// First set an exercise
		act(() => {
			result.current.setWorkspaceExercise({ id: 1, title: 'Ex 1' });
		});

		expect(result.current.workspaceExercise).toEqual({ id: 1, title: 'Ex 1' });

		// Then clear it
		act(() => {
			result.current.setWorkspaceExercise(null);
		});

		expect(result.current.workspaceExercise).toBeNull();
	});

	it('does not mutate course order regardless of startDate', () => {
		// Extension side owns the ordering; the store must not re-sort.
		const { result } = renderHook(() => useDashboardStore());

		const courses: RecentCourseNode[] = [
			{
				courseData: { course: { id: 1, title: 'Course without startDate' } },
				exercises: [],
			},
			{
				courseData: { course: { id: 2, title: 'Course with startDate', startDate: '2023-05-01' } },
				exercises: [],
			},
		];

		act(() => {
			result.current.setDashboardData(courses);
		});

		expect(result.current.recentCourses).toHaveLength(2);
		expect(result.current.recentCourses[0].courseData.course.title).toBe('Course without startDate');
		expect(result.current.recentCourses[1].courseData.course.title).toBe('Course with startDate');
	});

	it('setLoading sets the isLoading flag directly', () => {
		const { result } = renderHook(() => useDashboardStore());

		act(() => {
			result.current.setLoading(true);
		});

		expect(result.current.isLoading).toBe(true);

		act(() => {
			result.current.setLoading(false);
		});

		expect(result.current.isLoading).toBe(false);
	});

	it('setDashboardData with fewer than 3 courses keeps all', () => {
		const { result } = renderHook(() => useDashboardStore());

		const makeCourse = (title: string, startDate: string): RecentCourseNode => ({
			courseData: { course: { id: 1, title, startDate } },
			exercises: [],
		});

		act(() => {
			result.current.setDashboardData([
				makeCourse('Course A', '2023-01-01'),
				makeCourse('Course B', '2023-06-01'),
			]);
		});

		expect(result.current.recentCourses).toHaveLength(2);
	});

	it('setDashboardData with empty array sets empty recent courses', () => {
		const { result } = renderHook(() => useDashboardStore());

		act(() => {
			result.current.setDashboardData([]);
		});

		expect(result.current.recentCourses).toEqual([]);
		expect(result.current.isLoading).toBe(false);
	});

	it('workspace exercise update does not affect recent courses', () => {
		const { result } = renderHook(() => useDashboardStore());

		const makeCourse = (title: string, startDate: string): RecentCourseNode => ({
			courseData: { course: { id: 1, title, startDate } },
			exercises: [],
		});

		act(() => {
			result.current.setDashboardData([makeCourse('Course A', '2023-01-01')]);
		});

		act(() => {
			result.current.setWorkspaceExercise({ id: 1, title: 'Exercise' });
		});

		expect(result.current.recentCourses).toHaveLength(1);
		expect(result.current.workspaceExercise).toEqual({ id: 1, title: 'Exercise' });
	});
});
