import type { RecommendedExtensionsInitMessage } from '../../../src/shared/messageContracts';

export function createRecommendedExtensionsPayload(
    overrides?: Partial<RecommendedExtensionsInitMessage['payload']>,
): RecommendedExtensionsInitMessage {
    return {
        type: 'recommendedExtensionsInit',
        payload: {
            categories: [],
            ...overrides,
        },
    };
}
