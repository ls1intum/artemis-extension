import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { createMockVsCodeApi, dispatchExtensionMessage } from '@test/react/__helpers__/vscodeApi';
import type { RecentCourseNode } from '@webview/stores/useDashboardStore';
import { useDashboardStore } from '@webview/stores/useDashboardStore';
import { DashboardView } from '@webview/views/Dashboard/DashboardView';

const makeCourseNode = (id: number, title: string, exercises: Array<{ id: number; title: string }> = []): RecentCourseNode => ({
	courseData: {
		course: {
			id,
			title,
			exercises: exercises.map(e => ({ ...e, type: 'programming' })),
		},
	},
	exercises: exercises.map(e => ({ id: e.id, title: e.title })),
});

describe('DashboardView', () => {
	it('renders welcome header', () => {
		const mockApi = createMockVsCodeApi();
		render(<DashboardView vscodeApi={mockApi} />);
		expect(screen.getByText(/Welcome to/i)).toBeInTheDocument();
		expect(screen.getByText('Artemis')).toBeInTheDocument();
	});

	it('renders subtitle text', () => {
		const mockApi = createMockVsCodeApi();
		render(<DashboardView vscodeApi={mockApi} />);
		expect(screen.getByText('Your programming learning companion')).toBeInTheDocument();
	});

	it('shows loading skeleton when isLoading is true', () => {
		useDashboardStore.setState({ isLoading: true, recentCourses: [] });
		const mockApi = createMockVsCodeApi();
		render(<DashboardView vscodeApi={mockApi} />);
		const busyElements = document.querySelectorAll('[aria-busy="true"]');
		expect(busyElements.length).toBeGreaterThan(0);
	});

	it('displays course cards after receiving dashboardInit message', async () => {
		const mockApi = createMockVsCodeApi();
		render(<DashboardView vscodeApi={mockApi} />);

		dispatchExtensionMessage({
			type: 'dashboardInit',
			courses: [makeCourseNode(1, 'Algorithms and Data Structures')],
		});

		await waitFor(() => {
			expect(screen.getByText('Algorithms and Data Structures')).toBeInTheDocument();
		});
	});

	it('displays multiple courses from dashboardInit', async () => {
		const mockApi = createMockVsCodeApi();
		render(<DashboardView vscodeApi={mockApi} />);

		dispatchExtensionMessage({
			type: 'dashboardInit',
			courses: [
				makeCourseNode(1, 'Course Alpha'),
				makeCourseNode(2, 'Course Beta'),
			],
		});

		await waitFor(() => {
			expect(screen.getByText('Course Alpha')).toBeInTheDocument();
			expect(screen.getByText('Course Beta')).toBeInTheDocument();
		});
	});

	it('clicking show all sends showAllCourses postMessage', async () => {
		const mockApi = createMockVsCodeApi();
		render(<DashboardView vscodeApi={mockApi} />);

		await userEvent.click(screen.getByText('Show All'));

		expect(mockApi.postMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				type: 'command',
				command: 'showAllCourses',
			})
		);
	});

	it('expand button reveals exercises for a course', async () => {
		const mockApi = createMockVsCodeApi();
		render(<DashboardView vscodeApi={mockApi} />);

		dispatchExtensionMessage({
			type: 'dashboardInit',
			courses: [
				makeCourseNode(1, 'My Course', [
					{ id: 10, title: 'Exercise One' },
					{ id: 11, title: 'Exercise Two' },
				]),
			],
		});

		await waitFor(() => {
			expect(screen.getByText('My Course')).toBeInTheDocument();
		});

		// First course is expanded by default (index 0 is in expandedCourses initial state)
		expect(screen.getByText('Exercise One')).toBeInTheDocument();
		expect(screen.getByText('Exercise Two')).toBeInTheDocument();
	});

	it('clicking exercise sends openExercise postMessage with exerciseId', async () => {
		const mockApi = createMockVsCodeApi();
		render(<DashboardView vscodeApi={mockApi} />);

		dispatchExtensionMessage({
			type: 'dashboardInit',
			courses: [
				makeCourseNode(1, 'My Course', [{ id: 42, title: 'Clickable Exercise' }]),
			],
		});

		await waitFor(() => {
			expect(screen.getByText('Clickable Exercise')).toBeInTheDocument();
		});

		await userEvent.click(screen.getByText('Clickable Exercise'));

		expect(mockApi.postMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				type: 'command',
				command: 'openExercise',
				payload: expect.objectContaining({ exerciseId: 42 }),
			})
		);
	});

	it('clicking course arrow navigates to course details', async () => {
		const mockApi = createMockVsCodeApi();
		render(<DashboardView vscodeApi={mockApi} />);

		dispatchExtensionMessage({
			type: 'dashboardInit',
			courses: [makeCourseNode(7, 'Navigate Course')],
		});

		await waitFor(() => {
			expect(screen.getByText('Navigate Course')).toBeInTheDocument();
		});

		const courseArrow = screen.getByRole('button', { name: 'View course details' });
		await userEvent.click(courseArrow);

		expect(mockApi.postMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				type: 'command',
				command: 'viewCourseDetails',
			})
		);
	});

	it('shows workspace exercise section when workspaceExercise is set', async () => {
		const mockApi = createMockVsCodeApi();
		render(<DashboardView vscodeApi={mockApi} />);

		dispatchExtensionMessage({
			type: 'dashboardInit',
			courses: [],
			workspaceExercise: { id: 55, title: 'My Active Exercise' },
		});

		await waitFor(() => {
			expect(screen.getByText('Current Workspace Exercise')).toBeInTheDocument();
			expect(screen.getByText('My Active Exercise')).toBeInTheDocument();
		});
	});

	it('clicking workspace exercise sends openExercise postMessage', async () => {
		const mockApi = createMockVsCodeApi();
		render(<DashboardView vscodeApi={mockApi} />);

		dispatchExtensionMessage({
			type: 'dashboardInit',
			courses: [],
			workspaceExercise: { id: 77, title: 'Open This Exercise' },
		});

		await waitFor(() => {
			expect(screen.getByText('Open This Exercise')).toBeInTheDocument();
		});

		await userEvent.click(screen.getByText('Open This Exercise'));

		expect(mockApi.postMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				type: 'command',
				command: 'openExercise',
				payload: expect.objectContaining({ exerciseId: 77 }),
			})
		);
	});

	it('reload button sends reloadDashboard postMessage', async () => {
		const mockApi = createMockVsCodeApi();
		render(<DashboardView vscodeApi={mockApi} />);

		const reloadButton = screen.getByRole('button', { name: /Reload Courses/i });
		await userEvent.click(reloadButton);

		expect(mockApi.postMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				type: 'command',
				command: 'reloadDashboard',
			})
		);
	});

	it('renders Browse Courses quick action button', () => {
		const mockApi = createMockVsCodeApi();
		render(<DashboardView vscodeApi={mockApi} />);
		expect(screen.getByText('Browse Courses')).toBeInTheDocument();
	});

	it('clicking Browse Courses sends showAllCourses postMessage', async () => {
		const mockApi = createMockVsCodeApi();
		render(<DashboardView vscodeApi={mockApi} />);

		await userEvent.click(screen.getByText('Browse Courses'));

		expect(mockApi.postMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				type: 'command',
				command: 'showAllCourses',
			})
		);
	});

	it('renders logout button', () => {
		const mockApi = createMockVsCodeApi();
		render(<DashboardView vscodeApi={mockApi} />);
		expect(screen.getByText('Logout from Artemis')).toBeInTheDocument();
	});

	it('clicking logout sends logout postMessage', async () => {
		const mockApi = createMockVsCodeApi();
		render(<DashboardView vscodeApi={mockApi} />);

		await userEvent.click(screen.getByText('Logout from Artemis'));

		expect(mockApi.postMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				type: 'command',
				command: 'logout',
			})
		);
	});

	it('shows the Struggle Detection entry in developer mode', async () => {
		const mockApi = createMockVsCodeApi();
		render(<DashboardView vscodeApi={mockApi} />);
		dispatchExtensionMessage({ type: 'dashboardInit', courses: [], hideDeveloperTools: false });
		await waitFor(() => {
			expect(screen.getByText('Struggle Detection')).toBeInTheDocument();
		});
	});

	it('hides the Struggle Detection entry when not in developer mode', async () => {
		const mockApi = createMockVsCodeApi();
		render(<DashboardView vscodeApi={mockApi} />);
		dispatchExtensionMessage({ type: 'dashboardInit', courses: [], hideDeveloperTools: true });
		await waitFor(() => {
			expect(screen.getByText('Service Status')).toBeInTheDocument();
		});
		expect(screen.queryByText('Struggle Detection')).not.toBeInTheDocument();
	});
});
