import type { ExtMsg } from '../../../src/shared/messageContracts';

export function createServiceStatusPayload(
    overrides?: Partial<Omit<ExtMsg<'serviceStatusInit'>, 'type'>>,
): ExtMsg<'serviceStatusInit'> {
    return {
        type: 'serviceStatusInit',
        serverUrl: 'https://artemis.example.com',
        ...overrides,
    };
}
