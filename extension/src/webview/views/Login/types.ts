import type { VsCodeApi } from '@shared/messageContracts';

export interface LoginViewProps {
	vscodeApi: VsCodeApi;
}

/**
 * Persisted state for the Login view. The password is deliberately excluded:
 * it is only needed for the single authenticate request and must never be
 * written to disk.
 */
export interface LoginPersistedState {
	username: string;
	rememberMe: boolean;
}
