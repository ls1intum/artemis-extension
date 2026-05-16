import type { ExtMsg } from '@shared/messageContracts';

export function createExamExerciseDetailPayload(
    overrides?: Partial<Omit<ExtMsg<'examExerciseDetailInit'>, 'type'>>,
): ExtMsg<'examExerciseDetailInit'> {
    const now = Date.now();
    return {
        type: 'examExerciseDetailInit',
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
    };
}
