import type { VsCodeApi } from '@shared/messageContracts';

/**
 * Persisted via vscode.setState. Only form values are persisted, never the
 * transient status messages.
 */
export interface GitCredentialsPersistedState {
    name: string;
    email: string;
}

export interface GitCredentialsViewProps {
    vscodeApi: VsCodeApi;
}
