import type { GenericInitMessage } from '../../../src/shared/messageContracts';

export function createGenericInitPayload(
    view: string,
    overrides?: Record<string, unknown>,
): GenericInitMessage {
    return {
        type: 'init',
        view,
        payload: { ...overrides },
    };
}
