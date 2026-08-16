import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createRecordingsApi } from '../../server/recordingsApi';
import type { IncomingRequest, ServerResponse, AppConfig } from '../../server/types';

let tmpDir: string;
beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sse-catchup-'));
    fs.mkdirSync(path.join(tmpDir, 'sess-1'));
    // Build 50 lines with stable line numbers
    const lines: string[] = [];
    for (let i = 1; i <= 50; i++) lines.push(JSON.stringify({ n: i, type: 'noop', timestamp: i }));
    fs.writeFileSync(path.join(tmpDir, 'sess-1/events.jsonl'), lines.join('\n') + '\n');
});
afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

interface MockRes {
    headers: Record<string, string>;
    status: number;
    written: string[];
    ended: boolean;
    closeCallbacks: Array<() => void>;
}

function makeStreamReqRes(url: string, headers: Record<string, string> = {}): {
    req: IncomingRequest; res: ServerResponse; captured: MockRes; triggerClose: () => void;
} {
    const captured: MockRes = { headers: {}, status: 0, written: [], ended: false, closeCallbacks: [] };
    const res: ServerResponse = {
        setHeader: (n, v) => { captured.headers[n] = v; },
        writeHead: (s) => { captured.status = s; },
        end: () => { captured.ended = true; },
        write: (chunk) => { captured.written.push(chunk.toString()); return true; },
    };
    const req = {
        url,
        method: 'GET',
        headers,
        on(event: string, cb: () => void) {
            if (event === 'close') captured.closeCallbacks.push(cb);
        },
        pipe() {},
    } as unknown as IncomingRequest;
    const triggerClose = () => captured.closeCallbacks.forEach(cb => cb());
    return { req, res, captured, triggerClose };
}

const cfg = (): AppConfig => ({ recordingsDir: tmpDir, liveToken: undefined, allowWrite: true });

async function waitFor(predicate: () => boolean, timeoutMs = 3000, stepMs = 50): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        if (predicate()) return true;
        await new Promise(r => setTimeout(r, stepMs));
    }
    return predicate();
}

function extractLineNos(written: string[]): number[] {
    const body = written.join('');
    const matches = body.matchAll(/^id: (\d+)$/gm);
    return Array.from(matches, (m) => Number.parseInt(m[1], 10));
}

describe('SSE catch-up + Last-Event-ID', () => {
    it('default connect tails the last SSE_DEFAULT_TAIL lines (here, all 50)', async () => {
        const api = createRecordingsApi(cfg());
        const { req, res, captured, triggerClose } = makeStreamReqRes('/api/recordings/sess-1/events/stream');
        api(req, res, () => {});
        try {
            const ok = await waitFor(() => extractLineNos(captured.written).length >= 50);
            expect(ok).toBe(true);
            const ids = extractLineNos(captured.written);
            expect(ids[0]).toBe(1);
            expect(ids[ids.length - 1]).toBe(50);
        } finally {
            triggerClose();
        }
    });

    it('tail=5 query limits catch-up to the last 5 lines', async () => {
        const api = createRecordingsApi(cfg());
        const { req, res, captured, triggerClose } = makeStreamReqRes('/api/recordings/sess-1/events/stream?tail=5');
        api(req, res, () => {});
        try {
            const ok = await waitFor(() => extractLineNos(captured.written).length >= 5);
            expect(ok).toBe(true);
            const ids = extractLineNos(captured.written);
            expect(ids).toEqual([46, 47, 48, 49, 50]);
        } finally {
            triggerClose();
        }
    });

    it('Last-Event-ID header resumes from after the given line', async () => {
        const api = createRecordingsApi(cfg());
        const { req, res, captured, triggerClose } = makeStreamReqRes(
            '/api/recordings/sess-1/events/stream',
            { 'last-event-id': '47' },
        );
        api(req, res, () => {});
        try {
            const ok = await waitFor(() => extractLineNos(captured.written).length >= 3);
            expect(ok).toBe(true);
            const ids = extractLineNos(captured.written);
            expect(ids).toEqual([48, 49, 50]);
        } finally {
            triggerClose();
        }
    });

    it('Last-Event-ID >= last file line yields empty catch-up', async () => {
        const api = createRecordingsApi(cfg());
        const { req, res, captured, triggerClose } = makeStreamReqRes(
            '/api/recordings/sess-1/events/stream',
            { 'last-event-id': '100' },
        );
        api(req, res, () => {});
        try {
            // Wait briefly to let catch-up run; we expect NO id frames.
            await new Promise(r => setTimeout(r, 200));
            const ids = extractLineNos(captured.written);
            expect(ids).toEqual([]);
            // Stream itself should still be open.
            expect(captured.status).toBe(200);
            expect(captured.written.join('')).toMatch(/^: stream open/);
        } finally {
            triggerClose();
        }
    });

    it('tail param with invalid value returns 400', async () => {
        const api = createRecordingsApi(cfg());
        const { req, res, captured } = makeStreamReqRes('/api/recordings/sess-1/events/stream?tail=notanumber');
        api(req, res, () => {});
        await new Promise(r => setTimeout(r, 50));
        expect(captured.status).toBe(400);
    });

    it('tail=0 sends no historical lines (does not flood via gap re-read)', async () => {
        const api = createRecordingsApi(cfg());
        const { req, res, captured, triggerClose } = makeStreamReqRes(
            '/api/recordings/sess-1/events/stream?tail=0',
        );
        api(req, res, () => {});
        try {
            // Give the catch-up async work time to run.
            await new Promise(r => setTimeout(r, 250));
            const ids = extractLineNos(captured.written);
            expect(ids).toEqual([]);
            // Stream itself is open.
            expect(captured.status).toBe(200);
        } finally {
            triggerClose();
        }
    });

    it('catch-up does not duplicate when both Last-Event-ID and live lines overlap', async () => {
        // Simulate: client has Last-Event-ID=47, tailer is constructed when
        // first acquire happens. Catch-up sends 48-50. Tailer is already at
        // EOF (startAtEnd), so live buffer is empty. We just need NO
        // duplicates of 48-50.
        const api = createRecordingsApi(cfg());
        const { req, res, captured, triggerClose } = makeStreamReqRes(
            '/api/recordings/sess-1/events/stream',
            { 'last-event-id': '47' },
        );
        api(req, res, () => {});
        try {
            const ok = await waitFor(() => extractLineNos(captured.written).length >= 3);
            expect(ok).toBe(true);
            const ids = extractLineNos(captured.written);
            expect(new Set(ids).size).toBe(ids.length);
        } finally {
            triggerClose();
        }
    });
});
