import type { VsCodeApi } from '@shared/messageContracts';

export interface ServiceStatusViewProps {
    vscodeApi: VsCodeApi;
}

export interface HealthCheckResult {
    status: 'online' | 'offline' | 'unknown';
    message: string;
    endpoint: string;
    httpStatus: number | null;
    response: string | null;
}

/** Only serverUrl is durable; health results are transient and not persisted. */
export interface ServiceStatusPersistedState {
    serverUrl?: string;
}
