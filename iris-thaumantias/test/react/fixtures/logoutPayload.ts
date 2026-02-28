import type { LogoutSuccessMessage } from '../../../src/shared/messageContracts';

export function createLogoutPayload(): LogoutSuccessMessage {
    return {
        type: 'logoutSuccess',
    };
}
