import type { GitCredentialsInitMessage } from '../../../src/shared/messageContracts';

export function createGitCredentialsPayload(
    overrides?: Partial<GitCredentialsInitMessage['payload']>,
): GitCredentialsInitMessage {
    return {
        type: 'gitCredentialsInit',
        payload: {
            currentName: 'Test User',
            currentEmail: 'test@example.com',
            ...overrides,
        },
    };
}
