import type { ExamConductionInitMessage } from '../../../src/shared/messageContracts';

export function createExamConductionPayload(
    overrides?: Partial<ExamConductionInitMessage['payload']>,
): ExamConductionInitMessage {
    const now = Date.now();
    return {
        type: 'examConductionInit',
        payload: {
            studentExam: { id: 1 },
            courseId: 1,
            examId: 1,
            endTime: now + 3_600_000,
            startTime: now,
            totalDuration: 3600,
            workspaceExerciseId: null,
            ...overrides,
        },
    };
}
