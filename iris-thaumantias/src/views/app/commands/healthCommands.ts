import type { CommandContext, CommandMap } from './types';
import type { WebviewToExtensionMessage, PerformHealthChecksCommand } from '../../../shared/messageContracts';
import { logger } from '../../../services/loggingService';

// Helper to extract typed payload from message
function getPayload<T extends WebviewToExtensionMessage & { payload: unknown }>(message: WebviewToExtensionMessage): T['payload'] {
    return (message as T).payload;
}

// Health check result structure
interface HealthCheckResult {
    status: string;
    message: string;
    endpoint: string;
    httpStatus: number | null;
    response: string | null;
}

type HealthCheckResults = Record<string, HealthCheckResult>;

export class HealthCommandModule {
    constructor(private readonly context: CommandContext) { }

    public getHandlers(): CommandMap {
        return {
            performHealthChecks: this.handlePerformHealthChecks,
        };
    }

    private handlePerformHealthChecks = async (message: WebviewToExtensionMessage): Promise<void> => {
        const { serverUrl } = getPayload<PerformHealthChecksCommand>(message);

        // Simplified health checks - only meaningful ones
        const results: HealthCheckResults = {
            serverReachability: { status: 'unknown', message: 'Not checked', endpoint: serverUrl, httpStatus: null, response: null },
            apiAvailability: { status: 'unknown', message: 'Not checked', endpoint: `${serverUrl}/management/health`, httpStatus: null, response: null },
            irisService: { status: 'unknown', message: 'Not checked', endpoint: `${serverUrl}/management/info`, httpStatus: null, response: null }
        };

        try {
            // 1. Server Reachability - Basic connectivity check
            try {
                const reachabilityResponse = await fetch(serverUrl, {
                    method: 'HEAD',
                    signal: AbortSignal.timeout(5000)
                });
                results.serverReachability = {
                    status: 'online',
                    message: 'Available',
                    endpoint: serverUrl,
                    httpStatus: reachabilityResponse.status,
                    response: `${reachabilityResponse.status} ${reachabilityResponse.statusText}`
                };
            } catch (error: unknown) {
                const errorMessage = error instanceof Error ? error.message : 'Network error';
                const isTimeout = error instanceof Error && error.name === 'TimeoutError';
                results.serverReachability = {
                    status: 'offline',
                    message: isTimeout ? 'Timeout' : 'Unreachable',
                    endpoint: serverUrl,
                    httpStatus: null,
                    response: errorMessage
                };
            }

            // 2. API Availability - Spring Actuator health endpoint (shows if backend is healthy)
            try {
                const healthResponse = await fetch(`${serverUrl}/management/health`, {
                    method: 'GET',
                    signal: AbortSignal.timeout(8000)
                });

                if (healthResponse.ok) {
                    try {
                        const healthData = await healthResponse.json() as { status?: string };
                        const status = healthData.status || 'UNKNOWN';
                        results.apiAvailability = {
                            status: status === 'UP' ? 'online' : 'offline',
                            message: status === 'UP' ? 'Healthy' : status,
                            endpoint: `${serverUrl}/management/health`,
                            httpStatus: healthResponse.status,
                            response: `Backend status: ${status}`
                        };
                    } catch {
                        results.apiAvailability = {
                            status: 'online',
                            message: 'Available',
                            endpoint: `${serverUrl}/management/health`,
                            httpStatus: healthResponse.status,
                            response: `${healthResponse.status} ${healthResponse.statusText}`
                        };
                    }
                } else {
                    results.apiAvailability = {
                        status: 'offline',
                        message: `Error ${healthResponse.status}`,
                        endpoint: `${serverUrl}/management/health`,
                        httpStatus: healthResponse.status,
                        response: `${healthResponse.status} ${healthResponse.statusText}`
                    };
                }
            } catch (error: unknown) {
                const errorMessage = error instanceof Error ? error.message : 'Network error';
                const isTimeout = error instanceof Error && error.name === 'TimeoutError';
                results.apiAvailability = {
                    status: 'offline',
                    message: isTimeout ? 'Timeout' : 'Unavailable',
                    endpoint: `${serverUrl}/management/health`,
                    httpStatus: null,
                    response: errorMessage
                };
            }

            // 3. Iris AI Service - Check if Iris profile is active using /management/info
            try {
                const infoResponse = await fetch(`${serverUrl}/management/info`, {
                    method: 'GET',
                    signal: AbortSignal.timeout(8000)
                });

                if (infoResponse.ok) {
                    try {
                        const infoData = await infoResponse.json() as { activeProfiles?: string[] };
                        const profiles = infoData.activeProfiles || [];
                        const isIrisActive = profiles.includes('iris');

                        results.irisService = {
                            status: isIrisActive ? 'online' : 'offline',
                            message: isIrisActive ? 'Active' : 'Not enabled',
                            endpoint: `${serverUrl}/management/info`,
                            httpStatus: infoResponse.status,
                            response: isIrisActive
                                ? `Iris profile active (${profiles.length} profiles loaded)`
                                : `Iris profile not in activeProfiles`
                        };
                    } catch {
                        results.irisService = {
                            status: 'unknown',
                            message: 'Parse error',
                            endpoint: `${serverUrl}/management/info`,
                            httpStatus: infoResponse.status,
                            response: 'Could not parse profile information'
                        };
                    }
                } else {
                    results.irisService = {
                        status: 'unknown',
                        message: `Error ${infoResponse.status}`,
                        endpoint: `${serverUrl}/management/info`,
                        httpStatus: infoResponse.status,
                        response: `${infoResponse.status} ${infoResponse.statusText}`
                    };
                }
            } catch (error: unknown) {
                const errorMessage = error instanceof Error ? error.message : 'Network error';
                const isTimeout = error instanceof Error && error.name === 'TimeoutError';
                results.irisService = {
                    status: 'unknown',
                    message: isTimeout ? 'Timeout' : 'Cannot check',
                    endpoint: `${serverUrl}/management/info`,
                    httpStatus: null,
                    response: errorMessage
                };
            }
        } catch (error) {
            logger.apiError('Error performing health checks:', error);
        }

        this.context.sendMessage({
            type: 'healthCheckResults',
            payload: {
                results: results
            }
        });
    };
}
