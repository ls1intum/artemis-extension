import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import type { VsCodeApi, CourseDetailData, Exam, Exercise } from '../../../../shared/messageContracts';
import type { ExerciseDetail } from '../../../../types/apiResponses';

interface CourseDetailState {
    courseData: CourseDetailData | null;
    workspaceExerciseId: number | null;
    isLoading: boolean;
    error: string | null;
    exerciseSearchTerm: string;
    exerciseSortBy: string;

    // Actions
    setCourseData: (data: CourseDetailData, workspaceExerciseId?: number | null) => void;
    setLoading: (loading: boolean) => void;
    setError: (error: string | null) => void;
    setExerciseSearchTerm: (term: string) => void;
    setExerciseSortBy: (sort: string) => void;
    loadCourseDetail: (vscodeApi: VsCodeApi, courseId?: number) => void;

    // Derived
    filteredExercises: () => Exercise[];
    sortedExams: () => Exam[];
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
            return sorted.sort((a, b) => {
                // Exercise may have maxPoints from ExerciseDetail index signature
                const aExercise = a as Exercise & { maxPoints?: number };
                const bExercise = b as Exercise & { maxPoints?: number };
                const aPoints = aExercise.maxPoints ?? 0;
                const bPoints = bExercise.maxPoints ?? 0;
                return aPoints - bPoints;
            });
        case 'points-desc':
            return sorted.sort((a, b) => {
                // Exercise may have maxPoints from ExerciseDetail index signature
                const aExercise = a as Exercise & { maxPoints?: number };
                const bExercise = b as Exercise & { maxPoints?: number };
                const aPoints = aExercise.maxPoints ?? 0;
                const bPoints = bExercise.maxPoints ?? 0;
                return bPoints - aPoints;
            });
        default:
            return sorted;
    }
}

/**
 * Sort exams by status: active first, then upcoming, then finished.
 */
function sortExams(exams: Exam[]): Exam[] {
    const now = new Date().getTime();

    return [...exams].sort((a, b) => {
        // Calculate status for exam a
        const aStart = a.startDate ? new Date(a.startDate).getTime() : 0;
        const aEnd = a.endDate ? new Date(a.endDate).getTime() : 0;
        const aIsActive = now >= aStart && now <= aEnd;
        const aIsUpcoming = now < aStart;

        // Calculate status for exam b
        const bStart = b.startDate ? new Date(b.startDate).getTime() : 0;
        const bEnd = b.endDate ? new Date(b.endDate).getTime() : 0;
        const bIsActive = now >= bStart && now <= bEnd;
        const bIsUpcoming = now < bStart;

        // Priority: Active > Upcoming > Finished
        if (aIsActive && !bIsActive) {
            return -1;
        }
        if (!aIsActive && bIsActive) {
            return 1;
        }
        if (aIsUpcoming && !bIsUpcoming && !bIsActive) {
            return -1;
        }
        if (!aIsUpcoming && bIsUpcoming && !aIsActive) {
            return 1;
        }

        return 0;
    });
}

export const useCourseDetailStore = create<CourseDetailState>()(
    devtools(
        (set, get) => ({
            courseData: null,
            workspaceExerciseId: null,
            isLoading: false,
            error: null,
            exerciseSearchTerm: '',
            exerciseSortBy: 'id-desc',

            setCourseData: (data, workspaceExerciseId) => {
                set({
                    courseData: data,
                    workspaceExerciseId: workspaceExerciseId ?? null,
                    isLoading: false,
                    error: null,
                }, false, 'setCourseData');
            },

            setLoading: (loading) => {
                set({ isLoading: loading }, false, 'setLoading');
            },

            setError: (error) => {
                set({ error, isLoading: false }, false, 'setError');
            },

            setExerciseSearchTerm: (term) => {
                set({ exerciseSearchTerm: term }, false, 'setExerciseSearchTerm');
            },

            setExerciseSortBy: (sort) => {
                set({ exerciseSortBy: sort }, false, 'setExerciseSortBy');
            },

            loadCourseDetail: (vscodeApi, courseId) => {
                set({ isLoading: true, error: null }, false, 'loadCourseDetail');
                vscodeApi.postMessage({
                    type: 'command',
                    command: 'reloadCourseDetail',
                    payload: { courseId: courseId || 0 },
                });
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

            sortedExams: () => {
                const state = get();
                const { courseData } = state;

                if (!courseData?.course.exams) {
                    return [];
                }

                return sortExams(courseData.course.exams);
            },
        }),
        {
            name: 'CourseDetailStore',
            enabled: process.env.NODE_ENV === 'development',
        }
    )
);
