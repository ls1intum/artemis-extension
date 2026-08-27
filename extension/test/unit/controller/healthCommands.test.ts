/**
 * Characterization tests for `performHealthChecks`.
 *
 * Landed against the CURRENT implementation before any refactor, because
 * several of its branches are counter-intuitive and a well-meaning cleanup
 * would "fix" them by accident:
 *
 *   - reachability IGNORES `response.ok`: a 500 still reads as Available/online
 *   - a health response whose JSON cannot be read also reads as Available
 *   - a health status other than 'UP' becomes the message verbatim
 *   - "Iris not enabled" is `offline`, while a parse error or non-2xx is `unknown`
 *
 * Both consumers (`ServiceStatusView` and the Login health panel) render
 * `message`, `response` and `endpoint` directly and branch on none of them, so
 * every string here is part of the contract. Each case therefore asserts all
 * five `HealthCheckResult` fields rather than just status/message.
 *
 * Scope: normal Artemis response shapes. `json()` resolving `null`, or a truthy
 * non-array `activeProfiles`/`activeModuleFeatures`, take different paths from a
 * REJECTED `json()` and are deliberately not covered. `getPayload` throwing on a
 * malformed command is out of scope too: it throws outside the handler's try.
 */

import * as assert from 'assert';
import * as sinon from 'sinon';

import type { HealthCheckResult } from '@shared/messageContracts';
import { ExtensionMsg, WebviewCmd } from '@shared/messageContracts';

import { HealthCommandModule } from '@extension/controller/commands/healthCommands';
import type { CommandContext } from '@extension/controller/commands/types';

const SERVER = 'https://artemis.example.com';
const HEALTH_URL = `${SERVER}/management/health`;
const INFO_URL = `${SERVER}/management/info`;

interface FetchCall { url: string; method?: string; timeoutMs?: number }

/** One stubbed response per endpoint, by URL. */
type Responder = (url: string) => Promise<unknown>;

function jsonResponse(status: number, statusText: string, body: unknown, ok?: boolean): unknown {
    return {
        ok: ok ?? (status >= 200 && status < 300),
        status,
        statusText,
        json: async () => body,
    };
}

function unreadableJson(status: number, statusText: string): unknown {
    return {
        ok: status >= 200 && status < 300,
        status,
        statusText,
        json: async () => { throw new SyntaxError('Unexpected token < in JSON'); },
    };
}

function timeoutError(): Error {
    const err = new Error('The operation was aborted due to timeout');
    err.name = 'TimeoutError';
    return err;
}

suite('performHealthChecks', () => {
    let sandbox: sinon.SinonSandbox;
    let calls: FetchCall[];
    let originalFetch: typeof global.fetch;
    let originalTimeout: typeof AbortSignal.timeout;

    setup(() => {
        sandbox = sinon.createSandbox();
        calls = [];
        originalFetch = global.fetch;
        originalTimeout = AbortSignal.timeout;
    });

    teardown(() => {
        global.fetch = originalFetch;
        AbortSignal.timeout = originalTimeout;
        sandbox.restore();
    });

    /**
     * Records url/method/timeout per call. The timeout is only observable by
     * stubbing `AbortSignal.timeout`: the signal handed to fetch does not carry
     * its duration.
     */
    async function run(responder: Responder): Promise<Record<string, HealthCheckResult>> {
        let pendingTimeout: number | undefined;
        AbortSignal.timeout = ((ms: number) => {
            pendingTimeout = ms;
            return originalTimeout.call(AbortSignal, 100_000);
        }) as typeof AbortSignal.timeout;

        global.fetch = (async (url: string, init?: { method?: string }) => {
            calls.push({ url, method: init?.method, timeoutMs: pendingTimeout });
            return responder(url);
        }) as unknown as typeof global.fetch;

        const sent: Array<Record<string, unknown>> = [];
        const context = {
            sendMessage: (msg: Record<string, unknown>) => { sent.push(msg); },
        } as unknown as CommandContext;

        const handler = new HealthCommandModule(context).getHandlers()[WebviewCmd.PerformHealthChecks];
        await handler({
            type: 'command',
            command: WebviewCmd.PerformHealthChecks,
            payload: { serverUrl: SERVER },
        } as never);

        assert.strictEqual(sent.length, 1, 'exactly one results message must be sent');
        assert.strictEqual(sent[0].type, ExtensionMsg.HealthCheckResults);
        return sent[0].results as Record<string, HealthCheckResult>;
    }

    /** Everything healthy, so a case can override just the endpoint it cares about. */
    const allHealthy: Responder = async (url) => {
        if (url === HEALTH_URL) { return jsonResponse(200, 'OK', { status: 'UP' }); }
        if (url === INFO_URL) { return jsonResponse(200, 'OK', { activeModuleFeatures: ['iris'], activeProfiles: [] }); }
        return jsonResponse(200, 'OK', {});
    };

    suite('request shape', () => {
        test('issues exactly three requests with the documented method and timeout', async () => {
            await run(allHealthy);

            assert.deepStrictEqual(calls, [
                { url: SERVER, method: 'HEAD', timeoutMs: 5000 },
                { url: HEALTH_URL, method: 'GET', timeoutMs: 8000 },
                { url: INFO_URL, method: 'GET', timeoutMs: 8000 },
            ]);
        });

        test('sends one message carrying all three keys', async () => {
            const results = await run(allHealthy);
            assert.deepStrictEqual(
                Object.keys(results).sort(),
                ['apiAvailability', 'irisService', 'serverReachability'],
            );
        });
    });

    suite('server reachability', () => {
        test('a 200 reads as available', async () => {
            const results = await run(allHealthy);
            assert.deepStrictEqual(results.serverReachability, {
                status: 'online', message: 'Available', endpoint: SERVER,
                httpStatus: 200, response: '200 OK',
            });
        });

        test('an HTTP error still reads as available: response.ok is not consulted', async () => {
            const results = await run(async (url) =>
                url === SERVER ? jsonResponse(500, 'Internal Server Error', {}) : allHealthy(url));

            assert.deepStrictEqual(results.serverReachability, {
                status: 'online', message: 'Available', endpoint: SERVER,
                httpStatus: 500, response: '500 Internal Server Error',
            });
        });

        test('a network error reads as unreachable and carries the error text', async () => {
            const results = await run(async (url) => {
                if (url === SERVER) { throw new Error('getaddrinfo ENOTFOUND'); }
                return allHealthy(url);
            });

            assert.deepStrictEqual(results.serverReachability, {
                status: 'offline', message: 'Unreachable', endpoint: SERVER,
                httpStatus: null, response: 'getaddrinfo ENOTFOUND',
            });
        });

        test('a timeout is distinguished from an ordinary error', async () => {
            const results = await run(async (url) => {
                if (url === SERVER) { throw timeoutError(); }
                return allHealthy(url);
            });

            assert.strictEqual(results.serverReachability.message, 'Timeout');
            assert.strictEqual(results.serverReachability.status, 'offline');
        });

        test('a non-Error rejection still yields "Network error"', async () => {
            const results = await run(async (url) => {
                // eslint-disable-next-line no-throw-literal -- the point of this case
                if (url === SERVER) { throw 'just a string'; }
                return allHealthy(url);
            });

            assert.strictEqual(results.serverReachability.response, 'Network error');
        });

        test('a later check still runs after this one rejects', async () => {
            const results = await run(async (url) => {
                if (url === SERVER) { throw new Error('down'); }
                return allHealthy(url);
            });

            assert.strictEqual(results.apiAvailability.status, 'online');
            assert.strictEqual(results.irisService.status, 'online');
        });
    });

    suite('api availability', () => {
        test('status UP reads as healthy', async () => {
            const results = await run(allHealthy);
            assert.deepStrictEqual(results.apiAvailability, {
                status: 'online', message: 'Healthy', endpoint: HEALTH_URL,
                httpStatus: 200, response: 'Backend status: UP',
            });
        });

        test('any other status becomes the message verbatim and reads as offline', async () => {
            const results = await run(async (url) =>
                url === HEALTH_URL ? jsonResponse(200, 'OK', { status: 'DOWN' }) : allHealthy(url));

            assert.deepStrictEqual(results.apiAvailability, {
                status: 'offline', message: 'DOWN', endpoint: HEALTH_URL,
                httpStatus: 200, response: 'Backend status: DOWN',
            });
        });

        test('an absent status falls back to UNKNOWN', async () => {
            const results = await run(async (url) =>
                url === HEALTH_URL ? jsonResponse(200, 'OK', {}) : allHealthy(url));

            assert.strictEqual(results.apiAvailability.message, 'UNKNOWN');
            assert.strictEqual(results.apiAvailability.status, 'offline');
        });

        test('an empty status is falsy and also falls back to UNKNOWN', async () => {
            const results = await run(async (url) =>
                url === HEALTH_URL ? jsonResponse(200, 'OK', { status: '' }) : allHealthy(url));

            assert.strictEqual(results.apiAvailability.message, 'UNKNOWN');
        });

        test('unreadable JSON on a 2xx reads as available, not as a failure', async () => {
            const results = await run(async (url) =>
                url === HEALTH_URL ? unreadableJson(200, 'OK') : allHealthy(url));

            assert.deepStrictEqual(results.apiAvailability, {
                status: 'online', message: 'Available', endpoint: HEALTH_URL,
                httpStatus: 200, response: '200 OK',
            });
        });

        test('a non-2xx reads as offline with the status in the message', async () => {
            const results = await run(async (url) =>
                url === HEALTH_URL ? jsonResponse(503, 'Service Unavailable', {}) : allHealthy(url));

            assert.deepStrictEqual(results.apiAvailability, {
                status: 'offline', message: 'Error 503', endpoint: HEALTH_URL,
                httpStatus: 503, response: '503 Service Unavailable',
            });
        });

        test('a rejection reads as unavailable, and a timeout is distinguished', async () => {
            const plain = await run(async (url) => {
                if (url === HEALTH_URL) { throw new Error('boom'); }
                return allHealthy(url);
            });
            assert.strictEqual(plain.apiAvailability.message, 'Unavailable');
            assert.strictEqual(plain.apiAvailability.status, 'offline');

            calls = [];
            const timedOut = await run(async (url) => {
                if (url === HEALTH_URL) { throw timeoutError(); }
                return allHealthy(url);
            });
            assert.strictEqual(timedOut.apiAvailability.message, 'Timeout');
        });
    });

    suite('iris service', () => {
        test('iris in activeModuleFeatures reads as active', async () => {
            const results = await run(allHealthy);
            assert.deepStrictEqual(results.irisService, {
                status: 'online', message: 'Active', endpoint: INFO_URL,
                httpStatus: 200,
                response: 'Iris module active (1 module features, 0 profiles loaded)',
            });
        });

        test('iris in activeProfiles alone also reads as active', async () => {
            const results = await run(async (url) =>
                url === INFO_URL
                    ? jsonResponse(200, 'OK', { activeModuleFeatures: [], activeProfiles: ['iris', 'prod'] })
                    : allHealthy(url));

            assert.strictEqual(results.irisService.status, 'online');
            assert.strictEqual(results.irisService.message, 'Active');
            assert.strictEqual(
                results.irisService.response,
                'Iris module active (0 module features, 2 profiles loaded)',
            );
        });

        test('iris in neither list reads as OFFLINE, not unknown', async () => {
            const results = await run(async (url) =>
                url === INFO_URL
                    ? jsonResponse(200, 'OK', { activeModuleFeatures: ['foo'], activeProfiles: ['prod'] })
                    : allHealthy(url));

            assert.deepStrictEqual(results.irisService, {
                status: 'offline', message: 'Not enabled', endpoint: INFO_URL,
                httpStatus: 200,
                response: 'Iris not found in activeModuleFeatures or activeProfiles',
            });
        });

        test('unreadable JSON reads as unknown, unlike the health check', async () => {
            const results = await run(async (url) =>
                url === INFO_URL ? unreadableJson(200, 'OK') : allHealthy(url));

            assert.deepStrictEqual(results.irisService, {
                status: 'unknown', message: 'Parse error', endpoint: INFO_URL,
                httpStatus: 200, response: 'Could not parse profile information',
            });
        });

        test('a non-2xx reads as unknown, unlike the health check which reads offline', async () => {
            const results = await run(async (url) =>
                url === INFO_URL ? jsonResponse(404, 'Not Found', {}) : allHealthy(url));

            assert.deepStrictEqual(results.irisService, {
                status: 'unknown', message: 'Error 404', endpoint: INFO_URL,
                httpStatus: 404, response: '404 Not Found',
            });
        });

        test('a rejection reads as unknown, and a timeout is distinguished', async () => {
            const plain = await run(async (url) => {
                if (url === INFO_URL) { throw new Error('boom'); }
                return allHealthy(url);
            });
            assert.strictEqual(plain.irisService.status, 'unknown');
            assert.strictEqual(plain.irisService.message, 'Cannot check');

            calls = [];
            const timedOut = await run(async (url) => {
                if (url === INFO_URL) { throw timeoutError(); }
                return allHealthy(url);
            });
            assert.strictEqual(timedOut.irisService.message, 'Timeout');
        });
    });
});
