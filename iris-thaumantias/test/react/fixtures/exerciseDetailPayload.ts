import type { ExerciseDetailInitMessage } from '../../../src/shared/messageContracts';

export function createExerciseDetailPayload(
    overrides?: Partial<ExerciseDetailInitMessage['payload']>,
): ExerciseDetailInitMessage {
    return {
        type: 'exerciseDetailInit',
        payload: {
            exerciseData: { exercise: { id: 1, title: 'Test Exercise' } },
            hideDeveloperTools: false,
            ...overrides,
        },
    };
}
