import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createRecordingsApi } from '../../server/recordingsApi';
import type { IncomingRequest, ServerResponse, AppConfig } from '../../server/types';

let tmpDir: string;
beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sse-'));
    fs.mkdirSync(path.join(tmpDir, 'sess-1'));
    fs.writeFileSync(path.join(tmpDir, 'sess-1/events.jsonl'), '{"type":"a","timestamp":1}\n{"type":"b","timestamp":2}\n');
});
afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

interface MockRes {
    headers: Record<string, string>;
    status: number;
    written: string[];
    ended: boolean;
    closeCallbacks: Array<() => void>;
}

function makeStreamReqRes(): { req: IncomingRequest; res: ServerResponse; captured: MockRes; triggerClose: () => void } {
    const captured: MockRes = { headers: {}, status: 0, written: [], ended: false, closeCallbacks: [] };
    const reqHandlers: Record<string, Array<() => void>> = {};
    const res: ServerResponse = {
        setHeader: (n, v) => { captured.headers[n] = v; },
        writeHead: (s) => { captured.status = s; },
        end: () => { captured.ended = true; },
        write: (chunk) => { captured.written.push(chunk.toString()); return true; },
    };
    const req = {
        url: '/api/recordings/sess-1/events/stream',
        method: 'GET',
        headers: {},
        on(event: string, cb: () => void) {
            (reqHandlers[event] ??= []).push(cb);
            if (event === 'close') captured.closeCallbacks.push(cb);
        },
        pipe() {},
    } as unknown as IncomingRequest;
    const triggerClose = () => captured.closeCallbacks.forEach(cb => cb());
    return { req, res, captured, triggerClose };
}

const cfg = (): AppConfig => ({ recordingsDir: tmpDir, liveToken: undefined, allowWrite: true });

async function waitFor(predicate: () => boolean, timeoutMs = 2500, stepMs = 50): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        if (predicate()) return true;
        await new Promise(r => setTimeout(r, stepMs));
    }
    return predicate();
}

describe('SSE /api/recordings/:id/events/stream', () => {
    it('streams existing events on connect with id: line numbers', async () => {
        const api = createRecordingsApi(cfg());
        const { req, res, captured, triggerClose } = makeStreamReqRes();
        api(req, res, () => {});
        try {
            const ok = await waitFor(() => captured.written.join('').includes('id: 2'));
            expect(ok).toBe(true);
            const body = captured.written.join('');
            expect(body).toMatch(/^: stream open/);
            expect(body).toMatch(/id: 1\ndata: \{"type":"a","timestamp":1\}/);
            expect(body).toMatch(/id: 2\ndata: \{"type":"b","timestamp":2\}/);
        } finally {
            triggerClose();
        }
    });

    it('cleanup is idempotent: triggering close twice does not error', async () => {
        const api = createRecordingsApi(cfg());
        const { req, res, triggerClose } = makeStreamReqRes();
        api(req, res, () => {});
        await new Promise(r => setTimeout(r, 200));
        triggerClose();
        triggerClose(); // second close should be a no-op
        expect(true).toBe(true);
    });

    it('returns 404 when session does not exist', async () => {
        const api = createRecordingsApi(cfg());
        const { req, res, captured } = makeStreamReqRes();
        (req as unknown as { url: string }).url = '/api/recordings/nonexistent/events/stream';
        api(req, res, () => {});
        await new Promise(r => setTimeout(r, 50));
        expect(captured.status).toBe(404);
    });
});
