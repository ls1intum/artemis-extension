import type { ExtMsg } from '../../../src/shared/messageContracts';

export function createDashboardPayload(
    overrides?: Partial<Omit<ExtMsg<'dashboardInit'>, 'type'>>,
): ExtMsg<'dashboardInit'> {
    return {
        type: 'dashboardInit',
        courses: [],
        workspaceExercise: undefined,
        ...overrides,
    };
}
