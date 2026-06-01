import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createRecordingsApi } from '../../server/recordingsApi';
import { makeReq, makeRes, invoke } from './_helpers';

let tmpDir: string;
beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tail-'));
    fs.mkdirSync(path.join(tmpDir, 'sess-1'));
    // Build a known events.jsonl: lines 1..100
    const lines: string[] = [];
    for (let i = 1; i <= 100; i++) lines.push(JSON.stringify({ n: i, type: 'noop', timestamp: i }));
    fs.writeFileSync(path.join(tmpDir, 'sess-1/events.jsonl'), lines.join('\n') + '\n');
});
afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

describe('GET /api/recordings/:id/events tail behavior', () => {
    it('returns full archive when no tail param', async () => {
        const api = createRecordingsApi({ recordingsDir: tmpDir, allowWrite: true });
        const req = makeReq('GET', '/api/recordings/sess-1/events');
        const handle = makeRes();
        await invoke(api, req, handle);
        expect(handle.captured.status).toBe(200);
        const events = JSON.parse(handle.captured.body) as Array<{ n: number }>;
        expect(events).toHaveLength(100);
        expect(events[0].n).toBe(1);
        expect(events[99].n).toBe(100);
    });

    it('tail=10 returns last 10 events only', async () => {
        const api = createRecordingsApi({ recordingsDir: tmpDir, allowWrite: true });
        const req = makeReq('GET', '/api/recordings/sess-1/events?tail=10');
        const handle = makeRes();
        await invoke(api, req, handle);
        expect(handle.captured.status).toBe(200);
        const events = JSON.parse(handle.captured.body) as Array<{ n: number }>;
        expect(events).toHaveLength(10);
        expect(events[0].n).toBe(91);
        expect(events[9].n).toBe(100);
    });

    it('tail=0 returns empty array', async () => {
        const api = createRecordingsApi({ recordingsDir: tmpDir, allowWrite: true });
        const req = makeReq('GET', '/api/recordings/sess-1/events?tail=0');
        const handle = makeRes();
        await invoke(api, req, handle);
        expect(handle.captured.status).toBe(200);
        const events = JSON.parse(handle.captured.body) as unknown[];
        expect(events).toEqual([]);
    });

    it('tail=999999 clamps to file size (returns all 100)', async () => {
        const api = createRecordingsApi({ recordingsDir: tmpDir, allowWrite: true });
        const req = makeReq('GET', '/api/recordings/sess-1/events?tail=999999');
        const handle = makeRes();
        await invoke(api, req, handle);
        expect(handle.captured.status).toBe(200);
        const events = JSON.parse(handle.captured.body) as Array<{ n: number }>;
        expect(events).toHaveLength(100);
    });

    it('tail with invalid value returns 400', async () => {
        const api = createRecordingsApi({ recordingsDir: tmpDir, allowWrite: true });
        const req = makeReq('GET', '/api/recordings/sess-1/events?tail=abc');
        const handle = makeRes();
        await invoke(api, req, handle);
        expect(handle.captured.status).toBe(400);
    });

    it('tail with negative value returns 400', async () => {
        const api = createRecordingsApi({ recordingsDir: tmpDir, allowWrite: true });
        const req = makeReq('GET', '/api/recordings/sess-1/events?tail=-5');
        const handle = makeRes();
        await invoke(api, req, handle);
        expect(handle.captured.status).toBe(400);
    });
});
