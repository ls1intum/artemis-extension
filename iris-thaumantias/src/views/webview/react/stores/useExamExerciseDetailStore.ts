import { createExamStore } from './createExamStore';
import type { StudentExam, ExerciseDetailsResponse } from '../../../../types/apiResponses';

interface ExamContext {
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
            exerciseData: ExerciseDetailsResponse;
            examContext: ExamContext;
            hideDeveloperTools: boolean;
        }) =>
            set({
                examContext: payload.examContext,
                isLoading: false,
                error: null,
            }, false, 'setExamExerciseData'),
    }),
);
