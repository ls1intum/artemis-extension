import type { ExamStartInitMessage } from '../../../src/shared/messageContracts';

export function createExamStartPayload(
    overrides?: Partial<ExamStartInitMessage['payload']>,
): ExamStartInitMessage {
    return {
        type: 'examStartInit',
        payload: {
            studentExam: { id: 1 },
            courseId: 1,
            examId: 1,
            ...overrides,
        },
    };
}
