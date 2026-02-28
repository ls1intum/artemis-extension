import type { ShowLoggedInMessage } from '../../../src/shared/messageContracts';

export function createLoginInitPayload(
    overrides?: Partial<ShowLoggedInMessage['payload']>,
): ShowLoggedInMessage {
    return {
        type: 'showLoggedIn',
        payload: {
            userInfo: {
                username: 'testuser',
                serverUrl: 'https://artemis.example.com',
            },
            ...overrides,
        },
    };
}
