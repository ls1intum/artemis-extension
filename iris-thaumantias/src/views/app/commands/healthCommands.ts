import type { CommandContext, CommandMap } from './types';

export class HealthCommandModule {
    constructor(private readonly context: CommandContext) {}

    public getHandlers(): CommandMap {
        return {
            performHealthChecks: this.handlePerformHealthChecks,
        };
    }

    private handlePerformHealthChecks = async (message: any): Promise<void> => {
        const serverUrl: string = message.serverUrl;

        const results: any = {
            serverReachability: { status: 'unknown', message: 'Not checked', endpoint: serverUrl, httpStatus: null, response: null },
            authService: { status: 'unknown', message: 'Not checked', endpoint: `${serverUrl}/api/core/public/authenticate`, httpStatus: null, response: null },
            apiAvailability: { status: 'unknown', message: 'Not checked', endpoint: `${serverUrl}/management/health`, httpStatus: null, response: null },
            websocket: { status: 'unknown', message: 'Not checked', endpoint: `${serverUrl}/websocket`, httpStatus: null, response: null },
            irisService: { status: 'unknown', message: 'Not checked', endpoint: `${serverUrl}/api/iris/status`, httpStatus: null, response: null }
        };

        let cookieHeader: string | undefined;
        try {
            cookieHeader = await this.context.authManager.getCookieHeader();
        } catch (error) {
            console.log('No authentication cookie available for health checks');
        }

        try {
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
            } catch (error: any) {
                results.serverReachability = {
                    status: 'offline',
                    message: error.name === 'TimeoutError' ? 'Timeout' : 'Unreachable',
                    endpoint: serverUrl,
                    httpStatus: null,
                    response: error.message || 'Network error'
                };
            }

            try {
                const authResponse = await fetch(`${serverUrl}/api/core/public/authenticate`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username: '', password: '', rememberMe: false }),
                    signal: AbortSignal.timeout(8000)
                });

                if (authResponse.status === 400 || authResponse.status === 401 || authResponse.status === 200) {
                    results.authService = {
                        status: 'online',
                        message: 'Available',
                        endpoint: `${serverUrl}/api/core/public/authenticate`,
                        httpStatus: authResponse.status,
                        response: `${authResponse.status} ${authResponse.statusText} (Expected - requires credentials)`
                    };
                } else {
                    results.authService = {
                        status: 'offline',
                        message: `Error ${authResponse.status}`,
                        endpoint: `${serverUrl}/api/core/public/authenticate`,
                        httpStatus: authResponse.status,
                        response: `${authResponse.status} ${authResponse.statusText}`
                    };
                }
            } catch (error: any) {
                results.authService = {
                    status: 'offline',
                    message: error.name === 'TimeoutError' ? 'Timeout' : 'Unavailable',
                    endpoint: `${serverUrl}/api/core/public/authenticate`,
                    httpStatus: null,
                    response: error.message || 'Network error'
                };
            }

            try {
                const healthResponse = await fetch(`${serverUrl}/management/health`, {
                    method: 'GET',
                    signal: AbortSignal.timeout(8000)
                });

                const healthText = healthResponse.ok ? await healthResponse.text() : null;

                if (healthResponse.ok) {
                    results.apiAvailability = {
                        status: 'online',
                        message: 'Available',
                        endpoint: `${serverUrl}/management/health`,
                        httpStatus: healthResponse.status,
                        response: healthText ? healthText.substring(0, 100) : `${healthResponse.status} ${healthResponse.statusText}`
                    };
                } else {
                    results.apiAvailability = {
                        status: 'offline',
                        message: `Error ${healthResponse.status}`,
                        endpoint: `${serverUrl}/management/health`,
                        httpStatus: healthResponse.status,
                        response: `${healthResponse.status} ${healthResponse.statusText}`
                    };
                }
            } catch (error: any) {
                results.apiAvailability = {
                    status: 'offline',
                    message: error.name === 'TimeoutError' ? 'Timeout' : 'Unavailable',
                    endpoint: `${serverUrl}/management/health`,
                    httpStatus: null,
                    response: error.message || 'Network error'
                };
            }

            try {
                const websocketUrl = new URL(serverUrl);
                websocketUrl.protocol = websocketUrl.protocol === 'https:' ? 'wss:' : 'ws:';
                websocketUrl.pathname = '/websocket';

                const websocketResponse = await fetch(websocketUrl.toString(), {
                    method: 'HEAD',
                    signal: AbortSignal.timeout(5000)
                });

                results.websocket = {
                    status: websocketResponse.ok ? 'online' : 'offline',
                    message: websocketResponse.ok ? 'Available' : `Error ${websocketResponse.status}`,
                    endpoint: `${serverUrl}/websocket`,
                    httpStatus: websocketResponse.status,
                    response: `${websocketResponse.status} ${websocketResponse.statusText}`
                };
            } catch (error: any) {
                if (results.serverReachability.status === 'online') {
                    results.websocket = {
                        status: 'unknown',
                        message: error.name === 'TimeoutError' ? 'Timeout' : 'Cannot check',
                        endpoint: `${serverUrl}/websocket`,
                        httpStatus: null,
                        response: error.message || 'Network error'
                    };
                } else {
                    results.websocket = {
                        status: 'offline',
                        message: 'Server unreachable',
                        endpoint: `${serverUrl}/websocket`,
                        httpStatus: 'N/A',
                        response: 'Cannot connect - server unreachable'
                    };
                }
            }

            try {
                const irisHeaders: Record<string, string> = {};
                if (cookieHeader) {
                    irisHeaders['Cookie'] = cookieHeader;
                }

                const irisResponse = await fetch(`${serverUrl}/api/iris/status`, {
                    method: 'GET',
                    headers: irisHeaders,
                    signal: AbortSignal.timeout(8000)
                });

                if (irisResponse.ok) {
                    try {
                        const irisData: any = await irisResponse.json();
                        const isActive = irisData.active === true;
                        const rateLimit = irisData.rateLimitInfo ?
                            `Rate limit: ${irisData.rateLimitInfo.currentMessageCount}/${irisData.rateLimitInfo.rateLimit}` :
                            'No rate limit info';

                        results.irisService = {
                            status: isActive ? 'online' : 'offline',
                            message: isActive ? 'Active' : 'Inactive',
                            endpoint: `${serverUrl}/api/iris/status`,
                            httpStatus: irisResponse.status,
                            response: `${irisResponse.status} ${irisResponse.statusText} - ${isActive ? 'Active' : 'Inactive'} (${rateLimit})`
                        };
                    } catch (parseError) {
                        results.irisService = {
                            status: 'online',
                            message: 'Available',
                            endpoint: `${serverUrl}/api/iris/status`,
                            httpStatus: irisResponse.status,
                            response: `${irisResponse.status} ${irisResponse.statusText} (Authenticated)`
                        };
                    }
                } else if (irisResponse.status === 401) {
                    results.irisService = {
                        status: 'online',
                        message: 'Available',
                        endpoint: `${serverUrl}/api/iris/status`,
                        httpStatus: irisResponse.status,
                        response: `${irisResponse.status} ${irisResponse.statusText} (Requires authentication)`
                    };
                } else if (irisResponse.status === 403) {
                    results.irisService = {
                        status: 'online',
                        message: 'Available',
                        endpoint: `${serverUrl}/api/iris/status`,
                        httpStatus: irisResponse.status,
                        response: `${irisResponse.status} ${irisResponse.statusText} (Requires permission)`
                    };
                } else if (irisResponse.status === 404) {
                    results.irisService = {
                        status: 'unknown',
                        message: 'Not configured',
                        endpoint: `${serverUrl}/api/iris/status`,
                        httpStatus: irisResponse.status,
                        response: `${irisResponse.status} ${irisResponse.statusText} (Iris not enabled)`
                    };
                } else {
                    results.irisService = {
                        status: 'offline',
                        message: `Error ${irisResponse.status}`,
                        endpoint: `${serverUrl}/api/iris/status`,
                        httpStatus: irisResponse.status,
                        response: `${irisResponse.status} ${irisResponse.statusText}`
                    };
                }
            } catch (error: any) {
                results.irisService = {
                    status: 'unknown',
                    message: error.name === 'TimeoutError' ? 'Timeout' : 'Cannot check',
                    endpoint: `${serverUrl}/api/iris/status`,
                    httpStatus: null,
                    response: error.message || 'Network error'
                };
            }
        } catch (error) {
            console.error('Error performing health checks:', error);
        }

        this.context.sendMessage({
            command: 'healthCheckResults',
            results: results
        });
    };
}
