import { describe, it, expect } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CourseListView } from '../../../src/views/webview/views/CourseList/CourseListView';
import { CourseDetailView } from '../../../src/views/webview/views/CourseDetail/CourseDetailView';
import { useCourseListStore } from '../../../src/views/webview/stores/useCourseListStore';
import { useCourseDetailStore } from '../../../src/views/webview/stores/useCourseDetailStore';
import { createMockVsCodeApi, dispatchExtensionMessage } from '../__helpers__/vscodeApi';
import type { CourseData } from '../../../src/shared/messageContracts';

/**
 * Course navigation flow integration tests.
 *
 * Tests the course browsing flows: CourseListView (list -> click course) and
 * CourseDetailView (display course + exercises -> click exercise) independently
 * with mocked store data. Exercises full postMessage round-trip verification.
 */

function makeCourseData(overrides: Partial<CourseData['course']> = {}): CourseData {
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

			// INBOUND: simulate course data from extension
			dispatchExtensionMessage({
				type: 'courseListInit',
				courses: [
					makeCourseData({ id: 1, title: 'Algorithms', semester: 'WS24/25' }),
					makeCourseData({ id: 2, title: 'Data Structures', semester: 'SS25' }),
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

			// Load courses via message
			dispatchExtensionMessage({
				type: 'courseListInit',
				courses: [makeCourseData({ id: 10, title: 'Software Engineering', semester: 'SS25' })],
			});

			await waitFor(() => {
				expect(screen.getByText('Software Engineering')).toBeInTheDocument();
			});

			// Click on a course
			await user.click(screen.getByText('Software Engineering'));

			// OUTBOUND: verify viewCourseDetails postMessage sent with course data
			expect(mockApi.postMessage).toHaveBeenCalledWith(
				expect.objectContaining({
					type: 'command',
					command: 'viewCourseDetails',
					payload: expect.objectContaining({
						courseData: expect.objectContaining({ id: 10 }),
					}),
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

			// INBOUND: simulate course detail data from extension
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
						exams: [],
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

			// Load course detail
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
						exams: [],
					},
				},
			});

			await waitFor(() => {
				expect(screen.getByText('Unique Exercise Title')).toBeInTheDocument();
			});

			// Click on the exercise
			await user.click(screen.getByText('Unique Exercise Title'));

			// OUTBOUND: verify openExerciseDetails postMessage with exerciseId
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
