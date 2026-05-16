import { createExamStore } from './createExamStore';
import type { StudentExam } from '@shared/types/apiResponses';

export const useExamConductionStore = createExamStore(
    'ExamConductionStore',
    {
        studentExam: null as StudentExam | null,
        courseId: null as number | null,
        examId: null as number | null,
        endTime: null as number | null,
        startTime: null as number | null,
        totalDuration: null as number | null,
        workspaceExerciseId: null as number | null,
    },
    (set) => ({
        setExamData: (payload: {
            studentExam: StudentExam;
            courseId: number;
            examId: number;
            endTime: number;
            startTime: number;
            totalDuration: number;
            workspaceExerciseId: number | null;
        }) =>
            set({
                studentExam: payload.studentExam,
                courseId: payload.courseId,
                examId: payload.examId,
                endTime: payload.endTime,
                startTime: payload.startTime,
                totalDuration: payload.totalDuration,
                workspaceExerciseId: payload.workspaceExerciseId,
                isLoading: false,
                error: null,
            }, false, 'setExamData'),
    }),
);
