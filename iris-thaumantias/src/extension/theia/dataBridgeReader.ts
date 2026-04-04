import * as vscode from 'vscode';
import { logger, LogCategory } from '../services/loggingService';

const DATA_BRIDGE_COMMAND = 'dataBridge.getEnv';
const POLL_INTERVAL_MS = 500;
const POLL_TIMEOUT_MS = 10_000;

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
 * Returns `undefined` if data-bridge is unavailable or times out, signaling
 * the caller to fall back to process env reading.
 *
 * Pattern adapted from Scorpio's DataBridgeStrategy (env-strategy.ts).
 */
export async function readEnvVarsViaDataBridge<T extends string>(
    names: readonly T[],
): Promise<Record<T, string | undefined> | undefined> {
    // DATA_BRIDGE_ENABLED is a container-boot config var, available in process.env
    // from container startup — unlike the credentials (ARTEMIS_TOKEN etc.) which are
    // injected later via the data-bridge HTTP server. This is why process.env is
    // reliable here even though it's unreliable for late-arriving credentials.
    // Without this guard, polling would block for 10s with no data arriving.
    const bridgeEnabled = process.env.DATA_BRIDGE_ENABLED;
    if (bridgeEnabled !== '1' && bridgeEnabled !== 'true') {
        return undefined;
    }

    const commands = await vscode.commands.getCommands(true);
    if (!commands.includes(DATA_BRIDGE_COMMAND)) {
        return undefined;
    }

    logger.info('DataBridge enabled, polling for environment variables...', LogCategory.GENERAL);
    const deadline = Date.now() + POLL_TIMEOUT_MS;

    while (Date.now() < deadline) {
        try {
            const envMap = await vscode.commands.executeCommand<Record<string, string>>(
                DATA_BRIDGE_COMMAND,
            );

            if (envMap && typeof envMap === 'object') {
                if (names.every((name) => !!envMap[name])) {
                    logger.info('DataBridge: all environment variables received', LogCategory.GENERAL);
                    const result = {} as Record<T, string | undefined>;
                    for (const name of names) {
                        result[name] = envMap[name] || undefined;
                    }
                    return result;
                }
            }
        } catch {
            // data-bridge may not be ready yet — keep polling
        }

        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }

    logger.warn(
        'DataBridge: timeout waiting for environment variables, falling back to process env',
        LogCategory.GENERAL,
    );
    return undefined;
}
