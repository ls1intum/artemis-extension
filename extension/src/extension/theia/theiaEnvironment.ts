import * as vscode from 'vscode';

import { LogCategory, logger } from '@extension/services/loggingService';

import { readEnvVarsViaDataBridge } from './dataBridgeReader';
import { type TheiaEnvironment, VSCODE_ENVIRONMENT } from './types';

/**
 * Environment variable names used for Theia/EduIDE integration.
 * The EduIDE operator POSTs these to the data-bridge after pod boot;
 * the bridge then exposes them via the `dataBridge.getEnv` command.
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
 * The data-bridge is the sole source of truth. The reader distinguishes three
 * outcomes; each maps to a different boot path here:
 *  - `no-bridge`: `DATA_BRIDGE_ENABLED` not set → genuinely Desktop. Return
 *    the non-Theia default; Cookie auth and interactive login are correct.
 *  - `failure`: bridge was expected but unreachable. Surface a hard error so
 *    the operator and the student see why authentication will not work,
 *    instead of silently booting in Desktop-Cookie mode against an EduIDE
 *    Artemis (which would then attempt the wrong auth scheme and fail with
 *    a confusing 401). The extension still loads so the diagnostic command
 *    remains accessible.
 *  - `success`: bridge delivered all keys → Theia-managed environment.
 */
async function detectTheiaEnvironment(): Promise<TheiaEnvironment> {
    const result = await readEnvVarsViaDataBridge(THEIA_ENV_VARS);

    if (result.kind === 'no-bridge') {
        return VSCODE_ENVIRONMENT;
    }

    if (result.kind === 'failure') {
        const reasonText =
            result.reason === 'command-missing'
                ? 'data-bridge extension not registered'
                : result.reason === 'timeout'
                    ? 'timed out waiting for credentials'
                    : 'invalid response';
        const detailsSuffix = result.details ? ` (${result.details})` : '';
        logger.error(
            `EduIDE bridge unavailable: ${reasonText}${detailsSuffix}`,
            LogCategory.GENERAL,
        );
        void vscode.window.showErrorMessage(
            `Iris: EduIDE bridge unavailable (${reasonText}). Authentication and auto-clone will not work. ` +
                'Restart your EduIDE pod or contact support.',
        );
        return VSCODE_ENVIRONMENT;
    }

    const env = result.env;
    if (!env.ARTEMIS_TOKEN || !env.ARTEMIS_URL) {
        // Bridge responded but did not deliver the auth pair — same hard
        // failure as `failure` from the caller's perspective.
        logger.error(
            'EduIDE bridge response missing ARTEMIS_URL or ARTEMIS_TOKEN',
            LogCategory.GENERAL,
        );
        void vscode.window.showErrorMessage(
            'Iris: EduIDE bridge returned an incomplete credential set. Authentication will not work. ' +
                'Restart your EduIDE pod or contact support.',
        );
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
