import type { ExtMsg } from '../../../src/shared/messageContracts';

export function createGenericInitPayload(
    view: string,
    overrides?: Record<string, unknown>,
): ExtMsg<'init'> {
    return {
        type: 'init',
        view,
        payload: { ...overrides },
    };
}
