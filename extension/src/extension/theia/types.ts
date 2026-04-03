/**
 * Immutable record describing the Theia/EduIDE environment.
 * Detected once during activation and passed through the service graph.
 * When `isTheia` is false, all other fields are undefined.
 */
export interface TheiaEnvironment {
    /** Whether the extension is running inside a Theia-based IDE (e.g. EduIDE). */
    readonly isTheia: boolean;
    /** Artemis server URL from ARTEMIS_URL environment variable. */
    readonly artemisUrl: string | undefined;
    /** Pre-authenticated JWT cookie string from ARTEMIS_TOKEN environment variable. */
    readonly artemisToken: string | undefined;
    /** Git clone URI from GIT_URI environment variable. */
    readonly gitUri: string | undefined;
    /** Git user name from GIT_USER environment variable. */
    readonly gitUser: string | undefined;
    /** Git user email from GIT_MAIL environment variable. */
    readonly gitMail: string | undefined;
    /**
     * True when all required environment variables for a managed Theia deployment
     * are present (ARTEMIS_URL + ARTEMIS_TOKEN). In managed mode, settings like
     * server URL are locked and interactive login is bypassed.
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

/** The VS Code environment — no Theia-specific features active. */
export const VSCODE_ENVIRONMENT: TheiaEnvironment = Object.freeze({
    isTheia: false,
    artemisUrl: undefined,
    artemisToken: undefined,
    gitUri: undefined,
    gitUser: undefined,
    gitMail: undefined,
    isManagedEnvironment: false,
});
