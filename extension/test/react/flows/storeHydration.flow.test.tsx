import { act, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { createMockVsCodeApi, dispatchExtensionMessage } from '@test/react/__helpers__/vscodeApi';
import {
    createCourseDetailPayload,
    createCourseListPayload,
    createDashboardPayload,
    createExerciseDetailPayload,
    createIrisInitPayload,
    createSubmissionSetupPayload,
} from '@test/react/fixtures';
import { useChatStore } from '@webview/stores/useChatStore';
import { useCourseDetailStore } from '@webview/stores/useCourseDetailStore';
import { useCourseListStore } from '@webview/stores/useCourseListStore';
import { useDashboardStore } from '@webview/stores/useDashboardStore';
import { useExerciseDetailStore } from '@webview/stores/useExerciseDetailStore';
import { CourseDetailView } from '@webview/views/CourseDetail/CourseDetailView';
import { CourseListView } from '@webview/views/CourseList/CourseListView';
import { DashboardView } from '@webview/views/Dashboard/DashboardView';
import { ExerciseDetailView } from '@webview/views/ExerciseDetail/ExerciseDetailView';
import { IrisChatView } from '@webview/views/IrisChat/IrisChatView';
import { SubmissionSetupView } from '@webview/views/SubmissionSetup/SubmissionSetupView';

/**
 * Store hydration flow integration tests.
 *
 * Verifies that each Init message type hydrates its Zustand store (or the
 * view's local React state) when dispatched after the view is mounted and its
 * message listener is registered.
 *
 * Pattern:
 *  1. render(<View vscodeApi={mockApi} />) registers the message listener.
 *  2. await act(async () => { dispatchExtensionMessage(...) }) triggers the
 *     state update and the React flush.
 *  3. assert on store.getState() or DOM content
 */

describe('submissionSetupInfo hydrates SubmissionSetupView local state', () => {
    it('renders the four rows after the init message', async () => {
        const mockApi = createMockVsCodeApi();
        render(<SubmissionSetupView vscodeApi={mockApi} />);

        await act(async () => {
            dispatchExtensionMessage(createSubmissionSetupPayload());
        });

        expect(screen.getByTestId('setup-row-git')).toBeInTheDocument();
        expect(screen.getByTestId('setup-row-identity')).toBeInTheDocument();
        expect(screen.getByTestId('setup-row-repository')).toBeInTheDocument();
        expect(screen.getByTestId('setup-row-access')).toBeInTheDocument();
        expect(screen.getByText('Sorting Algorithms')).toBeInTheDocument();
    });
});

describe('dashboardInit hydrates useDashboardStore', () => {
    it('sets recentCourses and isLoading=false on init', async () => {
        const mockApi = createMockVsCodeApi();
        render(<DashboardView vscodeApi={mockApi} />);

        await act(async () => {
            dispatchExtensionMessage(
                createDashboardPayload({
                    courses: [
                        {
                            courseData: {
                                course: {
                                    id: 42,
                                    title: 'Algorithms & Data Structures',
                                    startDate: '2024-10-01',
                                },
                            },
                            exercises: [],
                        },
                    ],
                }),
            );
        });

        const state = useDashboardStore.getState();
        expect(state.recentCourses.length).toBeGreaterThan(0);
        expect(state.recentCourses[0].courseData.course.id).toBe(42);
        expect(state.isLoading).toBe(false);
        // hideDeveloperTools hydrates from the payload (fail-closed default is true → init sets false).
        expect(state.hideDeveloperTools).toBe(false);
    });
});

describe('courseListInit hydrates useCourseListStore', () => {
    it('sets courses and isLoading=false on init', async () => {
        const mockApi = createMockVsCodeApi();
        render(<CourseListView vscodeApi={mockApi} />);

        await act(async () => {
            dispatchExtensionMessage(
                createCourseListPayload({
                    courses: [
                        { course: { id: 7, title: 'Software Engineering' } },
                        { course: { id: 8, title: 'Computer Networks' } },
                    ],
                }),
            );
        });

        const state = useCourseListStore.getState();
        expect(state.courses.length).toBe(2);
        expect(state.courses[0].course.title).toBe('Software Engineering');
        expect(state.isLoading).toBe(false);
    });
});

describe('courseDetailInit hydrates useCourseDetailStore', () => {
    it('sets courseData and isLoading=false on init', async () => {
        const mockApi = createMockVsCodeApi();
        render(<CourseDetailView vscodeApi={mockApi} />);

        await act(async () => {
            dispatchExtensionMessage(
                createCourseDetailPayload({
                    courseData: {
                        course: {
                            id: 99,
                            title: 'Functional Programming',
                            semester: 'WS24/25',
                            exercises: [],
                        },
                    },
                }),
            );
        });

        const state = useCourseDetailStore.getState();
        expect(state.courseData).not.toBeNull();
        expect(state.courseData?.course.id).toBe(99);
        expect(state.isLoading).toBe(false);
    });
});

describe('exerciseDetailInit hydrates useExerciseDetailStore', () => {
    it('sets exerciseData and isLoading=false on init', async () => {
        const mockApi = createMockVsCodeApi();
        render(<ExerciseDetailView vscodeApi={mockApi} />);

        await act(async () => {
            dispatchExtensionMessage(
                createExerciseDetailPayload({
                    exerciseData: {
                        exercise: { id: 55, title: 'Binary Search Tree' },
                    },
                    hideDeveloperTools: false,
                }),
            );
        });

        const state = useExerciseDetailStore.getState();
        expect(state.exerciseData).not.toBeNull();
        expect(state.exerciseData?.exercise?.id).toBe(55);
        expect(state.isLoading).toBe(false);
    });
});

describe('updateIrisState hydrates useChatStore', () => {
    it('sets the open conversation, its course and the picker lists on init', async () => {
        const mockApi = createMockVsCodeApi();

        await act(async () => {
            render(<IrisChatView vscodeApi={mockApi} />);
        });

        await act(async () => {
            dispatchExtensionMessage(
                createIrisInitPayload({
                    courseId: 1,
                    courseTitle: 'Test Course',
                    currentSessionId: 99,
                    conversationTitle: 'Hello Iris',
                    displayMessageCount: 1,
                    exercises: [],
                    courses: [{ id: 1, title: 'Test Course', shortName: 'TC' }],
                }),
            );
        });

        const state = useChatStore.getState();
        expect(state.currentSessionId).toBe(99);
        expect(state.courseTitle).toBe('Test Course');
        expect(state.courses.length).toBeGreaterThan(0);
    });
});
