import type { GitCredentialsInitMessage } from '../../../src/shared/messageContracts';

export function createGitCredentialsPayload(
    overrides?: Partial<Omit<GitCredentialsInitMessage, 'type'>>,
): GitCredentialsInitMessage {
    return {
        type: 'gitCredentialsInit',
        currentName: 'Test User',
        currentEmail: 'test@example.com',
        ...overrides,
    };
}
