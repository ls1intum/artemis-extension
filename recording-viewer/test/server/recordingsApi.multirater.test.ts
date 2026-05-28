import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createRecordingsApi } from '../../server/recordingsApi';
import { makeReq, makeRes, invoke } from './_helpers';
import { SESSION_COOKIE_NAME } from '../../server/auth';

interface TestSetup {
    tmp: string;
    sessionDir: string;
    sessionId: string;
    api: ReturnType<typeof createRecordingsApi>;
}

let s: TestSetup;
beforeEach(() => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-'));
    const sessionId = 'sess1';
    const sessionDir = path.join(tmp, sessionId);
    fs.mkdirSync(sessionDir);
    fs.writeFileSync(path.join(sessionDir, 'metadata.json'), JSON.stringify({ sessionId, exerciseId: 1, startTime: 1000 }));
    fs.writeFileSync(path.join(sessionDir, 'events.jsonl'), '');
    const api = createRecordingsApi({
        recordingsDir: tmp,
        liveToken: 'rt',
        researcherToken: 'rs',
        sessionSecret: 'z'.repeat(64),
        allowWrite: false,
    });
    s = { tmp, sessionDir, sessionId, api };
});
afterEach(() => { fs.rmSync(s.tmp, { recursive: true, force: true }); });

async function loginAsRater(name: string): Promise<string> {
    const h = makeRes();
    await invoke(s.api, makeReq('POST', '/api/auth/login', JSON.stringify({ token: 'rt', raterName: name }), { 'content-type': 'application/json' }), h);
    const cookieHeader = h.captured.headers['Set-Cookie'];
    const m = cookieHeader.match(/^[^=]+=([^;]+)/);
    return `${SESSION_COOKIE_NAME}=${decodeURIComponent(m![1])}`;
}
async function loginAsResearcher(): Promise<string> {
    const h = makeRes();
    await invoke(s.api, makeReq('POST', '/api/auth/login', JSON.stringify({ token: 'rs' }), { 'content-type': 'application/json' }), h);
    const cookieHeader = h.captured.headers['Set-Cookie'];
    const m = cookieHeader.match(/^[^=]+=([^;]+)/);
    return `${SESSION_COOKIE_NAME}=${decodeURIComponent(m![1])}`;
}

describe('GET /api/recordings/:id/annotations', () => {
    it('returns empty array when rater has no marks yet', async () => {
        const cookie = await loginAsRater('Alice');
        const h = makeRes();
        await invoke(s.api, makeReq('GET', `/api/recordings/${s.sessionId}/annotations`, undefined, { cookie }), h);
        expect(h.captured.status).toBe(200);
        expect(JSON.parse(h.captured.body)).toEqual([]);
    });

    it('returns 403 when accessed by researcher role', async () => {
        const cookie = await loginAsResearcher();
        const h = makeRes();
        await invoke(s.api, makeReq('GET', `/api/recordings/${s.sessionId}/annotations`, undefined, { cookie }), h);
        expect(h.captured.status).toBe(403);
    });

    it('does NOT include legacy annotations.json content for a normal rater', async () => {
        fs.writeFileSync(path.join(s.sessionDir, 'annotations.json'), JSON.stringify([
            { id: 'legacy1', timestamp: 100, text: 'old', label: 'reading', createdAt: 110 },
        ]));
        const cookie = await loginAsRater('Alice');
        const h = makeRes();
        await invoke(s.api, makeReq('GET', `/api/recordings/${s.sessionId}/annotations`, undefined, { cookie }), h);
        expect(JSON.parse(h.captured.body)).toEqual([]);
    });
});
