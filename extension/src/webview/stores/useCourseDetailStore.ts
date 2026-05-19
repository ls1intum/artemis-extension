import { create } from 'zustand';
import { devtools } from 'zustand/middleware';

import { type CourseDetailData, type Exercise, postCommand, type VsCodeApi } from '@shared/messageContracts';

interface CourseDetailState {
    courseData: CourseDetailData | null;
    workspaceExerciseId: number | null;
    hideDeveloperTools: boolean;
    isLoading: boolean;
    error: string | null;
    exerciseSearchTerm: string;
    exerciseSortBy: string;

    // Actions
    setCourseData: (data: CourseDetailData, workspaceExerciseId?: number | null, hideDeveloperTools?: boolean) => void;
    setError: (error: string | null) => void;
    setLoading: (loading: boolean) => void;
    setExerciseSearchTerm: (term: string) => void;
    setExerciseSortBy: (sort: string) => void;
    loadCourseDetail: (vscodeApi: VsCodeApi, courseId?: number) => void;

    // Derived
    filteredExercises: () => Exercise[];
}

/**
 * Filter exercises by search term (case-insensitive, matches title or type).
 */
function filterExercises(exercises: Exercise[], searchTerm: string): Exercise[] {
    const lowerSearchTerm = searchTerm.toLowerCase().trim();
    if (!lowerSearchTerm) {
        return exercises;
    }

    return exercises.filter((exercise) => {
        const title = exercise.title?.toLowerCase() || '';
        const type = exercise.type?.toLowerCase() || '';
        return title.includes(lowerSearchTerm) || type.includes(lowerSearchTerm);
    });
}

/**
 * Sort exercises based on selected sort option.
 */
function sortExercises(exercises: Exercise[], sortBy: string): Exercise[] {
    const sorted = [...exercises];

    switch (sortBy) {
        case 'id-asc':
            return sorted.sort((a, b) => (a.id || 0) - (b.id || 0));
        case 'id-desc':
            return sorted.sort((a, b) => (b.id || 0) - (a.id || 0));
        case 'title-asc':
            return sorted.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
        case 'title-desc':
            return sorted.sort((a, b) => (b.title || '').localeCompare(a.title || ''));
        case 'due-asc':
            return sorted.sort((a, b) => {
                const aDate = a.dueDate ? new Date(a.dueDate).getTime() : 0;
                const bDate = b.dueDate ? new Date(b.dueDate).getTime() : 0;
                return aDate - bDate;
            });
        case 'due-desc':
            return sorted.sort((a, b) => {
                const aDate = a.dueDate ? new Date(a.dueDate).getTime() : 0;
                const bDate = b.dueDate ? new Date(b.dueDate).getTime() : 0;
                return bDate - aDate;
            });
        case 'points-asc':
            return sorted.sort((a, b) => (a.maxPoints ?? 0) - (b.maxPoints ?? 0));
        case 'points-desc':
            return sorted.sort((a, b) => (b.maxPoints ?? 0) - (a.maxPoints ?? 0));
        default:
            return sorted;
    }
}

export const useCourseDetailStore = create<CourseDetailState>()(
    devtools(
        (set, get) => ({
            courseData: null,
            workspaceExerciseId: null,
            hideDeveloperTools: true,
            isLoading: true,
            error: null,
            exerciseSearchTerm: '',
            exerciseSortBy: 'id-desc',

            setCourseData: (data, workspaceExerciseId, hideDeveloperTools) => {
                set({
                    courseData: data,
                    workspaceExerciseId: workspaceExerciseId ?? null,
                    hideDeveloperTools: hideDeveloperTools ?? true,
                    isLoading: false,
                    error: null,
                }, false, 'setCourseData');
            },

            setError: (error) => {
                set({ error, isLoading: false }, false, 'setError');
            },

            setLoading: (loading) => {
                set({ isLoading: loading }, false, 'setLoading');
            },

            setExerciseSearchTerm: (term) => {
                set({ exerciseSearchTerm: term }, false, 'setExerciseSearchTerm');
            },

            setExerciseSortBy: (sort) => {
                set({ exerciseSortBy: sort }, false, 'setExerciseSortBy');
            },

            loadCourseDetail: (vscodeApi, courseId) => {
                set({ isLoading: true }, false, 'loadCourseDetail');
                postCommand(vscodeApi, 'reloadCourseDetail', { courseId: courseId || 0 });
            },

            filteredExercises: () => {
                const state = get();
                const { courseData, exerciseSearchTerm, exerciseSortBy } = state;

                if (!courseData?.course.exercises) {
                    return [];
                }

                const filtered = filterExercises(courseData.course.exercises, exerciseSearchTerm);
                return sortExercises(filtered, exerciseSortBy);
            },
        }),
        {
            name: 'CourseDetailStore',
            enabled: process.env.NODE_ENV === 'development',
        }
    )
);
