import type { ExtMsg } from '@shared/messageContracts';

export function createRecommendedExtensionsPayload(
    overrides?: Partial<Omit<ExtMsg<'recommendedExtensionsInit'>, 'type'>>,
): ExtMsg<'recommendedExtensionsInit'> {
    return {
        type: 'recommendedExtensionsInit',
        categories: [],
        ...overrides,
    };
}
