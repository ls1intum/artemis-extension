import { create } from 'zustand';

interface ExamStartState {
    studentExam: any;
    courseId: number | null;
    examId: number | null;
    loading: boolean;
    error: string | null;
}

interface ExamStartActions {
    setExamStartData: (payload: { studentExam: any; courseId: number; examId: number }) => void;
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

export const useExamStartStore = create<ExamStartState & ExamStartActions>((set) => ({
    ...initialState,

    setExamStartData: (payload) =>
        set({
            studentExam: payload.studentExam,
            courseId: payload.courseId,
            examId: payload.examId,
            loading: false,
            error: null,
        }),

    setLoading: (loading) => set({ loading }),

    setError: (error) => set({ error, loading: false }),

    reset: () => set(initialState),
}));
