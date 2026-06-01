import type { ExtMsg } from '@shared/messageContracts';

export function createExerciseDetailPayload(
    overrides?: Partial<Omit<ExtMsg<'exerciseDetailInit'>, 'type'>>,
): ExtMsg<'exerciseDetailInit'> {
    return {
        type: 'exerciseDetailInit',
        exerciseData: { exercise: { id: 1, title: 'Test Exercise' } },
        hideDeveloperTools: false,
        ...overrides,
    };
}
