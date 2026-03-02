import type { RecommendedExtensionsInitMessage } from '../../../src/shared/messageContracts';

export function createRecommendedExtensionsPayload(
    overrides?: Partial<Omit<RecommendedExtensionsInitMessage, 'type'>>,
): RecommendedExtensionsInitMessage {
    return {
        type: 'recommendedExtensionsInit',
        categories: [],
        ...overrides,
    };
}
