import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import type { StudentExam } from '../../../../types/apiResponses';

interface ExamConductionState {
    studentExam: StudentExam | null;
    courseId: number | null;
    examId: number | null;
    endTime: number | null;
    startTime: number | null;
    totalDuration: number | null;
    workspaceExerciseId: number | null;
    loading: boolean;
    error: string | null;
}

interface ExamConductionActions {
    setExamData: (payload: {
        studentExam: StudentExam;
        courseId: number;
        examId: number;
        endTime: number;
        startTime: number;
        totalDuration: number;
        workspaceExerciseId: number | null;
    }) => void;
    setLoading: (loading: boolean) => void;
    setError: (error: string | null) => void;
    reset: () => void;
}

type ExamConductionStore = ExamConductionState & ExamConductionActions;

const initialState: ExamConductionState = {
    studentExam: null,
    courseId: null,
    examId: null,
    endTime: null,
    startTime: null,
    totalDuration: null,
    workspaceExerciseId: null,
    loading: true,
    error: null,
};

export const useExamConductionStore = create<ExamConductionStore>()(
    devtools(
        (set) => ({
            ...initialState,

            setExamData: (payload) => {
                set({
                    studentExam: payload.studentExam,
                    courseId: payload.courseId,
                    examId: payload.examId,
                    endTime: payload.endTime,
                    startTime: payload.startTime,
                    totalDuration: payload.totalDuration,
                    workspaceExerciseId: payload.workspaceExerciseId,
                    loading: false,
                    error: null,
                }, false, 'setExamData');
            },

            setLoading: (loading) => set({ loading }, false, 'setLoading'),

            setError: (error) => set({ error, loading: false }, false, 'setError'),

            reset: () => set(initialState, false, 'reset'),
        }),
        {
            name: 'ExamConductionStore',
            enabled: process.env.NODE_ENV === 'development',
        }
    )
);
