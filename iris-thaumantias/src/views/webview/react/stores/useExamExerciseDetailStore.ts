import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import type { StudentExam, ExerciseDetailsResponse } from '../../../../types/apiResponses';

interface ExamContext {
    courseId: number | null;
    examId: number | null;
    studentExam: StudentExam;
    endTime: number;
    startTime: number;
    totalDuration: number;
}

interface ExamExerciseDetailState {
    examContext: ExamContext | null;
    loading: boolean;
    error: string | null;
}

interface ExamExerciseDetailActions {
    setExamExerciseData: (payload: {
        exerciseData: ExerciseDetailsResponse;
        examContext: ExamContext;
        hideDeveloperTools: boolean;
    }) => void;
    setLoading: (loading: boolean) => void;
    setError: (error: string | null) => void;
}

const initialState: ExamExerciseDetailState = {
    examContext: null,
    loading: true,
    error: null,
};

export const useExamExerciseDetailStore = create<ExamExerciseDetailState & ExamExerciseDetailActions>()(
    devtools(
        (set) => ({
            ...initialState,

            setExamExerciseData: (payload) =>
                set({
                    examContext: payload.examContext,
                    loading: false,
                    error: null,
                }, false, 'setExamExerciseData'),

            setLoading: (loading) => set({ loading }, false, 'setLoading'),

            setError: (error) => set({ error, loading: false }, false, 'setError'),
        }),
        {
            name: 'ExamExerciseDetailStore',
            enabled: process.env.NODE_ENV === 'development',
        }
    )
);
