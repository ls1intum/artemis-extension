import type { ExtMsg } from '../../../src/shared/messageContracts';

export function createLogoutPayload(): ExtMsg<'logoutSuccess'> {
    return {
        type: 'logoutSuccess',
    };
}
