import type { ExamExerciseDetailInitMessage } from '../../../src/shared/messageContracts';

export function createExamExerciseDetailPayload(
    overrides?: Partial<ExamExerciseDetailInitMessage['payload']>,
): ExamExerciseDetailInitMessage {
    const now = Date.now();
    return {
        type: 'examExerciseDetailInit',
        payload: {
            exerciseData: { exercise: { id: 1, title: 'Exam Exercise' } },
            examContext: {
                courseId: 1,
                examId: 1,
                studentExam: { id: 1 },
                endTime: now + 3_600_000,
                startTime: now,
                totalDuration: 3600,
            },
            hideDeveloperTools: false,
            ...overrides,
        },
    };
}
