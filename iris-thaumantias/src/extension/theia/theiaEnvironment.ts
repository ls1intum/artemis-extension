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

/**
 * Detects whether the extension is running inside a Theia-based IDE
 * and reads all relevant environment variables.
 *
 * Detection uses functional prerequisites (presence of specific env vars)
 * rather than a single flag, following the pattern established by Scorpio
 * after their experience with fragile flag-based detection (Issue #124).
 *
 * This function is async because env var reading may require exec() in
 * Theia environments where process.env is unreliable.
 *
 * Must be called before any service instantiation in activate().
 */
export async function detectTheiaEnvironment(): Promise<TheiaEnvironment> {
    // Try data-bridge first (EduIDE cloud deployments with late-arriving credentials).
    // Returns undefined immediately if data-bridge extension is not installed (no overhead).
    // Falls back to process env if data-bridge is unavailable or times out.
    const env = await readEnvVarsViaDataBridge(THEIA_ENV_VARS)
        ?? await readEnvVars(THEIA_ENV_VARS);

    // Theia is detected when at least one Theia-specific env var is present.
    // ARTEMIS_TOKEN alone is sufficient (minimal Theia setup),
    // ARTEMIS_URL alone is also sufficient (URL-only config).
    const isTheia = !!(env.ARTEMIS_TOKEN || env.ARTEMIS_URL);

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
