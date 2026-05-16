import type { VsCodeApi } from '@shared/messageContracts';

/**
 * Individual extension metadata.
 */
export interface Extension {
    id: string;
    name: string;
    publisher: string;
    version?: string;
    description: string;
    reason: string;
    optional?: boolean;
    isInstalled: boolean;
}

/**
 * Extension category grouping related extensions.
 */
export interface ExtensionCategory {
    id: string;
    name: string;
    description: string;
    extensions: Extension[];
}

/**
 * Props for RecommendedExtensionsView component.
 */
export interface RecommendedExtensionsViewProps {
    vscodeApi: VsCodeApi;
}

/**
 * State persisted across tab hide/show cycles.
 * Only includes durable UI state (category filter selection).
 */
export interface RecommendedExtensionsPersistedState {
    selectedCategory: string;
}
