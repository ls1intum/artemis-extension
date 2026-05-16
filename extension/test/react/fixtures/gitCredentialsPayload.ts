import type { ExtMsg } from '@shared/messageContracts';

export function createGitCredentialsPayload(
    overrides?: Partial<Omit<ExtMsg<'gitIdentityInfo'>, 'type'>>,
): ExtMsg<'gitIdentityInfo'> {
    return {
        type: 'gitIdentityInfo',
        name: 'Test User',
        email: 'test@example.com',
        ...overrides,
    };
}
