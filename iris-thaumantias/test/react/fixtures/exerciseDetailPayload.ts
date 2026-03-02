import type { ExerciseDetailInitMessage } from '../../../src/shared/messageContracts';

export function createExerciseDetailPayload(
    overrides?: Partial<Omit<ExerciseDetailInitMessage, 'type'>>,
): ExerciseDetailInitMessage {
    return {
        type: 'exerciseDetailInit',
        exerciseData: { exercise: { id: 1, title: 'Test Exercise' } },
        hideDeveloperTools: false,
        ...overrides,
    };
}
