import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createRecordingsApi } from '../../server/recordingsApi';
import type { AppConfig } from '../../server/types';
import { makeReq, makeRes, invoke } from './_helpers';

let tmpDir: string;
beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'annot-'));
    fs.mkdirSync(path.join(tmpDir, 'sess-1'));
});
afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

const cfg = (): AppConfig => ({ recordingsDir: tmpDir, liveToken: undefined, allowWrite: true });

describe('POST /api/recordings/:id/annotations', () => {
    it('appends single annotation with referenceEventTimestamp + reactionDelay', async () => {
        const api = createRecordingsApi(cfg());
        const handle = makeRes();
        await invoke(api, makeReq('POST', '/api/recordings/sess-1/annotations',
            JSON.stringify({ label: 'high-struggle', text: '', referenceEventTimestamp: 1_000, reactionDelayMs: 300 })),
            handle);
        expect(handle.captured.status).toBe(200);
        const stored = JSON.parse(fs.readFileSync(path.join(tmpDir, 'sess-1/annotations.json'), 'utf-8'));
        expect(stored).toHaveLength(1);
        expect(stored[0].timestamp).toBe(1_300);
        expect(stored[0].label).toBe('high-struggle');
        expect(typeof stored[0].id).toBe('string');
    });

    it('falls back to serverNow - flushLag when reference missing', async () => {
        const api = createRecordingsApi(cfg());
        const before = Date.now();
        const handle = makeRes();
        await invoke(api, makeReq('POST', '/api/recordings/sess-1/annotations',
            JSON.stringify({ label: 'medium-struggle', text: 'note' })),
            handle);
        expect(handle.captured.status).toBe(200);
        const stored = JSON.parse(fs.readFileSync(path.join(tmpDir, 'sess-1/annotations.json'), 'utf-8'));
        expect(stored[0].timestamp).toBeGreaterThanOrEqual(before - 2_500 - 100);
        expect(stored[0].timestamp).toBeLessThanOrEqual(Date.now() - 2_500 + 100);
    });

    it('preserves existing annotations across calls', async () => {
        fs.writeFileSync(path.join(tmpDir, 'sess-1/annotations.json'),
            JSON.stringify([{ id: 'old', timestamp: 1, text: 'pre', createdAt: 1 }]));
        const api = createRecordingsApi(cfg());
        const handle = makeRes();
        await invoke(api, makeReq('POST', '/api/recordings/sess-1/annotations',
            JSON.stringify({ label: 'blocked', text: '', referenceEventTimestamp: 1_000 })),
            handle);
        expect(handle.captured.status).toBe(200);
        const stored = JSON.parse(fs.readFileSync(path.join(tmpDir, 'sess-1/annotations.json'), 'utf-8'));
        expect(stored).toHaveLength(2);
        expect(stored[0].id).toBe('old');
    });

    it('rejects unknown label values', async () => {
        const api = createRecordingsApi(cfg());
        const handle = makeRes();
        await invoke(api, makeReq('POST', '/api/recordings/sess-1/annotations',
            JSON.stringify({ label: 'invalid-xyz', text: '' })),
            handle);
        expect(handle.captured.status).toBe(400);
    });

    it('clamps future referenceEventTimestamp to (now + 1000)', async () => {
        const api = createRecordingsApi(cfg());
        const future = Date.now() + 60_000_000;
        const handle = makeRes();
        await invoke(api, makeReq('POST', '/api/recordings/sess-1/annotations',
            JSON.stringify({ label: 'confident', text: '', referenceEventTimestamp: future })),
            handle);
        expect(handle.captured.status).toBe(200);
        const stored = JSON.parse(fs.readFileSync(path.join(tmpDir, 'sess-1/annotations.json'), 'utf-8'));
        expect(stored[0].timestamp).toBeLessThanOrEqual(Date.now() + 1500);
    });

    it('refuses to overwrite when annotations.json is corrupt JSON', async () => {
        fs.writeFileSync(path.join(tmpDir, 'sess-1/annotations.json'), 'not json');
        const api = createRecordingsApi(cfg());
        const handle = makeRes();
        await invoke(api, makeReq('POST', '/api/recordings/sess-1/annotations',
            JSON.stringify({ label: 'confident', text: '', referenceEventTimestamp: 1 })),
            handle);
        expect(handle.captured.status).toBe(409);
    });
});
