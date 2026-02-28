import type { ServiceStatusInitMessage } from '../../../src/shared/messageContracts';

export function createServiceStatusPayload(
    overrides?: Partial<ServiceStatusInitMessage['payload']>,
): ServiceStatusInitMessage {
    return {
        type: 'serviceStatusInit',
        payload: {
            serverUrl: 'https://artemis.example.com',
            ...overrides,
        },
    };
}
