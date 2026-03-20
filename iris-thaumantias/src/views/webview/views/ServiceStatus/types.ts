import type { VsCodeApi } from '../../../../shared/messageContracts';

/**
 * Props for the ServiceStatusView component.
 */
export interface ServiceStatusViewProps {
    vscodeApi: VsCodeApi;
}

/**
 * Health check result for a single service.
 */
export interface HealthCheckResult {
    status: 'online' | 'offline' | 'unknown';
    message: string;
    endpoint: string;
    httpStatus: number | null;
    response: string | null;
}

/**
 * Persisted state for ServiceStatus view.
 * Only persist serverUrl (durable). Health results are transient.
 */
export interface ServiceStatusPersistedState {
    serverUrl?: string;
}
