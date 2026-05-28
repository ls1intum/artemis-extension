import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createRecordingsApi } from '../../server/recordingsApi';
import { makeReq, makeRes, invoke } from './_helpers';
import { SESSION_COOKIE_NAME } from '../../server/auth';

function setup() {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'auth-'));
    const api = createRecordingsApi({
        recordingsDir: tmp,
        liveToken: 'rater-tok',
        researcherToken: 'res-tok',
        sessionSecret: 'x'.repeat(64),
        allowWrite: false,
    });
    return { tmp, api };
}

function extractCookieValue(setCookieHeader: string): string {
    const m = setCookieHeader.match(/^[^=]+=([^;]+)/);
    if (!m) throw new Error('no cookie value');
    return decodeURIComponent(m[1]);
}

describe('POST /api/auth/login', () => {
    it('returns 400 on missing token', async () => {
        const { api } = setup();
        const handle = makeRes();
        await invoke(api, makeReq('POST', '/api/auth/login', JSON.stringify({}), { 'content-type': 'application/json' }), handle);
        expect(handle.captured.status).toBe(400);
    });

    it('returns 401 on unknown token', async () => {
        const { api } = setup();
        const handle = makeRes();
        await invoke(api, makeReq('POST', '/api/auth/login', JSON.stringify({ token: 'wrong', raterName: 'a' }), { 'content-type': 'application/json' }), handle);
        expect(handle.captured.status).toBe(401);
    });

    it('returns 400 when rater token is supplied without raterName', async () => {
        const { api } = setup();
        const handle = makeRes();
        await invoke(api, makeReq('POST', '/api/auth/login', JSON.stringify({ token: 'rater-tok' }), { 'content-type': 'application/json' }), handle);
        expect(handle.captured.status).toBe(400);
        expect(handle.captured.body).toMatch(/rater name/i);
    });

    it('returns 400 when raterName fails normalization', async () => {
        const { api } = setup();
        const handle = makeRes();
        await invoke(api, makeReq('POST', '/api/auth/login', JSON.stringify({ token: 'rater-tok', raterName: '   ' }), { 'content-type': 'application/json' }), handle);
        expect(handle.captured.status).toBe(400);
    });

    it('sets a signed rater cookie on successful rater login', async () => {
        const { api } = setup();
        const handle = makeRes();
        await invoke(api, makeReq('POST', '/api/auth/login', JSON.stringify({ token: 'rater-tok', raterName: 'Alice' }), { 'content-type': 'application/json' }), handle);
        expect(handle.captured.status).toBe(200);
        expect(handle.captured.headers['Set-Cookie']).toBeDefined();
        const value = extractCookieValue(handle.captured.headers['Set-Cookie']);
        expect(value).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    });

    it('sets a researcher cookie when researcher token is used (raterName ignored)', async () => {
        const { api } = setup();
        const handle = makeRes();
        await invoke(api, makeReq('POST', '/api/auth/login', JSON.stringify({ token: 'res-tok' }), { 'content-type': 'application/json' }), handle);
        expect(handle.captured.status).toBe(200);
    });
});

describe('GET /api/auth/status', () => {
    it('returns unauthenticated when no cookie', async () => {
        const { api } = setup();
        const handle = makeRes();
        await invoke(api, makeReq('GET', '/api/auth/status'), handle);
        const json = JSON.parse(handle.captured.body);
        expect(json.authenticated).toBe(false);
        expect(json.role).toBeUndefined();
    });

    it('returns role + raterName when authenticated as rater', async () => {
        const { api } = setup();
        const loginHandle = makeRes();
        await invoke(api, makeReq('POST', '/api/auth/login', JSON.stringify({ token: 'rater-tok', raterName: 'Alice' }), { 'content-type': 'application/json' }), loginHandle);
        const cookie = extractCookieValue(loginHandle.captured.headers['Set-Cookie']);
        const statusHandle = makeRes();
        await invoke(api, makeReq('GET', '/api/auth/status', undefined, { cookie: `${SESSION_COOKIE_NAME}=${cookie}` }), statusHandle);
        const json = JSON.parse(statusHandle.captured.body);
        expect(json.authenticated).toBe(true);
        expect(json.role).toBe('rater');
        expect(json.raterName).toBe('Alice');
    });
});
