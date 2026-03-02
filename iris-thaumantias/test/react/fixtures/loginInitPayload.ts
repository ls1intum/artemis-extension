import type { ShowLoggedInMessage } from '../../../src/shared/messageContracts';

export function createLoginInitPayload(
    overrides?: Partial<Omit<ShowLoggedInMessage, 'type'>>,
): ShowLoggedInMessage {
    return {
        type: 'showLoggedIn',
        userInfo: {
            username: 'testuser',
            serverUrl: 'https://artemis.example.com',
        },
        ...overrides,
    };
}
