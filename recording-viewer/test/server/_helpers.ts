// test/server/_helpers.ts
import { Writable } from 'stream';
import type { IncomingRequest, ServerResponse } from '../../server/types';

export interface Captured {
    status: number;
    headers: Record<string, string>;
    body: string;
    written: string[];
    bodyBuf: Buffer;
    endCalled: boolean;
}

export interface MockResHandle {
    res: ServerResponse;
    captured: Captured;
    /** Resolves when res.end is called (or for Writable, when 'finish' fires). */
    done: Promise<void>;
}

export function makeRes(): MockResHandle {
    const captured: Captured = {
        status: 0,
        headers: {},
        body: '',
        written: [],
        bodyBuf: Buffer.alloc(0),
        endCalled: false,
    };
    let resolveDone!: () => void;
    const done = new Promise<void>((r) => {
        resolveDone = r;
    });
    const res: ServerResponse = {
        setHeader: (n, v) => {
            captured.headers[n] = v;
        },
        writeHead: (s) => {
            captured.status = s;
        },
        end: (data) => {
            if (data !== undefined) {
                captured.body += data.toString();
                captured.bodyBuf = Buffer.concat([
                    captured.bodyBuf,
                    Buffer.isBuffer(data) ? data : Buffer.from(String(data)),
                ]);
            }
            // If status was never set explicitly, Node would default to 200 — mirror that.
            if (captured.status === 0) captured.status = 200;
            captured.endCalled = true;
            resolveDone();
        },
        write: (chunk) => {
            captured.written.push(chunk.toString());
            captured.bodyBuf = Buffer.concat([
                captured.bodyBuf,
                Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)),
            ]);
            return true;
        },
    };
    return { res, captured, done };
}

/**
 * Build a real Writable stream that captures status/headers (for routes using
 * fs.createReadStream().pipe(res)). Resolves `done` when the underlying stream
 * emits 'finish'.
 */
export function makeWritableRes(): MockResHandle {
    const captured: Captured = {
        status: 0,
        headers: {},
        body: '',
        written: [],
        bodyBuf: Buffer.alloc(0),
        endCalled: false,
    };
    let resolveDone!: () => void;
    const done = new Promise<void>((r) => {
        resolveDone = r;
    });
    const w = new Writable({
        write(chunk: Buffer | string, _enc: BufferEncoding, cb: () => void) {
            const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            captured.bodyBuf = Buffer.concat([captured.bodyBuf, buf]);
            captured.written.push(buf.toString());
            cb();
        },
    });
    w.on('finish', () => {
        if (captured.status === 0) captured.status = 200;
        captured.endCalled = true;
        resolveDone();
    });
    const res = w as unknown as ServerResponse;
    (res as unknown as { setHeader: (n: string, v: string) => void }).setHeader =
        (n: string, v: string) => {
            captured.headers[n] = v;
        };
    (res as unknown as { writeHead: (s: number) => void }).writeHead = (s: number) => {
        captured.status = s;
    };
    return { res, captured, done };
}

export function makeReq(
    method: string,
    url: string,
    body?: Buffer | string,
    headers: Record<string, string> = {},
): IncomingRequest {
    const dataChunks: Buffer[] = [];
    if (body !== undefined) {
        dataChunks.push(typeof body === 'string' ? Buffer.from(body) : body);
    }
    const handlers: Record<string, Array<(arg?: unknown) => void>> = {};
    return {
        url,
        method,
        headers,
        on(event: string, cb: (arg?: unknown) => void) {
            (handlers[event] ??= []).push(cb);
            // Fire data/end asynchronously after registration of `end`:
            if (event === 'end') {
                queueMicrotask(() => {
                    for (const c of dataChunks) (handlers['data'] ?? []).forEach((h) => h(c));
                    (handlers['end'] ?? []).forEach((h) => h());
                });
            }
        },
        pipe() {
            throw new Error('req.pipe not implemented in test mock');
        },
    } as unknown as IncomingRequest;
}

export type ApiHandlerFn = (req: IncomingRequest, res: ServerResponse, next: () => void) => void;

/**
 * Drive the API handler against a mock req/res. Resolves when the response
 * is "done": res.end was called (or Writable 'finish' fired), OR next() was
 * called, whichever fires first. Rejects if neither happens within
 * `timeoutMs` (a hanging route is a test failure, not a silent green).
 */
export function invoke(
    api: ApiHandlerFn,
    req: IncomingRequest,
    handle: MockResHandle,
    timeoutMs = 1000,
): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        let settled = false;
        const settle = () => {
            if (!settled) {
                settled = true;
                // Yield once via setImmediate so pending I/O kicked off by the
                // route handler (e.g. fs.createWriteStream open events, ws.destroy
                // teardown) can drain before the caller's afterEach hook deletes
                // the tmp dir. Without this, we get spurious unhandled ENOENTs
                // from late-firing 'open' callbacks on already-destroyed streams.
                setImmediate(resolve);
            }
        };
        const t = setTimeout(() => {
            if (!settled) {
                settled = true;
                reject(new Error(`invoke: route did not complete within ${timeoutMs}ms`));
            }
        }, timeoutMs);
        handle.done.then(() => {
            clearTimeout(t);
            settle();
        });
        api(req, handle.res, () => {
            clearTimeout(t);
            settle();
        });
    });
}
