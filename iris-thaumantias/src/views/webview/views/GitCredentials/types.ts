/**
 * Type definitions for GitCredentials view.
 */

import type { VsCodeApi } from '../../../../shared/messageContracts';

/**
 * Persisted state for GitCredentials view (saved via vscode.setState).
 * Only form values are persisted - transient status messages are not.
 */
export interface GitCredentialsPersistedState {
    name: string;
    email: string;
}

/**
 * Props for GitCredentialsView component.
 */
export interface GitCredentialsViewProps {
    vscodeApi: VsCodeApi;
}
