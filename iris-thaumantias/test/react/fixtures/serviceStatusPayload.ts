import type { ServiceStatusInitMessage } from '../../../src/shared/messageContracts';

export function createServiceStatusPayload(
    overrides?: Partial<Omit<ServiceStatusInitMessage, 'type'>>,
): ServiceStatusInitMessage {
    return {
        type: 'serviceStatusInit',
        serverUrl: 'https://artemis.example.com',
        ...overrides,
    };
}
