import { create } from 'zustand';
import { devtools } from 'zustand/middleware';

import { postCommand, type RecentCourseNode, type VsCodeApi } from '@shared/messageContracts';

export type { RecentCourseNode } from '@shared/messageContracts';

interface DashboardState {
    recentCourses: RecentCourseNode[];
    workspaceExercise: { id: number; title: string } | 'loading' | null;
    isLoading: boolean;
    /** True when NOT in developer mode. Hides developer-only dashboard entries (the
     *  struggle-detection page). Fail-closed default (true) so the dev entry stays hidden
     *  until the init payload confirms developer mode. */
    hideDeveloperTools: boolean;

    loadDashboard: (vscodeApi: VsCodeApi) => void;
    setDashboardData: (courses: RecentCourseNode[]) => void;
    setWorkspaceExercise: (exercise: { id: number; title: string } | 'loading' | null) => void;
    setHideDeveloperTools: (hide: boolean) => void;
    setLoading: (loading: boolean) => void;
}

export const useDashboardStore = create<DashboardState>()(
    devtools(
        (set) => ({
            recentCourses: [],
            workspaceExercise: 'loading',
            isLoading: false,
            hideDeveloperTools: true,

            loadDashboard: (vscodeApi: VsCodeApi) => {
                set({ isLoading: true, workspaceExercise: 'loading' }, false, 'loadDashboard');
                postCommand(vscodeApi, 'reloadDashboard');
            },

            setDashboardData: (courses: RecentCourseNode[]) => {
                // Ordering owned by extension side; do not re-sort here.
                set({ recentCourses: courses, isLoading: false }, false, 'setDashboardData');
            },

            setWorkspaceExercise: (exercise: { id: number; title: string } | 'loading' | null) => {
                set({ workspaceExercise: exercise }, false, 'setWorkspaceExercise');
            },

            setHideDeveloperTools: (hide: boolean) => {
                set({ hideDeveloperTools: hide }, false, 'setHideDeveloperTools');
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
