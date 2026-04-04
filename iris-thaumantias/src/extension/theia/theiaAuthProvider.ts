import type { AuthManager } from '../services/auth/authManager';
import type { TheiaEnvironment } from './types';

/**
 * Authenticates the extension using environment-provided credentials in Theia/EduIDE.
 *
 * Called during activation, before any UI is shown or interactive login is attempted.
 * The token is the raw JWT from the ARTEMIS_TOKEN env var.
 * Stored in memory only (persist=false) because ENV tokens are ephemeral.
 *
 * This follows the pattern established by Scorpio (Jandow 2024, Section 4.4.2).
 * The Theia token is generated server-side by Artemis from the user's web session
 * and has restricted scope (tools: "THEIA") with limited lifetime.
 */
export async function authenticateFromEnvironment(
    authManager: AuthManager,
    theiaEnv: TheiaEnvironment,
): Promise<{ authenticated: boolean }> {
    if (!theiaEnv.artemisToken || !theiaEnv.artemisUrl) {
        return { authenticated: false };
    }

    // Enable Bearer auth mode — Theia tokens are raw JWTs sent as Authorization: Bearer,
    // unlike Desktop which uses Cookie: jwt=<token>
    authManager.enableBearerAuth();

    // Store raw JWT in memory only — never persist ENV tokens to SecretStorage
    await authManager.storeArtemisCredentials(
        theiaEnv.artemisToken,
        theiaEnv.artemisUrl,
        false,
    );

    return { authenticated: true };
}
