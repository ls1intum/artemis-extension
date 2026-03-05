import { describe, it, expect } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CourseDetailView } from '../../../../src/views/webview/react/views/CourseDetail/CourseDetailView';
import { useCourseDetailStore } from '../../../../src/views/webview/react/stores/useCourseDetailStore';
import { createMockVsCodeApi, dispatchExtensionMessage } from '../../__helpers__/vscodeApi';
import type { CourseDetailData } from '../../../../src/shared/messageContracts';

const makeCourseDetailData = (overrides: Partial<CourseDetailData['course']> = {}): CourseDetailData => ({
	course: {
		id: 1,
		title: 'Test Course',
		semester: 'SS25',
		description: 'A test course description',
		exercises: [],
		exams: [],
		...overrides,
	},
});

describe('CourseDetailView', () => {
	it('shows loading skeleton when isLoading is true and no courseData', () => {
		useCourseDetailStore.setState({ isLoading: true, courseData: null });
		const mockApi = createMockVsCodeApi();
		render(<CourseDetailView vscodeApi={mockApi} />);
		const busyElements = document.querySelectorAll('[aria-busy="true"]');
		expect(busyElements.length).toBeGreaterThan(0);
	});

	it('shows empty state when no courseData and no error', () => {
		const mockApi = createMockVsCodeApi();
		render(<CourseDetailView vscodeApi={mockApi} />);
		expect(screen.getByText('No course selected')).toBeInTheDocument();
	});

	it('displays course title after receiving courseDetailInit message', async () => {
		const mockApi = createMockVsCodeApi();
		render(<CourseDetailView vscodeApi={mockApi} />);

		dispatchExtensionMessage({
			type: 'courseDetailInit',
			courseData: makeCourseDetailData({ title: 'Advanced Algorithms', id: 10 }),
		});

		await waitFor(() => {
			expect(screen.getByText('Advanced Algorithms')).toBeInTheDocument();
		});
	});

	it('displays course description after receiving courseDetailInit message', async () => {
		const mockApi = createMockVsCodeApi();
		render(<CourseDetailView vscodeApi={mockApi} />);

		dispatchExtensionMessage({
			type: 'courseDetailInit',
			courseData: makeCourseDetailData({
				title: 'My Course',
				description: 'This is a detailed description',
				id: 5,
			}),
		});

		await waitFor(() => {
			expect(screen.getByText('This is a detailed description')).toBeInTheDocument();
		});
	});

	it('renders exercise list within course', async () => {
		const mockApi = createMockVsCodeApi();
		render(<CourseDetailView vscodeApi={mockApi} />);

		dispatchExtensionMessage({
			type: 'courseDetailInit',
			courseData: makeCourseDetailData({
				title: 'Course With Exercises',
				id: 1,
				exercises: [
					{ id: 101, title: 'Exercise One', type: 'programming' },
					{ id: 102, title: 'Exercise Two', type: 'quiz' },
				],
			}),
		});

		await waitFor(() => {
			expect(screen.getByText('Exercise One')).toBeInTheDocument();
			expect(screen.getByText('Exercise Two')).toBeInTheDocument();
		});
	});

	it('clicking exercise sends openExerciseDetails postMessage with exerciseId', async () => {
		const mockApi = createMockVsCodeApi();
		render(<CourseDetailView vscodeApi={mockApi} />);

		dispatchExtensionMessage({
			type: 'courseDetailInit',
			courseData: makeCourseDetailData({
				title: 'Course',
				id: 1,
				exercises: [{ id: 999, title: 'Clickable Exercise', type: 'programming' }],
			}),
		});

		await waitFor(() => {
			expect(screen.getByText('Clickable Exercise')).toBeInTheDocument();
		});

		await userEvent.click(screen.getByText('Clickable Exercise'));

		expect(mockApi.postMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				type: 'command',
				command: 'openExerciseDetails',
				payload: expect.objectContaining({ exerciseId: 999 }),
			})
		);
	});

	it('back button sends backToDashboard postMessage', async () => {
		const mockApi = createMockVsCodeApi();
		render(<CourseDetailView vscodeApi={mockApi} />);

		const backButton = screen.getByText('Back to Dashboard');
		await userEvent.click(backButton);

		expect(mockApi.postMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				type: 'command',
				command: 'backToDashboard',
			})
		);
	});

	it('shows No exercises available when course has no exercises', async () => {
		const mockApi = createMockVsCodeApi();
		render(<CourseDetailView vscodeApi={mockApi} />);

		dispatchExtensionMessage({
			type: 'courseDetailInit',
			courseData: makeCourseDetailData({ title: 'Empty Course', id: 1, exercises: [] }),
		});

		await waitFor(() => {
			expect(screen.getByText('No exercises available')).toBeInTheDocument();
		});
	});

	it('displays exam list when course has exams', async () => {
		const mockApi = createMockVsCodeApi();
		render(<CourseDetailView vscodeApi={mockApi} />);

		dispatchExtensionMessage({
			type: 'courseDetailInit',
			courseData: makeCourseDetailData({
				title: 'Course With Exam',
				id: 1,
				exams: [
					{
						id: 201,
						title: 'Midterm Exam',
						startDate: '2025-06-15T09:00:00Z',
						endDate: '2025-06-15T12:00:00Z',
					},
				],
			}),
		});

		await waitFor(() => {
			expect(screen.getByText('Midterm Exam')).toBeInTheDocument();
		});
	});

	it('clicking exam sends openExam postMessage with examId and courseId', async () => {
		const mockApi = createMockVsCodeApi();
		render(<CourseDetailView vscodeApi={mockApi} />);

		dispatchExtensionMessage({
			type: 'courseDetailInit',
			courseData: makeCourseDetailData({
				title: 'Course',
				id: 5,
				exams: [
					{
						id: 300,
						title: 'Final Exam',
						startDate: '2025-07-01T10:00:00Z',
						endDate: '2025-07-01T13:00:00Z',
					},
				],
			}),
		});

		await waitFor(() => {
			expect(screen.getByText('Final Exam')).toBeInTheDocument();
		});

		await userEvent.click(screen.getByText('Final Exam'));

		expect(mockApi.postMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				type: 'command',
				command: 'openExam',
				payload: expect.objectContaining({ examId: 300, courseId: 5 }),
			})
		);
	});

	it('renders course semester badge when available', async () => {
		const mockApi = createMockVsCodeApi();
		render(<CourseDetailView vscodeApi={mockApi} />);

		dispatchExtensionMessage({
			type: 'courseDetailInit',
			courseData: makeCourseDetailData({ title: 'Course', id: 1, semester: 'WS24/25' }),
		});

		await waitFor(() => {
			expect(screen.getByText('WS24/25')).toBeInTheDocument();
		});
	});

	it('clicking Reload icon in empty state sends requestInit message', async () => {
		useCourseDetailStore.setState({ courseData: null, isLoading: false });
		const mockApi = createMockVsCodeApi();
		render(<CourseDetailView vscodeApi={mockApi} />);

		// The reload icon button is rendered in the backLinkActions even in empty state
		const reloadButton = screen.getByTitle('Reload');
		await userEvent.click(reloadButton);

		expect(mockApi.postMessage).toHaveBeenCalledWith(
			expect.objectContaining({ type: 'requestInit' })
		);
	});

	it('exercise search filters results', async () => {
		const mockApi = createMockVsCodeApi();
		render(<CourseDetailView vscodeApi={mockApi} />);

		dispatchExtensionMessage({
			type: 'courseDetailInit',
			courseData: makeCourseDetailData({
				title: 'Course',
				id: 1,
				exercises: [
					{ id: 1, title: 'Sorting Algorithm', type: 'programming' },
					{ id: 2, title: 'Graph Theory', type: 'quiz' },
				],
			}),
		});

		await waitFor(() => {
			expect(screen.getByText('Sorting Algorithm')).toBeInTheDocument();
		});

		const searchInput = screen.getByPlaceholderText('Search exercises...');
		await userEvent.type(searchInput, 'sorting');

		await waitFor(() => {
			expect(screen.getByText('Sorting Algorithm')).toBeInTheDocument();
			expect(screen.queryByText('Graph Theory')).not.toBeInTheDocument();
		});
	});
});
