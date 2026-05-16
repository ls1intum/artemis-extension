import type { ExtMsg } from '@shared/messageContracts';

export function createExamStartPayload(
    overrides?: Partial<Omit<ExtMsg<'examStartInit'>, 'type'>>,
): ExtMsg<'examStartInit'> {
    return {
        type: 'examStartInit',
        studentExam: { id: 1 },
        courseId: 1,
        examId: 1,
        ...overrides,
    };
}
