import { generateEphemeralSecret } from './cookieSign';

export interface StartupTokens {
    liveToken: string | undefined;
    researcherToken: string | undefined;
}

/**
 * Validate at startup: if both tokens are configured, they must differ.
 * The dual-undefined case is allowed (no auth configured at all; the server
 * binds to localhost in that mode).
 */
export function validateStartupConfig(tokens: StartupTokens): void {
    if (tokens.liveToken && tokens.researcherToken && tokens.liveToken === tokens.researcherToken) {
        throw new Error(
            'RECORDING_VIEWER_TOKEN and RECORDING_VIEWER_RESEARCHER_TOKEN must not be identical; ' +
            'the server cannot distinguish rater from researcher.',
        );
    }
}

/**
 * Resolve the HMAC session secret. If unset/empty, generate an ephemeral
 * one and emit a loud warning via the provided sink. Sessions signed with
 * an ephemeral secret won't survive a server restart, which is acceptable
 * for ad-hoc study sessions but documented.
 */
export function resolveSessionSecret(envValue: string | undefined, warn: (msg: string) => void): string {
    if (envValue && envValue.length > 0) return envValue;
    warn(
        'RECORDING_VIEWER_SESSION_SECRET is not set; generated an ephemeral secret. ' +
        'Existing logins will be invalid after server restart. ' +
        'Set this env var for study runs.',
    );
    return generateEphemeralSecret();
}
