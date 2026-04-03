import type { VsCodeApi } from '../../../shared/messageContracts';

export interface AiExtensionItem {
    id: string;
    name: string;
    publisher: string;
    version: string;
    description: string;
    isInstalled: boolean;
    provider: string;
    providerColor: string;
}

export interface AiConfigViewProps {
    vscodeApi: VsCodeApi;
}
