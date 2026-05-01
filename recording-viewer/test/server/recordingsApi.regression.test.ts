// test/server/recordingsApi.regression.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { Writable } from 'stream';
import { createRecordingsApi } from '../../server/recordingsApi';
import type { AppConfig, IncomingRequest, ServerResponse } from '../../server/types';

let tmpDir: string;
let api: (req: IncomingRequest, res: ServerResponse, next: () => void) => void;

function makeApi(overrides: Partial<AppConfig> = {}) {
    return createRecordingsApi({
        recordingsDir: tmpDir,
        liveToken: undefined,
        allowWrite: true,
        ...overrides,
    });
}

interface Captured { status: number; headers: Record<string, string>; body: string; written: string[]; bodyBuf: Buffer }
function makeRes(): { res: ServerResponse; captured: Captured } {
    const captured: Captured = { status: 200, headers: {}, body: '', written: [], bodyBuf: Buffer.alloc(0) };
    const res: ServerResponse = {
        setHeader: (n, v) => { captured.headers[n] = v; },
        writeHead: (s) => { captured.status = s; },
        end: (data) => {
            if (data) {
                captured.body = data.toString();
                captured.bodyBuf = Buffer.concat([captured.bodyBuf, Buffer.isBuffer(data) ? data : Buffer.from(data.toString())]);
            }
        },
        write: (chunk) => {
            captured.written.push(chunk.toString());
            captured.bodyBuf = Buffer.concat([captured.bodyBuf, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]);
            return true;
        },
    };
    return { res, captured };
}

/** Build a real Writable stream that captures status/headers (for routes using fs.createReadStream().pipe(res)). ESM-clean (top-level import). */
function makeWritableRes() {
    const captured: Captured = { status: 200, headers: {}, body: '', written: [], bodyBuf: Buffer.alloc(0) };
    const w = new Writable({
        write(chunk: Buffer | string, _enc: BufferEncoding, cb: () => void) {
            const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            captured.bodyBuf = Buffer.concat([captured.bodyBuf, buf]);
            captured.written.push(buf.toString());
            cb();
        },
    }) as unknown as ServerResponse & { setHeader: (n: string, v: string) => void };
    (w as unknown as { setHeader: (n: string, v: string) => void; writeHead: (s: number) => void }).setHeader =
        (n: string, v: string) => { captured.headers[n] = v; };
    (w as unknown as { writeHead: (s: number) => void }).writeHead = (s: number) => { captured.status = s; };
    return { res: w as ServerResponse, captured };
}

function makeReq(method: string, url: string, body?: Buffer | string, headers: Record<string, string> = {}): IncomingRequest {
    const dataChunks: Buffer[] = [];
    if (body !== undefined) dataChunks.push(typeof body === 'string' ? Buffer.from(body) : body);
    const handlers: Record<string, Array<(arg?: unknown) => void>> = {};
    return {
        url, method, headers,
        on(event: string, cb: (arg?: unknown) => void) {
            (handlers[event] ??= []).push(cb);
            // Fire data/end synchronously after registration of `end`:
            if (event === 'end') {
                queueMicrotask(() => {
                    for (const c of dataChunks) (handlers['data'] ?? []).forEach(h => h(c));
                    (handlers['end'] ?? []).forEach(h => h());
                });
            }
        },
        pipe() {},
    } as unknown as IncomingRequest;
}

beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'regress-test-'));
    api = makeApi();
});
afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

async function invoke(req: IncomingRequest, res: ServerResponse): Promise<void> {
    return new Promise((resolve) => {
        api(req, res, () => resolve());
        // Some routes write synchronously, some after end; settle the loop:
        setTimeout(resolve, 80);
    });
}

describe('GET /api/recordings (sessions list)', () => {
    it('returns empty array when recordings dir does not exist', async () => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
        const { res, captured } = makeRes();
        await invoke(makeReq('GET', '/api/recordings'), res);
        expect(captured.status).toBe(200);
        expect(JSON.parse(captured.body).sessions).toEqual([]);
    });

    it('lists session directories with metadata when present', async () => {
        fs.mkdirSync(path.join(tmpDir, 'sess-1'));
        fs.writeFileSync(path.join(tmpDir, 'sess-1/metadata.json'), JSON.stringify({ startTime: 5, endTime: 6 }));
        const { res, captured } = makeRes();
        await invoke(makeReq('GET', '/api/recordings'), res);
        const parsed = JSON.parse(captured.body);
        expect(parsed.sessions).toHaveLength(1);
        expect(parsed.sessions[0].id).toBe('sess-1');
        expect(parsed.sessions[0].metadata.endTime).toBe(6);
    });

    it('includes session dirs without metadata.json', async () => {
        fs.mkdirSync(path.join(tmpDir, 'sess-no-meta'));
        const { res, captured } = makeRes();
        await invoke(makeReq('GET', '/api/recordings'), res);
        expect(JSON.parse(captured.body).sessions[0].metadata).toBeNull();
    });
});

describe('GET /api/recordings/:id/events', () => {
    it('parses JSONL into array', async () => {
        fs.mkdirSync(path.join(tmpDir, 'sess-1'));
        fs.writeFileSync(path.join(tmpDir, 'sess-1/events.jsonl'), '{"a":1}\n{"a":2}\n');
        const { res, captured } = makeRes();
        await invoke(makeReq('GET', '/api/recordings/sess-1/events'), res);
        expect(captured.status).toBe(200);
        expect(JSON.parse(captured.body)).toEqual([{ a: 1 }, { a: 2 }]);
    });

    it('returns 404 when events.jsonl missing', async () => {
        fs.mkdirSync(path.join(tmpDir, 'sess-1'));
        const { res, captured } = makeRes();
        await invoke(makeReq('GET', '/api/recordings/sess-1/events'), res);
        expect(captured.status).toBe(404);
    });
});

describe('subtitle SRT→VTT conversion', () => {
    it('converts uploaded SRT to VTT on disk', async () => {
        fs.mkdirSync(path.join(tmpDir, 'sess-1'));
        const srt = '1\n00:00:01,000 --> 00:00:02,500\nHallo\n\n';
        const { res, captured } = makeRes();
        await invoke(makeReq('PUT', '/api/recordings/sess-1/subtitles', srt, { 'content-type': 'application/x-subrip' }), res);
        expect(captured.status).toBe(200);
        const written = fs.readFileSync(path.join(tmpDir, 'sess-1/video.vtt'), 'utf-8');
        expect(written).toMatch(/^WEBVTT/);
        expect(written).toMatch(/00:00:01\.000 --> 00:00:02\.500/);
    });

    it('rejects unrecognised subtitle format', async () => {
        fs.mkdirSync(path.join(tmpDir, 'sess-1'));
        const { res, captured } = makeRes();
        await invoke(makeReq('PUT', '/api/recordings/sess-1/subtitles', 'not subtitles', { 'content-type': 'text/plain' }), res);
        expect(captured.status).toBe(400);
    });
});

describe('annotation persistence', () => {
    it('PUT annotations writes the array to disk', async () => {
        fs.mkdirSync(path.join(tmpDir, 'sess-1'));
        const body = JSON.stringify([{ id: 'a', timestamp: 1, text: 'note', createdAt: 1 }]);
        const { res, captured } = makeRes();
        await invoke(makeReq('PUT', '/api/recordings/sess-1/annotations', body), res);
        expect(captured.status).toBe(200);
        const stored = JSON.parse(fs.readFileSync(path.join(tmpDir, 'sess-1/annotations.json'), 'utf-8'));
        expect(stored).toHaveLength(1);
    });
});

describe('video serving (Range / HEAD)', () => {
    function writeFakeMp4(p: string, sizeBytes: number) {
        const buf = Buffer.alloc(sizeBytes, 0x00);
        buf.write('ftyp', 4, 'ascii');
        fs.writeFileSync(p, buf);
        fs.writeFileSync(path.join(path.dirname(p), 'video-sync.json'),
            JSON.stringify({ videoTimeAtSessionStartSeconds: 0, videoExtension: 'mp4' }));
    }

    it('HEAD /video returns Content-Length without body', async () => {
        fs.mkdirSync(path.join(tmpDir, 'sess-1'));
        writeFakeMp4(path.join(tmpDir, 'sess-1/video.mp4'), 1024);
        const { res, captured } = makeRes();
        await invoke(makeReq('HEAD', '/api/recordings/sess-1/video'), res);
        expect(captured.status).toBe(200);
        expect(captured.headers['Content-Length']).toBe('1024');
        expect(captured.headers['Accept-Ranges']).toBe('bytes');
        expect(captured.body).toBe('');
    });

    it('GET /video with Range returns 206 and the requested byte range', async () => {
        fs.mkdirSync(path.join(tmpDir, 'sess-1'));
        writeFakeMp4(path.join(tmpDir, 'sess-1/video.mp4'), 100);
        const { res, captured } = makeWritableRes();
        const req = makeReq('GET', '/api/recordings/sess-1/video', undefined, { range: 'bytes=10-19' });
        api(req, res, () => {});
        await new Promise(r => setTimeout(r, 100));
        expect(captured.status).toBe(206);
        expect(captured.headers['Content-Range']).toBe('bytes 10-19/100');
        expect(captured.headers['Content-Length']).toBe('10');
        expect(captured.bodyBuf.length).toBe(10);
    });

    it('GET /video with malformed Range returns 416', async () => {
        fs.mkdirSync(path.join(tmpDir, 'sess-1'));
        writeFakeMp4(path.join(tmpDir, 'sess-1/video.mp4'), 100);
        const { res, captured } = makeRes();
        await invoke(makeReq('GET', '/api/recordings/sess-1/video', undefined, { range: 'invalid-range' }), res);
        expect(captured.status).toBe(416);
        expect(captured.headers['Content-Range']).toBe('bytes */100');
    });

    it('GET /video with out-of-bounds Range returns 416', async () => {
        fs.mkdirSync(path.join(tmpDir, 'sess-1'));
        writeFakeMp4(path.join(tmpDir, 'sess-1/video.mp4'), 100);
        const { res, captured } = makeRes();
        await invoke(makeReq('GET', '/api/recordings/sess-1/video', undefined, { range: 'bytes=200-300' }), res);
        expect(captured.status).toBe(416);
    });
});

describe('video upload validation', () => {
    it('rejects non-MP4 magic bytes for video/mp4 content-type', async () => {
        fs.mkdirSync(path.join(tmpDir, 'sess-1'));
        const bogusBody = Buffer.from('not-an-mp4-at-all-not-even-close');
        const { res, captured } = makeRes();
        await invoke(makeReq('PUT', '/api/recordings/sess-1/video', bogusBody, { 'content-type': 'video/mp4' }), res);
        expect(captured.status).toBe(400);
        expect(captured.body).toMatch(/bad magic bytes/);
        expect(fs.existsSync(path.join(tmpDir, 'sess-1/video.mp4'))).toBe(false);
    });

    it('rejects unsupported content-type', async () => {
        fs.mkdirSync(path.join(tmpDir, 'sess-1'));
        const { res, captured } = makeRes();
        await invoke(makeReq('PUT', '/api/recordings/sess-1/video', Buffer.from('xx'), { 'content-type': 'video/avi' }), res);
        expect(captured.status).toBe(400);
    });
});
