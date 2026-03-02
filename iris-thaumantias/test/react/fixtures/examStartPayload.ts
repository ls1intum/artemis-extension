import type { ExamStartInitMessage } from '../../../src/shared/messageContracts';

export function createExamStartPayload(
    overrides?: Partial<Omit<ExamStartInitMessage, 'type'>>,
): ExamStartInitMessage {
    return {
        type: 'examStartInit',
        studentExam: { id: 1 },
        courseId: 1,
        examId: 1,
        ...overrides,
    };
}
