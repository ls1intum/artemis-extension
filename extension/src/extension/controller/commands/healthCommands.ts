import type { HealthCheckResult, WebCmd, WebviewToExtensionMessage } from '@shared/messageContracts';
import { ExtensionMsg, getPayload, WebviewCmd } from '@shared/messageContracts';

import { LogCategory, logger } from '@extension/services/loggingService';
import { CONFIG } from '@extension/utils';

import type { CommandContext, CommandMap } from './types';

type HealthCheckResults = Record<string, HealthCheckResult>;

/**
 * What a single probe can tell its caller.
 *
 * The response is decomposed into plain values rather than handed over as a
 * `Response`, so that reading `ok` / `status` / `statusText` happens INSIDE
 * `probe`'s try. That is what the original per-check try/catch covered: a
 * response object whose getters throw has to land in the same failure branch as
 * a network error, not escape to the outer catch and skip the remaining checks.
 */
type ProbeOutcome =
    | { kind: 'response'; httpOk: boolean; status: number; statusText: string; json: () => Promise<unknown> }
    | { kind: 'failure'; isTimeout: boolean; errorMessage: string };

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
 *
 * Reading the body is NOT done here. Each check needs its own handling for an
 * unreadable body, which differs from its handling of an unreachable endpoint.
 *
 * CONTRACT: this assumes an ordinary `Response`, whose `ok` / `status` /
 * `statusText` are stable primitives that cannot throw. That holds for anything
 * `fetch` returns. An adversarial response object with throwing or stateful
 * metadata getters behaves differently here than under lazy, repeated reads,
 * and deliberately so: reading the three fields together, once and up front, is
 * what keeps a throwing getter from escaping its own check.
 */
async function probe(url: string, init: { method: string; timeoutMs: number }): Promise<ProbeOutcome> {
    try {
        const response = await fetch(url, {
            method: init.method,
            signal: AbortSignal.timeout(init.timeoutMs),
        });
        return {
            kind: 'response',
            httpOk: response.ok,
            status: response.status,
            statusText: response.statusText,
            json: () => response.json() as Promise<unknown>,
        };
    } catch (error: unknown) {
        return {
            kind: 'failure',
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
            results.serverReachability = reachability.kind === 'response'
                ? {
                    status: 'online',
                    message: 'Available',
                    endpoint: serverUrl,
                    httpStatus: reachability.status,
                    response: `${reachability.status} ${reachability.statusText}`
                }
                : {
                    status: 'offline',
                    message: reachability.isTimeout ? 'Timeout' : 'Unreachable',
                    endpoint: serverUrl,
                    httpStatus: null,
                    response: reachability.errorMessage
                };

            const health = await probe(healthUrl, { method: 'GET', timeoutMs: 8000 });
            if (health.kind === 'failure') {
                results.apiAvailability = {
                    status: 'offline',
                    message: health.isTimeout ? 'Timeout' : 'Unavailable',
                    endpoint: healthUrl,
                    httpStatus: null,
                    response: health.errorMessage
                };
            } else if (!health.httpOk) {
                results.apiAvailability = {
                    status: 'offline',
                    message: `Error ${health.status}`,
                    endpoint: healthUrl,
                    httpStatus: health.status,
                    response: `${health.status} ${health.statusText}`
                };
            } else {
                try {
                    const healthData = await health.json() as { status?: string };
                    const status = healthData.status || 'UNKNOWN';
                    results.apiAvailability = {
                        status: status === 'UP' ? 'online' : 'offline',
                        message: status === 'UP' ? 'Healthy' : status,
                        endpoint: healthUrl,
                        httpStatus: health.status,
                        response: `Backend status: ${status}`
                    };
                } catch {
                    // A 2xx whose body cannot be read still means the endpoint
                    // answered, so this stays `online`.
                    results.apiAvailability = {
                        status: 'online',
                        message: 'Available',
                        endpoint: healthUrl,
                        httpStatus: health.status,
                        response: `${health.status} ${health.statusText}`
                    };
                }
            }

            const info = await probe(infoUrl, { method: 'GET', timeoutMs: 8000 });
            if (info.kind === 'failure') {
                results.irisService = {
                    status: 'unknown',
                    message: info.isTimeout ? 'Timeout' : 'Cannot check',
                    endpoint: infoUrl,
                    httpStatus: null,
                    response: info.errorMessage
                };
            } else if (!info.httpOk) {
                // Unlike the health check above, a failure here is `unknown`
                // rather than `offline`: not reaching the info endpoint says
                // nothing about whether Iris is enabled.
                results.irisService = {
                    status: 'unknown',
                    message: `Error ${info.status}`,
                    endpoint: infoUrl,
                    httpStatus: info.status,
                    response: `${info.status} ${info.statusText}`
                };
            } else {
                try {
                    const infoData = await info.json() as { activeProfiles?: string[]; activeModuleFeatures?: string[] };
                    const profiles = infoData.activeProfiles || [];
                    const moduleFeatures = infoData.activeModuleFeatures || [];
                    const isIrisActive = moduleFeatures.includes('iris') || profiles.includes('iris');

                    results.irisService = {
                        status: isIrisActive ? 'online' : 'offline',
                        message: isIrisActive ? 'Active' : 'Not enabled',
                        endpoint: infoUrl,
                        httpStatus: info.status,
                        response: isIrisActive
                            ? `Iris module active (${moduleFeatures.length} module features, ${profiles.length} profiles loaded)`
                            : `Iris not found in activeModuleFeatures or activeProfiles`
                    };
                } catch {
                    results.irisService = {
                        status: 'unknown',
                        message: 'Parse error',
                        endpoint: infoUrl,
                        httpStatus: info.status,
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
