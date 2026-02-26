import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import type { StudentExam } from '../../../../types/apiResponses';

interface ExamStartState {
    studentExam: StudentExam | null;
    courseId: number | null;
    examId: number | null;
    loading: boolean;
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
    loading: true,
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
                    loading: false,
                    error: null,
                }, false, 'setExamStartData'),

            setLoading: (loading) => set({ loading }, false, 'setLoading'),

            setError: (error) => set({ error, loading: false }, false, 'setError'),

            reset: () => set(initialState, false, 'reset'),
        }),
        {
            name: 'ExamStartStore',
            enabled: process.env.NODE_ENV === 'development',
        }
    )
);
