import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import type { CourseDetailData } from '@shared/messageContracts';

import { createMockVsCodeApi, dispatchExtensionMessage } from '@test/react/__helpers__/vscodeApi';
import { useCourseDetailStore } from '@webview/stores/useCourseDetailStore';
import { useCourseListStore } from '@webview/stores/useCourseListStore';
import { CourseDetailView } from '@webview/views/CourseDetail/CourseDetailView';
import { CourseListView } from '@webview/views/CourseList/CourseListView';

/**
 * Course navigation flow integration tests.
 *
 * Tests the course browsing flows: CourseListView (list -> click course) and
 * CourseDetailView (display course + exercises -> click exercise) independently
 * with mocked store data. Exercises full postMessage round-trip verification.
 */

function makeCourseDetailData(overrides: Partial<CourseDetailData['course']> = {}): CourseDetailData {
	return {
		course: {
			id: 1,
			title: 'Test Course',
			semester: 'SS25',
			description: 'A test course',
			...overrides,
		},
	};
}

describe('Course Navigation Flow', () => {
	describe('Course list -> course detail navigation', () => {
		it('displays courses after receiving courseListInit message', async () => {
			const mockApi = createMockVsCodeApi();
			render(<CourseListView vscodeApi={mockApi} />);

			dispatchExtensionMessage({
				type: 'courseListInit',
				courses: [
					makeCourseDetailData({ id: 1, title: 'Algorithms', semester: 'WS24/25' }),
					makeCourseDetailData({ id: 2, title: 'Data Structures', semester: 'SS25' }),
				],
			});

			await waitFor(() => {
				expect(screen.getByText('Algorithms')).toBeInTheDocument();
				expect(screen.getByText('Data Structures')).toBeInTheDocument();
			});
		});

		it('sends viewCourseDetails postMessage when course is clicked', async () => {
			const user = userEvent.setup();
			const mockApi = createMockVsCodeApi();
			render(<CourseListView vscodeApi={mockApi} />);

			dispatchExtensionMessage({
				type: 'courseListInit',
				courses: [makeCourseDetailData({ id: 10, title: 'Software Engineering', semester: 'SS25' })],
			});

			await waitFor(() => {
				expect(screen.getByText('Software Engineering')).toBeInTheDocument();
			});

			await user.click(screen.getByText('Software Engineering'));

			expect(mockApi.postMessage).toHaveBeenCalledWith(
				expect.objectContaining({
					type: 'command',
					command: 'viewCourseDetails',
					payload: { courseId: 10 },
				})
			);
		});

		it('shows loading skeleton during data fetch', () => {
			useCourseListStore.setState({ isLoading: true, courses: [] });
			const mockApi = createMockVsCodeApi();
			render(<CourseListView vscodeApi={mockApi} />);

			const busyElements = document.querySelectorAll('[aria-busy="true"]');
			expect(busyElements.length).toBeGreaterThan(0);
		});

	});

	describe('Course detail view', () => {
		it('displays course title and exercises after receiving courseDetailInit message', async () => {
			const mockApi = createMockVsCodeApi();
			render(<CourseDetailView vscodeApi={mockApi} />);

			dispatchExtensionMessage({
				type: 'courseDetailInit',
				courseData: {
					course: {
						id: 1,
						title: 'Advanced Algorithms',
						semester: 'SS25',
						description: 'Advanced course description',
						exercises: [
							{ id: 101, title: 'Binary Search', type: 'programming' },
							{ id: 102, title: 'Quick Sort', type: 'programming' },
						],
					},
				},
			});

			await waitFor(() => {
				expect(screen.getByText('Advanced Algorithms')).toBeInTheDocument();
				expect(screen.getByText('Binary Search')).toBeInTheDocument();
				expect(screen.getByText('Quick Sort')).toBeInTheDocument();
			});
		});

		it('sends openExerciseDetails postMessage when exercise is clicked', async () => {
			const user = userEvent.setup();
			const mockApi = createMockVsCodeApi();
			render(<CourseDetailView vscodeApi={mockApi} />);

			dispatchExtensionMessage({
				type: 'courseDetailInit',
				courseData: {
					course: {
						id: 1,
						title: 'Test Course',
						semester: 'SS25',
						exercises: [
							{ id: 200, title: 'Unique Exercise Title', type: 'programming' },
						],
					},
				},
			});

			await waitFor(() => {
				expect(screen.getByText('Unique Exercise Title')).toBeInTheDocument();
			});

			await user.click(screen.getByText('Unique Exercise Title'));

			expect(mockApi.postMessage).toHaveBeenCalledWith(
				expect.objectContaining({
					type: 'command',
					command: 'openExerciseDetails',
					payload: expect.objectContaining({ exerciseId: 200 }),
				})
			);
		});

		it('shows empty state when no course data is available', () => {
			useCourseDetailStore.setState({ isLoading: false });
			const mockApi = createMockVsCodeApi();
			render(<CourseDetailView vscodeApi={mockApi} />);
			expect(screen.getByText('No course selected')).toBeInTheDocument();
		});

		it('shows loading skeleton when loading with no course data', () => {
			useCourseDetailStore.setState({ isLoading: true, courseData: null });
			const mockApi = createMockVsCodeApi();
			render(<CourseDetailView vscodeApi={mockApi} />);

			const busyElements = document.querySelectorAll('[aria-busy="true"]');
			expect(busyElements.length).toBeGreaterThan(0);
		});
	});
});
