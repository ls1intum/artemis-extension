import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import type { StudentExam } from '../../../../types/apiResponses';

interface ExamStartState {
    studentExam: StudentExam | null;
    courseId: number | null;
    examId: number | null;
    isLoading: boolean;
    error: string | null;
}

interface ExamStartActions {
    setExamStartData: (payload: { studentExam: StudentExam; courseId: number; examId: number }) => void;
    setLoading: (loading: boolean) => void;
    setError: (error: string | null) => void;
    reset: () => void;
}

const initialState: ExamStartState = {
    studentExam: null,
    courseId: null,
    examId: null,
    isLoading: true,
    error: null,
};

export const useExamStartStore = create<ExamStartState & ExamStartActions>()(
    devtools(
        (set) => ({
            ...initialState,

            setExamStartData: (payload) =>
                set({
                    studentExam: payload.studentExam,
                    courseId: payload.courseId,
                    examId: payload.examId,
                    isLoading: false,
                    error: null,
                }, false, 'setExamStartData'),

            setLoading: (loading) => set({ isLoading: loading }, false, 'setLoading'),

            setError: (error) => set({ error, isLoading: false }, false, 'setError'),

            reset: () => set(initialState, false, 'reset'),
        }),
        {
            name: 'ExamStartStore',
            enabled: process.env.NODE_ENV === 'development',
        }
    )
);
