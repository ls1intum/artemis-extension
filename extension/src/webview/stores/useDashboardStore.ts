import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { postCommand, type VsCodeApi, type RecentCourseNode } from '../../shared/messageContracts';

export type { RecentCourseNode } from '../../shared/messageContracts';

interface DashboardState {
    recentCourses: RecentCourseNode[];
    workspaceExercise: { id: number; title: string } | 'loading' | null;
    isLoading: boolean;

    // Actions
    loadDashboard: (vscodeApi: VsCodeApi) => void;
    setDashboardData: (courses: RecentCourseNode[]) => void;
    setWorkspaceExercise: (exercise: { id: number; title: string } | 'loading' | null) => void;
    setLoading: (loading: boolean) => void;
}

export const useDashboardStore = create<DashboardState>()(
    devtools(
        (set) => ({
            recentCourses: [],
            workspaceExercise: 'loading',
            isLoading: false,

            loadDashboard: (vscodeApi: VsCodeApi) => {
                set({ isLoading: true, workspaceExercise: 'loading' }, false, 'loadDashboard');
                postCommand(vscodeApi, 'reloadDashboard');
            },

            setDashboardData: (courses: RecentCourseNode[]) => {
                // Trust the extension-side selection: the payload is already
                // ordered (accessed-first DESC by timestamp, fallback-sorted) and
                // truncated to the display limit. Re-sorting here would override
                // the access-based ordering.
                set({ recentCourses: courses, isLoading: false }, false, 'setDashboardData');
            },

            setWorkspaceExercise: (exercise: { id: number; title: string } | 'loading' | null) => {
                set({ workspaceExercise: exercise }, false, 'setWorkspaceExercise');
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
