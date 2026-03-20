import { createExamStore } from './createExamStore';
import type { StudentExam } from '../../../types/apiResponses';

export const useExamStartStore = createExamStore(
    'ExamStartStore',
    {
        studentExam: null as StudentExam | null,
        courseId: null as number | null,
        examId: null as number | null,
    },
    (set) => ({
        setExamStartData: (payload: { studentExam: StudentExam; courseId: number; examId: number }) =>
            set({
                studentExam: payload.studentExam,
                courseId: payload.courseId,
                examId: payload.examId,
                isLoading: false,
                error: null,
            }, false, 'setExamStartData'),
    }),
);
