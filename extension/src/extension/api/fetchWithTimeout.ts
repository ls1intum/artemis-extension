import { CONFIG } from '@extension/utils';

/**
 * `fetch` with a timeout backstop. The native `fetch` has no default timeout, so a
 * server that accepts the connection but never responds would hang the caller forever.
 * Aborts the request after `timeoutMs` (rejecting with a `TimeoutError`); a caller-
 * supplied `options.signal` is honoured in addition to the timeout.
 */
export async function fetchWithTimeout(
    url: string,
    options: RequestInit = {},
    timeoutMs: number = CONFIG.API.REQUEST_TIMEOUT_MS,
): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(
        () => controller.abort(new DOMException('Request timed out', 'TimeoutError')),
        timeoutMs,
    );
    const signal = options.signal
        ? AbortSignal.any([controller.signal, options.signal])
        : controller.signal;
    try {
        return await fetch(url, { ...options, signal });
    } finally {
        clearTimeout(timer);
    }
}
