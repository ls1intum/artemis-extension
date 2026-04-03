import type { VsCodeApi } from '../../../shared/messageContracts';

/**
 * Props for the LoginView component.
 */
export interface LoginViewProps {
	vscodeApi: VsCodeApi;
}

/**
 * Persisted state for the Login view.
 * Password is intentionally excluded — it is only needed for the single
 * authenticate request and must never be written to disk.
 */
export interface LoginPersistedState {
	username: string;
	rememberMe: boolean;
}

/**
 * Discriminated view state for the Login view.
 */
export type LoginViewState = 'form' | 'loading';
