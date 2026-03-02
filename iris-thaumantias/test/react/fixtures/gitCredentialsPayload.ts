import type { ExtMsg } from '../../../src/shared/messageContracts';

export function createGitCredentialsPayload(
    overrides?: Partial<Omit<ExtMsg<'gitCredentialsInit'>, 'type'>>,
): ExtMsg<'gitCredentialsInit'> {
    return {
        type: 'gitCredentialsInit',
        currentName: 'Test User',
        currentEmail: 'test@example.com',
        ...overrides,
    };
}
