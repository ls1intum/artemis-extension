import { readEnvVarsViaDataBridge } from './dataBridgeReader';
import { VSCODE_ENVIRONMENT, type TheiaEnvironment } from './types';

/**
 * Environment variable names used for Theia/EduIDE integration.
 * These are set by the EduIDE container orchestrator before extension activation.
 */
const THEIA_ENV_VARS = [
    'ARTEMIS_URL',
    'ARTEMIS_TOKEN',
    'GIT_URI',
    'GIT_USER',
    'GIT_MAIL',
] as const;

// ── Module-level singleton ──────────────────────────────────────────
// Initialized once during activate() via initializeTheiaContext().
// All services read the environment through getTheiaEnvironment() instead
// of receiving it as a constructor parameter — this prevents the footgun
// where a caller forgets to pass theiaEnv and silently falls back to defaults.
let _theiaEnv: TheiaEnvironment = VSCODE_ENVIRONMENT;

/**
 * Initializes the Theia context singleton. Must be called exactly once
 * during activate(), before any service instantiation.
 * Returns the detected environment for callers that need it inline.
 */
export async function initializeTheiaContext(): Promise<TheiaEnvironment> {
    _theiaEnv = await detectTheiaEnvironment();
    return _theiaEnv;
}

/**
 * Returns the current TheiaEnvironment. Safe to call after
 * initializeTheiaContext() has completed.
 */
export function getTheiaEnvironment(): TheiaEnvironment {
    return _theiaEnv;
}

/**
 * Detects whether the extension is running inside a Theia-based IDE
 * and reads all relevant environment variables.
 *
 * The data-bridge is the sole source of truth: in EduIDE deployments the
 * orchestrator POSTs credentials into the bridge after pod boot, and the
 * bridge command is only registered when its activation gate
 * (`DATA_BRIDGE_ENABLED=1`) is set. On regular VS Code Desktop neither is
 * true, so the call returns undefined and detection cleanly resolves to
 * the non-Theia default.
 */
async function detectTheiaEnvironment(): Promise<TheiaEnvironment> {
    const env = await readEnvVarsViaDataBridge(THEIA_ENV_VARS);

    if (!env || !(env.ARTEMIS_TOKEN || env.ARTEMIS_URL)) {
        return VSCODE_ENVIRONMENT;
    }

    return Object.freeze({
        isTheia: true,
        artemisUrl: env.ARTEMIS_URL,
        artemisToken: env.ARTEMIS_TOKEN,
        gitUri: env.GIT_URI,
        gitUser: env.GIT_USER,
        gitMail: env.GIT_MAIL,
        isManagedEnvironment: !!(env.ARTEMIS_URL && env.ARTEMIS_TOKEN),
    });
}
