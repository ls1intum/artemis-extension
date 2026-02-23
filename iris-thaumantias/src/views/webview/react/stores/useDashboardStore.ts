import { create } from 'zustand';
import type { VsCodeApi } from '../../../../shared/messageContracts';

export interface Exercise {
    id?: number;
    title?: string;
    type?: string;
    releaseDate?: string;
    startDate?: string;
    dueDate?: string;
}

export interface CourseData {
    course: {
        id?: number;
        title: string;
        exercises?: Exercise[];
        startDate?: string;
        creationDate?: string;
    };
}

export interface RecentCourseNode {
    courseData: CourseData;
    exercises: Exercise[];
}

interface DashboardState {
    recentCourses: RecentCourseNode[];
    workspaceExercise: { id: number; title: string } | null;
    isLoading: boolean;
    error: string | null;

    // Actions
    loadDashboard: (vscodeApi: VsCodeApi) => void;
    setDashboardData: (courses: RecentCourseNode[]) => void;
    setWorkspaceExercise: (exercise: { id: number; title: string } | null) => void;
    setError: (error: string | null) => void;
    setLoading: (loading: boolean) => void;
}

export const useDashboardStore = create<DashboardState>((set) => ({
    recentCourses: [],
    workspaceExercise: null,
    isLoading: false,
    error: null,

    loadDashboard: (vscodeApi: VsCodeApi) => {
        set({ isLoading: true, error: null });
        vscodeApi.postMessage({
            type: 'command',
            command: 'reloadDashboard',
        });
    },

    setDashboardData: (courses: RecentCourseNode[]) => {
        // Sort and limit to 3 most recent courses
        const sortedCourses = courses
            .sort((a, b) => {
                const aDate = a.courseData.course.startDate || a.courseData.course.creationDate || '';
                const bDate = b.courseData.course.startDate || b.courseData.course.creationDate || '';
                return bDate.localeCompare(aDate);
            })
            .slice(0, 3);

        set({ recentCourses: sortedCourses, isLoading: false, error: null });
    },

    setWorkspaceExercise: (exercise: { id: number; title: string } | null) => {
        set({ workspaceExercise: exercise });
    },

    setError: (error: string | null) => {
        set({ error, isLoading: false });
    },

    setLoading: (loading: boolean) => {
        set({ isLoading: loading });
    },
}));
