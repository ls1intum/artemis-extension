import type { HealthCheckResult, WebCmd, WebviewToExtensionMessage } from '@shared/messageContracts';
import { ExtensionMsg, getPayload, WebviewCmd } from '@shared/messageContracts';

import { LogCategory, logger } from '@extension/services/loggingService';
import { CONFIG } from '@extension/utils';

import type { CommandContext, CommandMap } from './types';

type HealthCheckResults = Record<string, HealthCheckResult>;

/** What a single probe can tell its caller. */
type ProbeOutcome =
    | { ok: true; response: Response }
    | { ok: false; isTimeout: boolean; errorMessage: string };

/**
 * One HTTP probe with a timeout.
 *
 * Uses `AbortSignal.timeout` rather than the `AbortController` in
 * `artemisApi`'s `fetchWithTimeout`, and the difference is load-bearing: only
 * `AbortSignal.timeout` rejects with a `TimeoutError`, which is how each check
 * below tells a timeout apart from an ordinary failure. Unifying the two would
 * silently reclassify every timeout.
 *
 * Deliberately reports the outcome instead of mapping it: the three checks turn
 * the same outcome into different statuses and messages (a failed info lookup is
 * `unknown`, a failed health lookup is `offline`), so the mapping stays with
 * each check.
 */
async function probe(url: string, init: { method: string; timeoutMs: number }): Promise<ProbeOutcome> {
    try {
        const response = await fetch(url, {
            method: init.method,
            signal: AbortSignal.timeout(init.timeoutMs),
        });
        return { ok: true, response };
    } catch (error: unknown) {
        return {
            ok: false,
            isTimeout: error instanceof Error && error.name === 'TimeoutError',
            errorMessage: error instanceof Error ? error.message : 'Network error',
        };
    }
}

export class HealthCommandModule {
    constructor(private readonly context: CommandContext) { }

    public getHandlers(): CommandMap {
        return {
            [WebviewCmd.PerformHealthChecks]: this.handlePerformHealthChecks,
        };
    }

    private handlePerformHealthChecks = async (message: WebviewToExtensionMessage): Promise<void> => {
        const { serverUrl } = getPayload<WebCmd<'performHealthChecks'>>(message);
        const healthUrl = `${serverUrl}${CONFIG.API.ENDPOINTS.MANAGEMENT_HEALTH}`;
        const infoUrl = `${serverUrl}${CONFIG.API.ENDPOINTS.MANAGEMENT_INFO}`;

        const results: HealthCheckResults = {
            serverReachability: { status: 'unknown', message: 'Not checked', endpoint: serverUrl, httpStatus: null, response: null },
            apiAvailability: { status: 'unknown', message: 'Not checked', endpoint: healthUrl, httpStatus: null, response: null },
            irisService: { status: 'unknown', message: 'Not checked', endpoint: infoUrl, httpStatus: null, response: null }
        };

        try {
            // Reachability deliberately does NOT consult `response.ok`: any
            // answer at all, including a 500, proves the server is reachable.
            const reachability = await probe(serverUrl, { method: 'HEAD', timeoutMs: 5000 });
            results.serverReachability = reachability.ok
                ? {
                    status: 'online',
                    message: 'Available',
                    endpoint: serverUrl,
                    httpStatus: reachability.response.status,
                    response: `${reachability.response.status} ${reachability.response.statusText}`
                }
                : {
                    status: 'offline',
                    message: reachability.isTimeout ? 'Timeout' : 'Unreachable',
                    endpoint: serverUrl,
                    httpStatus: null,
                    response: reachability.errorMessage
                };

            const health = await probe(healthUrl, { method: 'GET', timeoutMs: 8000 });
            if (!health.ok) {
                results.apiAvailability = {
                    status: 'offline',
                    message: health.isTimeout ? 'Timeout' : 'Unavailable',
                    endpoint: healthUrl,
                    httpStatus: null,
                    response: health.errorMessage
                };
            } else if (!health.response.ok) {
                results.apiAvailability = {
                    status: 'offline',
                    message: `Error ${health.response.status}`,
                    endpoint: healthUrl,
                    httpStatus: health.response.status,
                    response: `${health.response.status} ${health.response.statusText}`
                };
            } else {
                try {
                    const healthData = await health.response.json() as { status?: string };
                    const status = healthData.status || 'UNKNOWN';
                    results.apiAvailability = {
                        status: status === 'UP' ? 'online' : 'offline',
                        message: status === 'UP' ? 'Healthy' : status,
                        endpoint: healthUrl,
                        httpStatus: health.response.status,
                        response: `Backend status: ${status}`
                    };
                } catch {
                    // A 2xx whose body cannot be read still means the endpoint
                    // answered, so this stays `online`.
                    results.apiAvailability = {
                        status: 'online',
                        message: 'Available',
                        endpoint: healthUrl,
                        httpStatus: health.response.status,
                        response: `${health.response.status} ${health.response.statusText}`
                    };
                }
            }

            const info = await probe(infoUrl, { method: 'GET', timeoutMs: 8000 });
            if (!info.ok) {
                results.irisService = {
                    status: 'unknown',
                    message: info.isTimeout ? 'Timeout' : 'Cannot check',
                    endpoint: infoUrl,
                    httpStatus: null,
                    response: info.errorMessage
                };
            } else if (!info.response.ok) {
                // Unlike the health check above, a failure here is `unknown`
                // rather than `offline`: not reaching the info endpoint says
                // nothing about whether Iris is enabled.
                results.irisService = {
                    status: 'unknown',
                    message: `Error ${info.response.status}`,
                    endpoint: infoUrl,
                    httpStatus: info.response.status,
                    response: `${info.response.status} ${info.response.statusText}`
                };
            } else {
                try {
                    const infoData = await info.response.json() as { activeProfiles?: string[]; activeModuleFeatures?: string[] };
                    const profiles = infoData.activeProfiles || [];
                    const moduleFeatures = infoData.activeModuleFeatures || [];
                    const isIrisActive = moduleFeatures.includes('iris') || profiles.includes('iris');

                    results.irisService = {
                        status: isIrisActive ? 'online' : 'offline',
                        message: isIrisActive ? 'Active' : 'Not enabled',
                        endpoint: infoUrl,
                        httpStatus: info.response.status,
                        response: isIrisActive
                            ? `Iris module active (${moduleFeatures.length} module features, ${profiles.length} profiles loaded)`
                            : `Iris not found in activeModuleFeatures or activeProfiles`
                    };
                } catch {
                    results.irisService = {
                        status: 'unknown',
                        message: 'Parse error',
                        endpoint: infoUrl,
                        httpStatus: info.response.status,
                        response: 'Could not parse profile information'
                    };
                }
            }
        } catch (error: unknown) {
            logger.error('Error performing health checks:', LogCategory.API, error);
        }

        this.context.sendMessage({
            type: ExtensionMsg.HealthCheckResults,
            results: results
        });
    };
}
