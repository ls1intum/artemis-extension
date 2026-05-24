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
    it('stores annotation with timestamp = serverNow when no explicit timestamp is sent', async () => {
        const api = createRecordingsApi(cfg());
        const before = Date.now();
        const handle = makeRes();
        await invoke(api, makeReq('POST', '/api/recordings/sess-1/annotations',
            JSON.stringify({ label: 'high-struggle', text: '' })),
            handle);
        expect(handle.captured.status).toBe(200);
        const stored = JSON.parse(fs.readFileSync(path.join(tmpDir, 'sess-1/annotations.json'), 'utf-8'));
        expect(stored).toHaveLength(1);
        expect(stored[0].timestamp).toBeGreaterThanOrEqual(before);
        expect(stored[0].timestamp).toBeLessThanOrEqual(Date.now());
        expect(stored[0].timestamp).toBe(stored[0].createdAt);
        expect(stored[0].label).toBe('high-struggle');
        expect(typeof stored[0].id).toBe('string');
    });

    it('respects an explicit timestamp field when provided (redo path)', async () => {
        const api = createRecordingsApi(cfg());
        const explicit = 1_700_000_000_000;
        const before = Date.now();
        const handle = makeRes();
        await invoke(api, makeReq('POST', '/api/recordings/sess-1/annotations',
            JSON.stringify({ label: 'confident', text: 'restored', timestamp: explicit })),
            handle);
        expect(handle.captured.status).toBe(200);
        const stored = JSON.parse(fs.readFileSync(path.join(tmpDir, 'sess-1/annotations.json'), 'utf-8'));
        expect(stored[0].timestamp).toBe(explicit);
        // createdAt is set from server-receive time regardless of explicit timestamp
        expect(stored[0].createdAt).toBeGreaterThanOrEqual(before);
        expect(stored[0].createdAt).toBeLessThanOrEqual(Date.now());
    });

    it('ignores legacy referenceEventTimestamp and reactionDelayMs fields', async () => {
        const api = createRecordingsApi(cfg());
        const before = Date.now();
        const handle = makeRes();
        await invoke(api, makeReq('POST', '/api/recordings/sess-1/annotations',
            JSON.stringify({ label: 'medium-struggle', text: '', referenceEventTimestamp: 1_000, reactionDelayMs: 9_999 })),
            handle);
        expect(handle.captured.status).toBe(200);
        const stored = JSON.parse(fs.readFileSync(path.join(tmpDir, 'sess-1/annotations.json'), 'utf-8'));
        expect(stored[0].timestamp).toBeGreaterThanOrEqual(before);
        expect(stored[0].timestamp).toBeLessThanOrEqual(Date.now());
    });

    it('preserves existing annotations across calls', async () => {
        fs.writeFileSync(path.join(tmpDir, 'sess-1/annotations.json'),
            JSON.stringify([{ id: 'old', timestamp: 1, text: 'pre', createdAt: 1 }]));
        const api = createRecordingsApi(cfg());
        const handle = makeRes();
        await invoke(api, makeReq('POST', '/api/recordings/sess-1/annotations',
            JSON.stringify({ label: 'blocked', text: '' })),
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

    it('rejects non-finite explicit timestamp', async () => {
        const api = createRecordingsApi(cfg());
        const handle = makeRes();
        await invoke(api, makeReq('POST', '/api/recordings/sess-1/annotations',
            JSON.stringify({ label: 'confident', text: '', timestamp: 'not-a-number' })),
            handle);
        expect(handle.captured.status).toBe(400);
    });

    it('rejects negative explicit timestamp', async () => {
        const api = createRecordingsApi(cfg());
        const handle = makeRes();
        await invoke(api, makeReq('POST', '/api/recordings/sess-1/annotations',
            JSON.stringify({ label: 'confident', text: '', timestamp: -1 })),
            handle);
        expect(handle.captured.status).toBe(400);
    });

    it('refuses to overwrite when annotations.json is corrupt JSON', async () => {
        fs.writeFileSync(path.join(tmpDir, 'sess-1/annotations.json'), 'not json');
        const api = createRecordingsApi(cfg());
        const handle = makeRes();
        await invoke(api, makeReq('POST', '/api/recordings/sess-1/annotations',
            JSON.stringify({ label: 'confident', text: '' })),
            handle);
        expect(handle.captured.status).toBe(409);
    });
});
