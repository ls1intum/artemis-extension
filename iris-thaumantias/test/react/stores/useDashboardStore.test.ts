import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDashboardStore, RecentCourseNode } from '../../../src/views/webview/react/stores/useDashboardStore';
import { createMockVsCodeApi } from '../__helpers__/vscodeApi';

describe('useDashboardStore', () => {
	beforeEach(() => {
		useDashboardStore.setState({
			recentCourses: [],
			workspaceExercise: null,
			isLoading: false,
			error: null,
		});
	});

	it('initializes with empty state', () => {
		const { result } = renderHook(() => useDashboardStore());

		expect(result.current.recentCourses).toEqual([]);
		expect(result.current.isLoading).toBe(false);
		expect(result.current.error).toBeNull();
		expect(result.current.workspaceExercise).toBeNull();
	});

	it('sets loading state when loadDashboard called', () => {
		const { result } = renderHook(() => useDashboardStore());
		const mockVsCodeApi = createMockVsCodeApi();

		act(() => {
			result.current.loadDashboard(mockVsCodeApi);
		});

		expect(result.current.isLoading).toBe(true);
		expect(result.current.error).toBeNull();
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

	it('sorts courses by date and limits to 3', () => {
		const { result } = renderHook(() => useDashboardStore());

		const makeCourse = (title: string, startDate: string): RecentCourseNode => ({
			courseData: { course: { title, startDate } },
			exercises: [],
		});

		const courses = [
			makeCourse('Course 1', '2023-01-01'),
			makeCourse('Course 2', '2023-06-01'),
			makeCourse('Course 3', '2023-12-01'),
			makeCourse('Course 4', '2023-09-01'),
		];

		act(() => {
			result.current.setDashboardData(courses);
		});

		expect(result.current.recentCourses).toHaveLength(3);
		expect(result.current.recentCourses[0].courseData.course.title).toBe('Course 3');
		expect(result.current.recentCourses[1].courseData.course.title).toBe('Course 4');
		expect(result.current.recentCourses[2].courseData.course.title).toBe('Course 2');
	});

	it('sets isLoading to false after setDashboardData', () => {
		const { result } = renderHook(() => useDashboardStore());

		const makeCourse = (title: string, startDate: string): RecentCourseNode => ({
			courseData: { course: { title, startDate } },
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

	it('sets error and stops loading on setError', () => {
		const { result } = renderHook(() => useDashboardStore());

		act(() => {
			result.current.setError('Something failed');
		});

		expect(result.current.error).toBe('Something failed');
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

	it('handles courses with creationDate fallback', () => {
		const { result } = renderHook(() => useDashboardStore());

		const courses: RecentCourseNode[] = [
			{
				courseData: { course: { title: 'Course without startDate', creationDate: '2023-03-01' } },
				exercises: [],
			},
			{
				courseData: { course: { title: 'Course with startDate', startDate: '2023-05-01' } },
				exercises: [],
			},
		];

		act(() => {
			result.current.setDashboardData(courses);
		});

		expect(result.current.recentCourses).toHaveLength(2);
		expect(result.current.recentCourses[0].courseData.course.title).toBe('Course with startDate');
	});
});
