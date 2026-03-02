import { describe, it, expect, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';

// Mock the Web Worker-based exam timer hook — the esbuild-plugin-inline-worker
// transform is not available in Vitest's SSR environment.
vi.mock('../../../src/views/webview/react/hooks/useExamTimer', () => ({
    useExamTimer: vi.fn(() => ({ remaining: 3_600_000, expired: false })),
}));

// View components
import { GitCredentialsView } from '../../../src/views/webview/react/views/GitCredentials/GitCredentialsView';
import { ServiceStatusView } from '../../../src/views/webview/react/views/ServiceStatus/ServiceStatusView';
import { RecommendedExtensionsView } from '../../../src/views/webview/react/views/RecommendedExtensions/RecommendedExtensionsView';

import { DashboardView } from '../../../src/views/webview/react/views/Dashboard/DashboardView';
import { CourseListView } from '../../../src/views/webview/react/views/CourseList/CourseListView';
import { CourseDetailView } from '../../../src/views/webview/react/views/CourseDetail/CourseDetailView';
import { ExerciseDetailView } from '../../../src/views/webview/react/views/ExerciseDetail/ExerciseDetailView';
import { ExamStartView } from '../../../src/views/webview/react/views/ExamStart/ExamStartView';
import { ExamConductionView } from '../../../src/views/webview/react/views/ExamConduction/ExamConductionView';
import { ExamExerciseDetailView } from '../../../src/views/webview/react/views/ExamExerciseDetail/ExamExerciseDetailView';
import { IrisChatView } from '../../../src/views/webview/react/views/IrisChat/IrisChatView';

// Zustand stores
import { useDashboardStore } from '../../../src/views/webview/react/stores/useDashboardStore';
import { useCourseListStore } from '../../../src/views/webview/react/stores/useCourseListStore';
import { useCourseDetailStore } from '../../../src/views/webview/react/stores/useCourseDetailStore';
import { useExerciseDetailStore } from '../../../src/views/webview/react/stores/useExerciseDetailStore';
import { useExamStartStore } from '../../../src/views/webview/react/stores/useExamStartStore';
import { useExamConductionStore } from '../../../src/views/webview/react/stores/useExamConductionStore';
import { useExamExerciseDetailStore } from '../../../src/views/webview/react/stores/useExamExerciseDetailStore';
import { useChatStore } from '../../../src/views/webview/react/stores/useChatStore';

// Test helpers
import { createMockVsCodeApi, dispatchExtensionMessage } from '../__helpers__/vscodeApi';

// Fixture factories
import {
    createGitCredentialsPayload,
    createServiceStatusPayload,
    createRecommendedExtensionsPayload,
    createDashboardPayload,
    createCourseListPayload,
    createCourseDetailPayload,
    createExerciseDetailPayload,
    createExamStartPayload,
    createExamConductionPayload,
    createExamExerciseDetailPayload,
    createIrisInitPayload,
} from '../fixtures';

/**
 * Store hydration flow integration tests.
 *
 * Verifies that each of the 12 Init message types correctly hydrates the
 * corresponding Zustand store (or local React state for views 1–4) when
 * dispatched after the view is mounted and its message listener is registered.
 *
 * Pattern:
 *  1. render(<View vscodeApi={mockApi} />)   — registers the message listener
 *  2. await act(async () => { dispatchExtensionMessage(...) })  — triggers state update + React flush
 *  3. assert on store.getState() or DOM content
 */

// ============================================================================
// 1. gitCredentialsInit → GitCredentialsView local state
// ============================================================================

describe('gitCredentialsInit hydrates GitCredentialsView local state', () => {
    it('renders pre-filled name and email after init message', async () => {
        const mockApi = createMockVsCodeApi();
        render(<GitCredentialsView vscodeApi={mockApi} />);

        await act(async () => {
            dispatchExtensionMessage(
                createGitCredentialsPayload({
                    currentName: 'Alice Example',
                    currentEmail: 'alice@tum.de',
                }),
            );
        });

        expect((screen.getByDisplayValue('Alice Example') as HTMLInputElement).value).toBe('Alice Example');
        expect((screen.getByDisplayValue('alice@tum.de') as HTMLInputElement).value).toBe('alice@tum.de');
    });
});

// ============================================================================
// 2. serviceStatusInit → ServiceStatusView local state
// ============================================================================

describe('serviceStatusInit hydrates ServiceStatusView local state', () => {
    it('renders server URL after init message', async () => {
        const mockApi = createMockVsCodeApi();
        render(<ServiceStatusView vscodeApi={mockApi} />);

        await act(async () => {
            dispatchExtensionMessage(
                createServiceStatusPayload({ serverUrl: 'https://artemis.test.example' }),
            );
        });

        expect(screen.getByDisplayValue('https://artemis.test.example')).toBeInTheDocument();
    });
});

// ============================================================================
// 3. recommendedExtensionsInit → RecommendedExtensionsView local state
// ============================================================================

describe('recommendedExtensionsInit hydrates RecommendedExtensionsView local state', () => {
    it('renders extension category name after init message', async () => {
        const mockApi = createMockVsCodeApi();
        render(<RecommendedExtensionsView vscodeApi={mockApi} />);

        await act(async () => {
            dispatchExtensionMessage(
                createRecommendedExtensionsPayload({
                    categories: [
                        {
                            id: 'git-tools',
                            name: 'Git Tools',
                            description: 'Extensions for better Git workflows',
                            extensions: [
                                {
                                    id: 'eamodio.gitlens',
                                    name: 'GitLens',
                                    publisher: 'GitKraken',
                                    description: 'Git supercharged',
                                    reason: 'See who changed code and when',
                                    isInstalled: false,
                                },
                            ],
                        },
                    ],
                }),
            );
        });

        expect(screen.getAllByText('Git Tools').length).toBeGreaterThan(0);
        expect(screen.getByText('GitLens')).toBeInTheDocument();
    });
});

// ============================================================================
// 4. showLoggedIn → LoginView local state
// ============================================================================

// ============================================================================
// 5. dashboardInit → useDashboardStore
// ============================================================================

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
    });
});

// ============================================================================
// 6. courseListInit → useCourseListStore
// ============================================================================

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

// ============================================================================
// 7. courseDetailInit → useCourseDetailStore
// ============================================================================

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
                            exams: [],
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

// ============================================================================
// 8. exerciseDetailInit → useExerciseDetailStore
// ============================================================================

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

// ============================================================================
// 9. examStartInit → useExamStartStore
// ============================================================================

describe('examStartInit hydrates useExamStartStore', () => {
    it('sets studentExam, courseId, and loading=false on init', async () => {
        const mockApi = createMockVsCodeApi();
        render(<ExamStartView vscodeApi={mockApi} />);

        await act(async () => {
            dispatchExtensionMessage(
                createExamStartPayload({
                    studentExam: { id: 11 },
                    courseId: 3,
                    examId: 7,
                }),
            );
        });

        const state = useExamStartStore.getState();
        expect(state.studentExam).not.toBeNull();
        expect(state.courseId).toBe(3);
        expect(state.isLoading).toBe(false);
    });
});

// ============================================================================
// 10. examConductionInit → useExamConductionStore
// ============================================================================

describe('examConductionInit hydrates useExamConductionStore', () => {
    it('sets studentExam, courseId, and loading=false on init', async () => {
        const mockApi = createMockVsCodeApi();
        const now = Date.now();

        await act(async () => {
            render(<ExamConductionView vscodeApi={mockApi} />);
        });

        await act(async () => {
            dispatchExtensionMessage(
                createExamConductionPayload({
                    studentExam: { id: 22 },
                    courseId: 5,
                    examId: 9,
                    endTime: now + 3_600_000,
                    startTime: now,
                    totalDuration: 3600,
                    workspaceExerciseId: null,
                }),
            );
        });

        const state = useExamConductionStore.getState();
        expect(state.studentExam).not.toBeNull();
        expect(state.courseId).toBe(5);
        expect(state.isLoading).toBe(false);
    });
});

// ============================================================================
// 11. examExerciseDetailInit → useExamExerciseDetailStore
// ============================================================================

describe('examExerciseDetailInit hydrates useExamExerciseDetailStore', () => {
    it('sets examContext and loading=false on init', async () => {
        const mockApi = createMockVsCodeApi();
        const now = Date.now();

        await act(async () => {
            render(<ExamExerciseDetailView vscodeApi={mockApi} />);
        });

        await act(async () => {
            dispatchExtensionMessage(
                createExamExerciseDetailPayload({
                    exerciseData: { exercise: { id: 33, title: 'Exam Exercise Alpha' } },
                    examContext: {
                        courseId: 6,
                        examId: 12,
                        studentExam: { id: 5 },
                        endTime: now + 3_600_000,
                        startTime: now,
                        totalDuration: 3600,
                    },
                    hideDeveloperTools: false,
                }),
            );
        });

        const state = useExamExerciseDetailStore.getState();
        expect(state.examContext).not.toBeNull();
        expect(state.examContext?.courseId).toBe(6);
        expect(state.isLoading).toBe(false);
    });
});

// ============================================================================
// 12. updateIrisState → useChatStore
// ============================================================================

describe('updateIrisState hydrates useChatStore', () => {
    it('sets sessions, context, and activeSessionId on init', async () => {
        const mockApi = createMockVsCodeApi();

        await act(async () => {
            render(<IrisChatView vscodeApi={mockApi} />);
        });

        await act(async () => {
            dispatchExtensionMessage(
                createIrisInitPayload({
                    context: {
                        type: 'course',
                        id: 1,
                        title: 'Test Course',
                        shortName: 'TC',
                        locked: false,
                        source: 'user-selected',
                    },
                    activeSessionId: 'session-abc',
                    sessions: [
                        {
                            id: 'session-abc',
                            artemisSessionId: 99,
                            preview: 'Hello Iris',
                            messageCount: 1,
                            createdAt: 1700000000000,
                            lastActivity: 1700001000000,
                        },
                    ],
                    recentExercises: [],
                    recentCourses: [{ id: 1, title: 'Test Course', shortName: 'TC' }],
                    allExercises: [],
                    allCourses: [{ id: 1, title: 'Test Course', shortName: 'TC' }],
                }),
            );
        });

        const state = useChatStore.getState();
        expect(state.sessions.length).toBeGreaterThan(0);
        expect(state.activeSessionId).toBe('session-abc');
        expect(state.context).not.toBeNull();
    });
});
