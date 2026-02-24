import { create } from 'zustand';

interface ExamContext {
    courseId: number | null;
    examId: number | null;
    studentExam: any;
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
        exerciseData: any;
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

export const useExamExerciseDetailStore = create<ExamExerciseDetailState & ExamExerciseDetailActions>(
    (set) => ({
        ...initialState,

        setExamExerciseData: (payload) =>
            set({
                examContext: payload.examContext,
                loading: false,
                error: null,
            }),

        setLoading: (loading) => set({ loading }),

        setError: (error) => set({ error, loading: false }),
    })
);
