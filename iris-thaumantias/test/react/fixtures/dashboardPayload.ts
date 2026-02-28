import type { DashboardInitMessage } from '../../../src/shared/messageContracts';

export function createDashboardPayload(
    overrides?: Partial<DashboardInitMessage['payload']>,
): DashboardInitMessage {
    return {
        type: 'dashboardInit',
        payload: {
            courses: [],
            workspaceExercise: undefined,
            ...overrides,
        },
    };
}
