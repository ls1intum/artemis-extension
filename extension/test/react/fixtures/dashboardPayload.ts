import type { ExtMsg } from '@shared/messageContracts';

export function createDashboardPayload(
    overrides?: Partial<Omit<ExtMsg<'dashboardInit'>, 'type'>>,
): ExtMsg<'dashboardInit'> {
    return {
        type: 'dashboardInit',
        courses: [],
        coursesUnavailable: false,
        workspaceExercise: undefined,
        hideDeveloperTools: false,
        ...overrides,
    };
}
