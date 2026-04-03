import type { ExtMsg } from '../../../src/shared/messageContracts';

export function createExamConductionPayload(
    overrides?: Partial<Omit<ExtMsg<'examConductionInit'>, 'type'>>,
): ExtMsg<'examConductionInit'> {
    const now = Date.now();
    return {
        type: 'examConductionInit',
        studentExam: { id: 1 },
        courseId: 1,
        examId: 1,
        endTime: now + 3_600_000,
        startTime: now,
        totalDuration: 3600,
        workspaceExerciseId: null,
        ...overrides,
    };
}
