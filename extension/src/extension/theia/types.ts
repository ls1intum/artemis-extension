/**
 * Immutable record describing the Theia/EduIDE environment.
 * Populated once during activation from the values delivered by the EduIDE
 * data-bridge (`dataBridge.getEnv`) and passed through the service graph.
 * When `isTheia` is false, all other fields are undefined.
 */
export interface TheiaEnvironment {
    /** Whether the extension is running inside a Theia-based IDE (e.g. EduIDE). */
    readonly isTheia: boolean;
    /** Artemis server URL (bridge key `ARTEMIS_URL`). */
    readonly artemisUrl: string | undefined;
    /**
     * Raw JWT issued by Artemis as a tool token (bridge key `ARTEMIS_TOKEN`),
     * sent as `Authorization: Bearer` on outgoing requests in Theia mode.
     */
    readonly artemisToken: string | undefined;
    /**
     * True when both `ARTEMIS_URL` and `ARTEMIS_TOKEN` arrived through the
     * bridge, i.e. the deployment is fully managed. In managed mode,
     * settings like server URL are locked and interactive login is bypassed.
     */
    readonly isManagedEnvironment: boolean;
}

/**
 * Runtime capability probes for APIs that may not be available in all environments.
 * Detected once during activation.
 */
export interface PlatformCapabilities {
    /** Whether `vscode.window.onDidStartTerminalShellExecution` is available. */
    readonly hasTerminalShellExecution: boolean;
    /** Whether the built-in `vscode.git` extension is installed and loadable. */
    readonly hasVscodeGitExtension: boolean;
}

/** The VS Code environment, with no Theia-specific features active. */
export const VSCODE_ENVIRONMENT: TheiaEnvironment = Object.freeze({
    isTheia: false,
    artemisUrl: undefined,
    artemisToken: undefined,
    isManagedEnvironment: false,
});
