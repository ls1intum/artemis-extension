import type { AuthManager } from '@extension/services/auth/authManager';

import type { TheiaEnvironment } from './types';

/**
 * Authenticates the extension using bridge-provided credentials in Theia/EduIDE.
 *
 * Called during activation, before any UI is shown or interactive login is attempted.
 * The token is the raw JWT delivered by the EduIDE data-bridge, issued by Artemis
 * from the student's web session as a tool token (currently `tools: "SCORPIO"`,
 * see ls1intum/Artemis#12394 for the upcoming `ARTEMIS_EXTENSION` variant) and
 * capped at one day of validity.
 *
 * Stored in memory only (`persist=false`) because the token is ephemeral and the
 * bridge re-delivers it on every session boot.
 *
 * This follows the pattern established by Scorpio (Jandow 2024, Section 4.4.2).
 */
export async function authenticateFromEnvironment(
    authManager: AuthManager,
    theiaEnv: TheiaEnvironment,
): Promise<{ authenticated: boolean }> {
    if (!theiaEnv.artemisToken || !theiaEnv.artemisUrl) {
        return { authenticated: false };
    }

    // Theia tokens are raw JWTs sent as `Authorization: Bearer`, unlike Desktop
    // which uses `Cookie: jwt=<token>`.
    authManager.enableBearerAuth();

    // In memory only: ENV tokens must never reach SecretStorage.
    await authManager.storeArtemisCredentials(
        theiaEnv.artemisToken,
        false,
    );

    return { authenticated: true };
}
