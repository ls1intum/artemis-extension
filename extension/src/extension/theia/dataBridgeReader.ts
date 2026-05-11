import * as vscode from 'vscode';
import { logger, LogCategory } from '../services/loggingService';

const DATA_BRIDGE_COMMAND = 'dataBridge.getEnv';
const POLL_INTERVAL_MS = 500;
const POLL_TIMEOUT_MS = 10_000;

/**
 * Keys the EduIDE LandingPage forwards into the LaunchRequest and that the
 * operator therefore POSTs to the data-bridge. Source of truth:
 * `EduIDE-Landing-Page/src/App.tsx` (env construction near LaunchRequest creation).
 *
 * Used by {@link probeDataBridge} to enumerate what the bridge should hold.
 * `DATA_BRIDGE_ENABLED` is intentionally absent: it is set as a container env
 * var by the operator at pod boot, never injected through the bridge.
 */
export const KNOWN_BRIDGE_KEYS = [
    'THEIA',
    'ARTEMIS_URL',
    'ARTEMIS_TOKEN',
    'GIT_URI',
    'GIT_USER',
    'GIT_MAIL',
    'TEMPLATE',
] as const;

type KnownBridgeKey = (typeof KNOWN_BRIDGE_KEYS)[number];

/**
 * Outcome of a {@link readEnvVarsViaDataBridge} call.
 *
 * The discriminator distinguishes two situations that both used to be encoded
 * as `undefined`: a genuine Desktop boot (`no-bridge`) and an EduIDE boot where
 * the bridge was expected but unreachable (`failure`). Conflating them lets a
 * broken EduIDE pod silently boot in Desktop-Cookie mode, which is the wrong
 * failure mode (auth would attempt the wrong scheme; auto-clone would not run).
 */
type ReadEnvResult<T extends string> =
    | { kind: 'no-bridge' }
    | { kind: 'success'; env: Record<T, string | undefined> }
    | { kind: 'failure'; reason: 'command-missing' | 'timeout' | 'invalid-response'; details?: string };

/**
 * Reads environment variables via the EduIDE data-bridge companion extension.
 *
 * In cloud deployments, the IDE container may start before credentials are
 * injected by the orchestrator. The data-bridge extension (tum-aet.data-bridge)
 * runs an HTTP server that receives late-arriving environment variables via
 * POST and exposes them through the {@link DATA_BRIDGE_COMMAND} VS Code command.
 *
 * Only activates when `DATA_BRIDGE_ENABLED` is set in the environment — this
 * is the same env var that the data-bridge extension itself uses to start its
 * HTTP server. Without it, the command may be registered but never receives
 * data, which would cause a 10s blocking poll on every startup.
 *
 * Polls every 500ms until all requested keys are present, with a 10s timeout.
 *
 * Return semantics:
 *  - `no-bridge`: `DATA_BRIDGE_ENABLED` is not set → genuinely Desktop.
 *  - `failure`: bridge was expected (`DATA_BRIDGE_ENABLED=1`) but the command
 *    is missing or did not deliver values within the timeout → caller MUST
 *    surface this loudly; silently degrading to Desktop produces broken auth.
 *  - `success`: all requested keys delivered.
 *
 * Pattern adapted from Scorpio's DataBridgeStrategy (env-strategy.ts).
 */
export async function readEnvVarsViaDataBridge<T extends string>(
    names: readonly T[],
): Promise<ReadEnvResult<T>> {
    // DATA_BRIDGE_ENABLED is a container-boot config var, available in process.env
    // from container startup — unlike the credentials (ARTEMIS_TOKEN etc.) which are
    // injected later via the data-bridge HTTP server. This is why process.env is
    // reliable here even though it's unreliable for late-arriving credentials.
    // Without this guard, polling would block for 10s with no data arriving.
    const bridgeEnabled = process.env.DATA_BRIDGE_ENABLED;
    if (bridgeEnabled !== '1' && bridgeEnabled !== 'true') {
        return { kind: 'no-bridge' };
    }

    const commands = await vscode.commands.getCommands(true);
    if (!commands.includes(DATA_BRIDGE_COMMAND)) {
        return { kind: 'failure', reason: 'command-missing' };
    }

    logger.info('DataBridge enabled, polling for environment variables...', LogCategory.GENERAL);
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    let lastError: string | undefined;

    while (Date.now() < deadline) {
        try {
            // The data-bridge `getEnv` command requires a `string[]` argument
            // (validated server-side via arktype). Calling without args makes
            // the command return its error summary as a plain string, not a
            // record — which silently masquerades as an empty result.
            const envMap = await vscode.commands.executeCommand<Record<string, string> | string>(
                DATA_BRIDGE_COMMAND,
                [...names],
            );

            if (envMap && typeof envMap === 'object' && !Array.isArray(envMap)) {
                if (names.every((name) => !!(envMap as Record<string, string>)[name])) {
                    logger.info('DataBridge: all environment variables received', LogCategory.GENERAL);
                    const result = {} as Record<T, string | undefined>;
                    for (const name of names) {
                        result[name] = (envMap as Record<string, string>)[name] || undefined;
                    }
                    return { kind: 'success', env: result };
                }
                // Record present but missing keys — keep polling; values may
                // arrive in a later POST.
            } else if (envMap !== undefined && envMap !== null) {
                // Non-record response (string, array, primitive). The bridge is
                // responding but rejecting the call, so polling will not help —
                // the request shape is wrong and won't change. Fail fast with
                // the actual response captured for diagnostics.
                return {
                    kind: 'failure',
                    reason: 'invalid-response',
                    details: typeof envMap === 'string' ? envMap : `unexpected response type: ${typeof envMap}`,
                };
            }
        } catch (e) {
            // data-bridge may not be ready yet — keep polling. Capture the
            // most recent error to surface if the deadline elapses.
            lastError = e instanceof Error ? e.message : String(e);
        }

        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }

    logger.warn(
        'DataBridge: timeout waiting for environment variables',
        LogCategory.GENERAL,
    );
    return { kind: 'failure', reason: 'timeout', details: lastError };
}

interface DataBridgeProbeResult {
    /** Whether the `dataBridge.getEnv` command is registered (extension installed + active). */
    readonly commandAvailable: boolean;
    /** Whether `DATA_BRIDGE_ENABLED` env var is set (the bridge's own activation gate). */
    readonly bridgeEnabledFlag: string | undefined;
    /** Whether the live call returned a usable response. */
    readonly responded: boolean;
    /** Per-key values returned by the bridge for the probed keys (undefined = key not in bridge storage). */
    readonly values: Partial<Record<KnownBridgeKey, string>>;
    /** Error message if the call threw or returned a non-record. */
    readonly error?: string;
}

/**
 * One-shot live probe of the data-bridge state. Unlike {@link readEnvVarsViaDataBridge}
 * this does not poll, does not gate on `DATA_BRIDGE_ENABLED`, and does not fall
 * back — it reports raw observed state so the diagnostic command can show
 * exactly why detection is failing (extension absent vs. command error vs.
 * empty storage vs. partial values).
 */
export async function probeDataBridge(
    keys: readonly KnownBridgeKey[] = KNOWN_BRIDGE_KEYS,
): Promise<DataBridgeProbeResult> {
    const bridgeEnabledFlag = process.env.DATA_BRIDGE_ENABLED;

    const commands = await vscode.commands.getCommands(true);
    if (!commands.includes(DATA_BRIDGE_COMMAND)) {
        return { commandAvailable: false, bridgeEnabledFlag, responded: false, values: {} };
    }

    try {
        const raw = await vscode.commands.executeCommand<Record<string, string> | string>(
            DATA_BRIDGE_COMMAND,
            [...keys],
        );

        if (typeof raw !== 'object' || raw === null) {
            return {
                commandAvailable: true,
                bridgeEnabledFlag,
                responded: false,
                values: {},
                error: typeof raw === 'string' ? `Bridge returned error: ${raw}` : `Unexpected response type: ${typeof raw}`,
            };
        }

        const values: Partial<Record<KnownBridgeKey, string>> = {};
        for (const key of keys) {
            const v = (raw as Record<string, string>)[key];
            if (typeof v === 'string' && v.length > 0) {
                values[key] = v;
            }
        }
        return { commandAvailable: true, bridgeEnabledFlag, responded: true, values };
    } catch (e) {
        return {
            commandAvailable: true,
            bridgeEnabledFlag,
            responded: false,
            values: {},
            error: e instanceof Error ? e.message : String(e),
        };
    }
}
