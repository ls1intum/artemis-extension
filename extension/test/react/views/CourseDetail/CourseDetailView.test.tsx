import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import type { CourseDetailData } from '@shared/messageContracts';

import { createMockVsCodeApi, dispatchExtensionMessage } from '@test/react/__helpers__/vscodeApi';
import { useCourseDetailStore } from '@webview/stores/useCourseDetailStore';
import { CourseDetailView } from '@webview/views/CourseDetail/CourseDetailView';

const makeCourseDetailData = (overrides: Partial<CourseDetailData['course']> = {}): CourseDetailData => ({
	course: {
		id: 1,
		title: 'Test Course',
		semester: 'SS25',
		description: 'A test course description',
		exercises: [],
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
		useCourseDetailStore.setState({ isLoading: false });
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

	// --- error state ---

	it('shows error message when error is set', () => {
		useCourseDetailStore.setState({ error: 'Failed to load course', isLoading: false });
		const mockApi = createMockVsCodeApi();
		render(<CourseDetailView vscodeApi={mockApi} />);
		expect(screen.getByText('Failed to load course')).toBeInTheDocument();
	});

	it('shows Retry button in error state', () => {
		useCourseDetailStore.setState({ error: 'Network error', isLoading: false });
		const mockApi = createMockVsCodeApi();
		render(<CourseDetailView vscodeApi={mockApi} />);
		expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
	});

	it('clicking Retry in error state sends requestInit message', async () => {
		useCourseDetailStore.setState({ error: 'Network error', isLoading: false });
		const mockApi = createMockVsCodeApi();
		render(<CourseDetailView vscodeApi={mockApi} />);

		await userEvent.click(screen.getByRole('button', { name: 'Retry' }));

		expect(mockApi.postMessage).toHaveBeenCalledWith(
			expect.objectContaining({ type: 'requestInit' })
		);
	});
});
