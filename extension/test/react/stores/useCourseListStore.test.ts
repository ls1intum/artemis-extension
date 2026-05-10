import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCourseListStore } from '../../../src/webview/stores/useCourseListStore';
import type { CourseData, ArchivedCourse } from '../../../src/shared/messageContracts';
import { createMockVsCodeApi } from '../__helpers__/vscodeApi';

const makeCourseData = (overrides: Partial<CourseData['course']> = {}): CourseData => ({
	course: {
		id: 1,
		title: 'Test Course',
		semester: 'SS25',
		...overrides,
	},
});

const makeArchivedCourse = (overrides: Partial<ArchivedCourse> = {}): ArchivedCourse => ({
	id: 10,
	title: 'Archived Course',
	semester: 'WS23/24',
	...overrides,
});

describe('useCourseListStore', () => {
	it('initializes with empty state', () => {
		const { result } = renderHook(() => useCourseListStore());

		expect(result.current.courses).toEqual([]);
		expect(result.current.archivedCourses).toEqual([]);
		expect(result.current.archivedLoaded).toBe(false);
		expect(result.current.isLoading).toBe(false);
		expect(result.current.searchTerm).toBe('');
		expect(result.current.typeFilter).toBe('all');
		expect(result.current.semesterFilter).toBe('all');
		expect(result.current.sortBy).toBe('semester-desc');
	});

	it('loadCourses sets isLoading true and sends reloadCourses postMessage', () => {
		const { result } = renderHook(() => useCourseListStore());
		const mockApi = createMockVsCodeApi();

		act(() => {
			result.current.loadCourses(mockApi);
		});

		expect(result.current.isLoading).toBe(true);
		expect(mockApi.postMessage).toHaveBeenCalledWith({
			type: 'command',
			command: 'reloadCourses',
		});
	});

	it('loadArchivedCourses sets isLoading true and sends loadArchivedCourses postMessage', () => {
		const { result } = renderHook(() => useCourseListStore());
		const mockApi = createMockVsCodeApi();

		act(() => {
			result.current.loadArchivedCourses(mockApi);
		});

		expect(result.current.isLoading).toBe(true);
		expect(mockApi.postMessage).toHaveBeenCalledWith({
			type: 'command',
			command: 'loadArchivedCourses',
		});
	});

	it('setCourses populates courses and stops loading', () => {
		const { result } = renderHook(() => useCourseListStore());
		const courses = [makeCourseData({ title: 'Course A' })];

		act(() => {
			result.current.setLoading(true);
		});

		act(() => {
			result.current.setCourses(courses);
		});

		expect(result.current.courses).toEqual(courses);
		expect(result.current.isLoading).toBe(false);
	});

	it('setCourses with archived parameter populates archived courses', () => {
		const { result } = renderHook(() => useCourseListStore());
		const courses = [makeCourseData()];
		const archived = [makeArchivedCourse()];

		act(() => {
			result.current.setCourses(courses, archived);
		});

		expect(result.current.courses).toEqual(courses);
		expect(result.current.archivedCourses).toEqual(archived);
		expect(result.current.archivedLoaded).toBe(true);
	});

	it('setCourses without archived parameter sets archivedLoaded to false', () => {
		const { result } = renderHook(() => useCourseListStore());

		act(() => {
			result.current.setCourses([makeCourseData()]);
		});

		expect(result.current.archivedLoaded).toBe(false);
		expect(result.current.archivedCourses).toEqual([]);
	});

	it('setArchivedCourses populates archived courses and stops loading', () => {
		const { result } = renderHook(() => useCourseListStore());
		const archived = [makeArchivedCourse()];

		act(() => {
			result.current.setLoading(true);
		});

		act(() => {
			result.current.setArchivedCourses(archived);
		});

		expect(result.current.archivedCourses).toEqual(archived);
		expect(result.current.archivedLoaded).toBe(true);
		expect(result.current.isLoading).toBe(false);
	});

	it('setSearchTerm updates searchTerm', () => {
		const { result } = renderHook(() => useCourseListStore());

		act(() => {
			result.current.setSearchTerm('algorithm');
		});

		expect(result.current.searchTerm).toBe('algorithm');
	});

	it('setTypeFilter updates typeFilter', () => {
		const { result } = renderHook(() => useCourseListStore());

		act(() => {
			result.current.setTypeFilter('archived');
		});

		expect(result.current.typeFilter).toBe('archived');
	});

	it('setSemesterFilter updates semesterFilter', () => {
		const { result } = renderHook(() => useCourseListStore());

		act(() => {
			result.current.setSemesterFilter('SS25');
		});

		expect(result.current.semesterFilter).toBe('SS25');
	});

	it('setSortBy updates sortBy', () => {
		const { result } = renderHook(() => useCourseListStore());

		act(() => {
			result.current.setSortBy('title-asc');
		});

		expect(result.current.sortBy).toBe('title-asc');
	});

	it('clearFilters resets all filter fields to defaults', () => {
		const { result } = renderHook(() => useCourseListStore());

		act(() => {
			result.current.setSearchTerm('test');
			result.current.setTypeFilter('active');
			result.current.setSemesterFilter('SS25');
			result.current.setSortBy('title-asc');
		});

		act(() => {
			result.current.clearFilters();
		});

		expect(result.current.searchTerm).toBe('');
		expect(result.current.typeFilter).toBe('all');
		expect(result.current.semesterFilter).toBe('all');
		expect(result.current.sortBy).toBe('semester-desc');
	});

	it('filteredCourses returns active courses filtered by search term', () => {
		const { result } = renderHook(() => useCourseListStore());

		act(() => {
			result.current.setCourses([
				makeCourseData({ title: 'Algorithms and Data Structures', id: 1 }),
				makeCourseData({ title: 'Software Engineering', id: 2 }),
			]);
			result.current.setSearchTerm('algorithm');
		});

		const { active } = result.current.filteredCourses();
		expect(active).toHaveLength(1);
		expect(active[0].course.title).toBe('Algorithms and Data Structures');
	});

	it('filteredCourses returns all courses when search term is empty', () => {
		const { result } = renderHook(() => useCourseListStore());

		act(() => {
			result.current.setCourses([
				makeCourseData({ id: 1 }),
				makeCourseData({ id: 2, title: 'Another' }),
			]);
		});

		const { active } = result.current.filteredCourses();
		expect(active).toHaveLength(2);
	});

	it('filteredCourses sorts active courses by title ascending', () => {
		const { result } = renderHook(() => useCourseListStore());

		act(() => {
			result.current.setCourses([
				makeCourseData({ title: 'Zebra Course', id: 1 }),
				makeCourseData({ title: 'Alpha Course', id: 2 }),
			]);
			result.current.setSortBy('title-asc');
		});

		const { active } = result.current.filteredCourses();
		expect(active[0].course.title).toBe('Alpha Course');
		expect(active[1].course.title).toBe('Zebra Course');
	});

	it('filteredCourses sorts courses by semester descending', () => {
		const { result } = renderHook(() => useCourseListStore());

		act(() => {
			result.current.setCourses([
				makeCourseData({ title: 'Old Course', semester: 'WS23/24', id: 1 }),
				makeCourseData({ title: 'New Course', semester: 'SS25', id: 2 }),
			]);
			result.current.setSortBy('semester-desc');
		});

		const { active } = result.current.filteredCourses();
		expect(active[0].course.title).toBe('New Course');
	});

	it('filteredCourses filters by semester', () => {
		const { result } = renderHook(() => useCourseListStore());

		act(() => {
			result.current.setCourses([
				makeCourseData({ title: 'Spring Course', semester: 'ss25', id: 1 }),
				makeCourseData({ title: 'Winter Course', semester: 'ws24/25', id: 2 }),
			]);
			result.current.setSemesterFilter('ss25');
		});

		const { active } = result.current.filteredCourses();
		expect(active).toHaveLength(1);
		expect(active[0].course.title).toBe('Spring Course');
	});
});
