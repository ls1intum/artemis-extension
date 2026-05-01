import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createRecordingsApi } from '../../server/recordingsApi';
import type { AppConfig } from '../../server/types';
import { makeReq, makeRes, invoke } from './_helpers';

let tmpDir: string;
beforeEach(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'auth-gate-')); });
afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

const baseConfig = (overrides: Partial<AppConfig> = {}): AppConfig => ({
    recordingsDir: tmpDir, liveToken: undefined, allowWrite: true, ...overrides,
});

describe('auth gate', () => {
    it('allows recordings access when no token configured', async () => {
        const api = createRecordingsApi(baseConfig());
        const handle = makeRes();
        await invoke(api, makeReq('GET', '/api/recordings'), handle);
        expect(handle.captured.status).toBe(200);
    });

    it('blocks recordings access without cookie when token configured', async () => {
        const api = createRecordingsApi(baseConfig({ liveToken: 'secret' }));
        const handle = makeRes();
        await invoke(api, makeReq('GET', '/api/recordings'), handle);
        expect(handle.captured.status).toBe(401);
    });

    it('login with correct token returns Set-Cookie', async () => {
        const api = createRecordingsApi(baseConfig({ liveToken: 'secret' }));
        const handle = makeRes();
        await invoke(api, makeReq('POST', '/api/auth/login', JSON.stringify({ token: 'secret' })), handle);
        expect(handle.captured.status).toBe(200);
        expect(handle.captured.headers['Set-Cookie']).toMatch(/recording_viewer_session=secret/);
    });

    it('login with wrong token returns 401', async () => {
        const api = createRecordingsApi(baseConfig({ liveToken: 'secret' }));
        const handle = makeRes();
        await invoke(api, makeReq('POST', '/api/auth/login', JSON.stringify({ token: 'wrong' })), handle);
        expect(handle.captured.status).toBe(401);
    });

    it('cookie passes auth gate', async () => {
        const api = createRecordingsApi(baseConfig({ liveToken: 'secret' }));
        const handle = makeRes();
        await invoke(api, makeReq('GET', '/api/recordings', undefined, { cookie: 'recording_viewer_session=secret' }), handle);
        expect(handle.captured.status).toBe(200);
    });

    it('blocks DELETE /recordings/:id when allowWrite=false', async () => {
        const api = createRecordingsApi(baseConfig({ liveToken: 't', allowWrite: false }));
        const handle = makeRes();
        await invoke(api, makeReq('DELETE', '/api/recordings/some-id', undefined, { cookie: 'recording_viewer_session=t' }), handle);
        expect(handle.captured.status).toBe(403);
    });

    it('blocks PUT /recordings/:id/annotations (full-replace) when allowWrite=false', async () => {
        const api = createRecordingsApi(baseConfig({ liveToken: 't', allowWrite: false }));
        const handle = makeRes();
        await invoke(api, makeReq('PUT', '/api/recordings/sess-1/annotations', '[]', { cookie: 'recording_viewer_session=t' }), handle);
        expect(handle.captured.status).toBe(403);
    });

    it('allows POST /recordings/:id/annotations even when allowWrite=false (live tagging)', async () => {
        const api = createRecordingsApi(baseConfig({ liveToken: 't', allowWrite: false }));
        fs.mkdirSync(path.join(tmpDir, 'sess-1'));
        const handle = makeRes();
        await invoke(api, makeReq('POST', '/api/recordings/sess-1/annotations',
            JSON.stringify({ label: 'high-struggle', text: '' }),
            { cookie: 'recording_viewer_session=t' }), handle);
        // Endpoint will be implemented in Task 11; for now, gate must pass through.
        // 200 or 404 are both acceptable here. NOT 403, NOT 401.
        expect(handle.captured.status).not.toBe(403);
        expect(handle.captured.status).not.toBe(401);
    });

    it('status endpoint reports unauthenticated when token configured but no cookie', async () => {
        const api = createRecordingsApi(baseConfig({ liveToken: 'secret', allowWrite: false }));
        const handle = makeRes();
        await invoke(api, makeReq('GET', '/api/auth/status'), handle);
        expect(handle.captured.status).toBe(200);
        const json = JSON.parse(handle.captured.body);
        expect(json).toEqual({ authenticated: false, authRequired: true, allowWrite: false });
    });

    it('status endpoint reports allowWrite=true when configured', async () => {
        const api = createRecordingsApi(baseConfig({ allowWrite: true }));
        const handle = makeRes();
        await invoke(api, makeReq('GET', '/api/auth/status'), handle);
        const json = JSON.parse(handle.captured.body);
        expect(json.allowWrite).toBe(true);
    });
});
