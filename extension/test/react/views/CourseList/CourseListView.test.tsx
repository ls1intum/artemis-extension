import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { CourseDetailData } from '@shared/messageContracts';

import { createMockVsCodeApi, dispatchExtensionMessage } from '@test/react/__helpers__/vscodeApi';
import { useCourseListStore } from '@webview/stores/useCourseListStore';
import { CourseListView } from '@webview/views/CourseList/CourseListView';

const makeCourseDetailData = (overrides: Partial<CourseDetailData['course']> = {}): CourseDetailData => ({
	course: {
		id: 1,
		title: 'Test Course',
		semester: 'SS25',
		description: 'A test course',
		...overrides,
	},
});

describe('CourseListView', () => {
	it('shows loading skeleton when isLoading is true and no courses', () => {
		useCourseListStore.setState({ isLoading: true, courses: [] });
		const mockApi = createMockVsCodeApi();
		render(<CourseListView vscodeApi={mockApi} />);
		// SkeletonList renders aria-busy elements
		const busyElements = document.querySelectorAll('[aria-busy="true"]');
		expect(busyElements.length).toBeGreaterThan(0);
	});

	it('displays course list after receiving courseListInit message', async () => {
		const mockApi = createMockVsCodeApi();
		render(<CourseListView vscodeApi={mockApi} />);

		dispatchExtensionMessage({
			type: 'courseListInit',
			courses: [makeCourseDetailData({ title: 'Algorithms', id: 1 })],
		});

		await waitFor(() => {
			expect(screen.getByText('Algorithms')).toBeInTheDocument();
		});
	});

	it('displays course title and semester from courseListInit payload', async () => {
		const mockApi = createMockVsCodeApi();
		render(<CourseListView vscodeApi={mockApi} />);

		dispatchExtensionMessage({
			type: 'courseListInit',
			courses: [makeCourseDetailData({ title: 'Software Engineering', semester: 'WS24/25', id: 2 })],
		});

		await waitFor(() => {
			expect(screen.getByText('Software Engineering')).toBeInTheDocument();
			// Semester appears in both the course badge and the filter dropdown option
			const semesterElements = screen.getAllByText('WS24/25');
			expect(semesterElements.length).toBeGreaterThan(0);
		});
	});

	it('clicking a course sends viewCourseDetails postMessage', async () => {
		const mockApi = createMockVsCodeApi();
		render(<CourseListView vscodeApi={mockApi} />);

		dispatchExtensionMessage({
			type: 'courseListInit',
			courses: [makeCourseDetailData({ title: 'Click Me Course', id: 42 })],
		});

		await waitFor(() => {
			expect(screen.getByText('Click Me Course')).toBeInTheDocument();
		});

		await userEvent.click(screen.getByText('Click Me Course'));

		expect(mockApi.postMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				type: 'command',
				command: 'viewCourseDetails',
			})
		);
	});

	it('shows empty state text when no active courses match criteria', async () => {
		const mockApi = createMockVsCodeApi();
		render(<CourseListView vscodeApi={mockApi} />);

		dispatchExtensionMessage({
			type: 'courseListInit',
			courses: [],
		});

		await waitFor(() => {
			expect(screen.getByText('No courses available')).toBeInTheDocument();
		});
	});

	it('says the courses could not be loaded instead of claiming there are none', async () => {
		const mockApi = createMockVsCodeApi();
		render(<CourseListView vscodeApi={mockApi} />);

		dispatchExtensionMessage({
			type: 'courseListInit',
			courses: [],
			coursesUnavailable: true,
		});

		await waitFor(() => {
			expect(screen.getByText('Courses could not be loaded.')).toBeInTheDocument();
		});
		expect(screen.queryByText('No courses available')).not.toBeInTheDocument();
	});

	it('keeps showing an older list when only the refresh failed', async () => {
		const mockApi = createMockVsCodeApi();
		render(<CourseListView vscodeApi={mockApi} />);

		dispatchExtensionMessage({
			type: 'courseListInit',
			courses: [makeCourseDetailData({ title: 'Still Here', id: 3 })],
			coursesUnavailable: true,
		});

		await waitFor(() => {
			expect(screen.getByText('Still Here')).toBeInTheDocument();
		});
		expect(screen.queryByText('Courses could not be loaded.')).not.toBeInTheDocument();
	});

	it('shows a restored semester filter that no course has, instead of "All Semesters"', async () => {
		const mockApi = createMockVsCodeApi({
			getState: vi.fn(() => ({ semesterFilter: 'ss24' })) as never,
		});
		render(<CourseListView vscodeApi={mockApi} />);

		dispatchExtensionMessage({
			type: 'courseListInit',
			courses: [makeCourseDetailData({ title: 'Winter Course', semester: 'WS25/26', id: 4 })],
			coursesUnavailable: false,
		});

		await waitFor(() => {
			expect(screen.getByText('No active courses match your criteria.')).toBeInTheDocument();
		});
		expect(screen.getByRole('option', { name: 'SS24', selected: true })).toBeInTheDocument();
	});

	it('shows exercise count for a course', async () => {
		const mockApi = createMockVsCodeApi();
		render(<CourseListView vscodeApi={mockApi} />);

		dispatchExtensionMessage({
			type: 'courseListInit',
			courses: [
				makeCourseDetailData({
					title: 'Course with Exercises',
					id: 10,
					exercises: [
						{ id: 1, title: 'Ex1' },
						{ id: 2, title: 'Ex2' },
						{ id: 3, title: 'Ex3' },
					],
				}),
			],
		});

		await waitFor(() => {
			expect(screen.getByText('3 exercises')).toBeInTheDocument();
		});
	});

	it('renders search input for course filtering', async () => {
		const mockApi = createMockVsCodeApi();
		render(<CourseListView vscodeApi={mockApi} />);

		dispatchExtensionMessage({
			type: 'courseListInit',
			courses: [makeCourseDetailData({ id: 1 })],
		});

		await waitFor(() => {
			expect(screen.getByPlaceholderText(/Search courses/i)).toBeInTheDocument();
		});
	});

	it('filters courses by search term', async () => {
		const mockApi = createMockVsCodeApi();
		render(<CourseListView vscodeApi={mockApi} />);

		dispatchExtensionMessage({
			type: 'courseListInit',
			courses: [
				makeCourseDetailData({ title: 'Algorithms', id: 1 }),
				makeCourseDetailData({ title: 'Biology 101', id: 2 }),
			],
		});

		await waitFor(() => {
			expect(screen.getByText('Algorithms')).toBeInTheDocument();
		});

		const searchInput = screen.getByPlaceholderText(/Search courses/i);
		await userEvent.type(searchInput, 'algo');

		await waitFor(() => {
			expect(screen.getByText('Algorithms')).toBeInTheDocument();
			expect(screen.queryByText('Biology 101')).not.toBeInTheDocument();
		});
	});

	it('shows Load Archived Courses button when archivedLoaded is false', async () => {
		const mockApi = createMockVsCodeApi();
		render(<CourseListView vscodeApi={mockApi} />);

		dispatchExtensionMessage({
			type: 'courseListInit',
			courses: [makeCourseDetailData({ id: 1 })],
		});

		await waitFor(() => {
			expect(screen.getByText('Load Archived Courses')).toBeInTheDocument();
		});
	});

	it('back button sends backToDashboard postMessage', async () => {
		const mockApi = createMockVsCodeApi();
		render(<CourseListView vscodeApi={mockApi} />);

		dispatchExtensionMessage({
			type: 'courseListInit',
			courses: [makeCourseDetailData({ id: 1 })],
		});

		await waitFor(() => {
			expect(screen.getByText('Back to Dashboard')).toBeInTheDocument();
		});

		await userEvent.click(screen.getByText('Back to Dashboard'));
		expect(mockApi.postMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				type: 'command',
				command: 'backToDashboard',
			})
		);
	});
});
