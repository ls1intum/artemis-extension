import { createExamStore } from './createExamStore';
import type { StudentExam } from '@shared/types/apiResponses';

export interface ExamContext {
    courseId: number | null;
    examId: number | null;
    studentExam: StudentExam;
    endTime: number;
    startTime: number;
    totalDuration: number;
}

export const useExamExerciseDetailStore = createExamStore(
    'ExamExerciseDetailStore',
    {
        examContext: null as ExamContext | null,
    },
    (set) => ({
        setExamExerciseData: (payload: {
            examContext: ExamContext;
        }) =>
            set({
                examContext: payload.examContext,
                isLoading: false,
                error: null,
            }, false, 'setExamExerciseData'),
    }),
);
