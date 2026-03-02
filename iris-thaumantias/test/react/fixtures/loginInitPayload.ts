import type { ExtMsg } from '../../../src/shared/messageContracts';

export function createLoginInitPayload(
    overrides?: Partial<Omit<ExtMsg<'showLoggedIn'>, 'type'>>,
): ExtMsg<'showLoggedIn'> {
    return {
        type: 'showLoggedIn',
        userInfo: {
            username: 'testuser',
            serverUrl: 'https://artemis.example.com',
        },
        ...overrides,
    };
}
