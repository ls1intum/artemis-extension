import type { VsCodeApi } from '@shared/messageContracts';

export interface ServiceStatusViewProps {
    vscodeApi: VsCodeApi;
}

export type { HealthCheckResult } from '@shared/messageContracts';

/** Only serverUrl is durable; health results are transient and not persisted. */
export interface ServiceStatusPersistedState {
    serverUrl?: string;
}
