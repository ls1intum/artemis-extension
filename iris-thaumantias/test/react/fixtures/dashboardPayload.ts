import type { DashboardInitMessage } from '../../../src/shared/messageContracts';

export function createDashboardPayload(
    overrides?: Partial<Omit<DashboardInitMessage, 'type'>>,
): DashboardInitMessage {
    return {
        type: 'dashboardInit',
        courses: [],
        workspaceExercise: undefined,
        ...overrides,
    };
}
