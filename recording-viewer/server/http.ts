import type { ServerResponse, IncomingRequest } from './types';

export function sendJson(res: ServerResponse, status: number, data: unknown): void {
    res.setHeader('Content-Type', 'application/json');
    if (status !== 200) res.writeHead(status);
    res.end(JSON.stringify(data));
}

/**
 * Parse the Cookie header into a name→value map. Tolerates malformed
 * percent-encoding by falling back to the raw value rather than throwing.
 */
export function parseCookies(req: IncomingRequest): Record<string, string> {
    const header = req.headers?.cookie;
    if (typeof header !== 'string') return {};
    const out: Record<string, string> = {};
    for (const pair of header.split(';')) {
        const idx = pair.indexOf('=');
        if (idx === -1) continue;
        const k = pair.slice(0, idx).trim();
        const rawV = pair.slice(idx + 1).trim();
        if (!k) continue;
        let v: string;
        try { v = decodeURIComponent(rawV); } catch { v = rawV; }
        out[k] = v;
    }
    return out;
}

/**
 * Read a JSON body from a request, capped at maxBytes. Rejects on overrun
 * or parse error. Caller is responsible for sending the appropriate error.
 */
export async function readJsonBody(req: IncomingRequest, maxBytes = 65_536): Promise<unknown> {
    return new Promise((resolve, reject) => {
        let body = '';
        let total = 0;
        let done = false;
        req.on('data', (chunk: Buffer) => {
            if (done) return;
            total += chunk.length;
            if (total > maxBytes) {
                done = true;
                reject(new Error('Body too large'));
                return;
            }
            body += chunk.toString();
        });
        req.on('end', () => {
            if (done) return;
            done = true;
            try { resolve(JSON.parse(body)); } catch (err) { reject(err); }
        });
        req.on('error', () => {
            if (done) return;
            done = true;
            reject(new Error('Request error'));
        });
    });
}
