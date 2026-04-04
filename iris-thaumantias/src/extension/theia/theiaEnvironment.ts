import * as vscode from 'vscode';
import { readEnvVars } from './envVarReader';
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
 * Detection uses functional prerequisites (presence of specific env vars)
 * combined with a secondary UI-kind check to prevent false positives when
 * a developer accidentally has ARTEMIS_URL in their shell profile.
 *
 * This function is async because env var reading may require exec() in
 * Theia environments where process.env is unreliable.
 */
async function detectTheiaEnvironment(): Promise<TheiaEnvironment> {
    // Try data-bridge first (EduIDE cloud deployments with late-arriving credentials).
    // Returns undefined immediately if data-bridge extension is not installed (no overhead).
    // Falls back to process env if data-bridge is unavailable or times out.
    const env = await readEnvVarsViaDataBridge(THEIA_ENV_VARS)
        ?? await readEnvVars(THEIA_ENV_VARS);

    const hasTheiaEnvVars = !!(env.ARTEMIS_TOKEN || env.ARTEMIS_URL);
    const isWebUI = vscode.env.uiKind === vscode.UIKind.Web;
    const dataBridgeEnabled = process.env.DATA_BRIDGE_ENABLED === '1'
        || process.env.DATA_BRIDGE_ENABLED === 'true';

    // Env vars alone in Desktop mode are likely accidental (e.g., shell profile).
    // Require either a web UI host (Theia) or the DATA_BRIDGE_ENABLED flag
    // (set by the EduIDE container orchestrator at boot).
    const isTheia = hasTheiaEnvVars && (isWebUI || dataBridgeEnabled);

    if (!isTheia) {
        return VSCODE_ENVIRONMENT;
    }

    // Managed environment requires both URL and token for full automation
    const isManagedEnvironment = !!(env.ARTEMIS_URL && env.ARTEMIS_TOKEN);

    return Object.freeze({
        isTheia: true,
        artemisUrl: env.ARTEMIS_URL,
        artemisToken: env.ARTEMIS_TOKEN,
        gitUri: env.GIT_URI,
        gitUser: env.GIT_USER,
        gitMail: env.GIT_MAIL,
        isManagedEnvironment,
    });
}
