import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { postCommand, type VsCodeApi, type RecentCourseNode } from '../../../../shared/messageContracts';

export type { RecentCourseNode } from '../../../../shared/messageContracts';

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

export const useDashboardStore = create<DashboardState>()(
    devtools(
        (set) => ({
            recentCourses: [],
            workspaceExercise: null,
            isLoading: false,
            error: null,

            loadDashboard: (vscodeApi: VsCodeApi) => {
                set({ isLoading: true, error: null }, false, 'loadDashboard');
                postCommand(vscodeApi, 'reloadDashboard');
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

                set({ recentCourses: sortedCourses, isLoading: false, error: null }, false, 'setDashboardData');
            },

            setWorkspaceExercise: (exercise: { id: number; title: string } | null) => {
                set({ workspaceExercise: exercise }, false, 'setWorkspaceExercise');
            },

            setError: (error: string | null) => {
                set({ error, isLoading: false }, false, 'setError');
            },

            setLoading: (loading: boolean) => {
                set({ isLoading: loading }, false, 'setLoading');
            },
        }),
        {
            name: 'DashboardStore',
            enabled: process.env.NODE_ENV === 'development',
        }
    )
);
