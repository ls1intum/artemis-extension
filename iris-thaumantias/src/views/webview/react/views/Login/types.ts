import type { VsCodeApi } from '../../../../../shared/messageContracts';

/**
 * Props for the LoginView component.
 */
export interface LoginViewProps {
	vscodeApi: VsCodeApi;
}

/**
 * Persisted state for the Login view.
 * ALL form values are persisted per user decision.
 */
export interface LoginPersistedState {
	username: string;
	password: string;
	rememberMe: boolean;
}

/**
 * Discriminated view state for the Login view.
 */
export type LoginViewState = 'form' | 'loading' | 'loggedIn';

/**
 * User info for logged-in state.
 */
export interface UserInfo {
	username: string;
	serverUrl: string;
}
