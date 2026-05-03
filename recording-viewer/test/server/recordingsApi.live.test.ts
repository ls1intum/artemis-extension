import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createRecordingsApi } from '../../server/recordingsApi';
import type { AppConfig } from '../../server/types';
import { makeReq, makeRes, invoke } from './_helpers';

let tmpDir: string;
beforeEach(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'live-')); });
afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

const config = (): AppConfig => ({ recordingsDir: tmpDir, liveToken: undefined, allowWrite: true });

describe('GET /api/live/sessions', () => {
    it('returns empty when no sessions exist', async () => {
        const api = createRecordingsApi(config());
        const handle = makeRes();
        await invoke(api, makeReq('GET', '/api/live/sessions'), handle);
        expect(handle.captured.status).toBe(200);
        expect(JSON.parse(handle.captured.body).sessions).toEqual([]);
    });

    it('includes session with no metadata and fresh events.jsonl mtime', async () => {
        fs.mkdirSync(path.join(tmpDir, 'sess-fresh'));
        fs.writeFileSync(path.join(tmpDir, 'sess-fresh/events.jsonl'), '');
        const api = createRecordingsApi(config());
        const handle = makeRes();
        await invoke(api, makeReq('GET', '/api/live/sessions'), handle);
        const ids = JSON.parse(handle.captured.body).sessions.map((s: { id: string }) => s.id);
        expect(ids).toContain('sess-fresh');
    });

    it('excludes session with stale events.jsonl (old mtime, no metadata)', async () => {
        fs.mkdirSync(path.join(tmpDir, 'sess-stale'));
        const p = path.join(tmpDir, 'sess-stale/events.jsonl');
        fs.writeFileSync(p, '');
        const old = (Date.now() - 60 * 60_000) / 1000; // 60 min old (well beyond 15-min window)
        fs.utimesSync(p, old, old);
        const api = createRecordingsApi(config());
        const handle = makeRes();
        await invoke(api, makeReq('GET', '/api/live/sessions'), handle);
        expect(JSON.parse(handle.captured.body).sessions).toEqual([]);
    });

    it('excludes session with metadata.endTime set (already ended)', async () => {
        fs.mkdirSync(path.join(tmpDir, 'sess-ended'));
        fs.writeFileSync(path.join(tmpDir, 'sess-ended/events.jsonl'), '');
        fs.writeFileSync(path.join(tmpDir, 'sess-ended/metadata.json'), JSON.stringify({ endTime: 12345 }));
        const api = createRecordingsApi(config());
        const handle = makeRes();
        await invoke(api, makeReq('GET', '/api/live/sessions'), handle);
        expect(JSON.parse(handle.captured.body).sessions).toEqual([]);
    });
});
