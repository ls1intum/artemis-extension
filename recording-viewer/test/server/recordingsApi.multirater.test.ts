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

describe('POST /api/recordings/:id/annotations', () => {
    it('appends an add record for the current rater and returns the stored annotation', async () => {
        const cookie = await loginAsRater('Alice');
        const h = makeRes();
        await invoke(s.api, makeReq('POST', `/api/recordings/${s.sessionId}/annotations`,
            JSON.stringify({ label: 'confident', text: '' }),
            { cookie, 'content-type': 'application/json' }), h);
        expect(h.captured.status).toBe(200);
        const json = JSON.parse(h.captured.body);
        expect(json.annotation.label).toBe('confident');
        expect(json.annotation.raterName).toBe('Alice');
        expect(json.annotation.raterId).toMatch(/^r_/);
    });

    it('rejects 400 on invalid label', async () => {
        const cookie = await loginAsRater('Alice');
        const h = makeRes();
        await invoke(s.api, makeReq('POST', `/api/recordings/${s.sessionId}/annotations`,
            JSON.stringify({ label: 'nonsense', text: '' }),
            { cookie, 'content-type': 'application/json' }), h);
        expect(h.captured.status).toBe(400);
    });

    it('two raters see disjoint lists', async () => {
        const aliceCookie = await loginAsRater('Alice');
        const bobCookie = await loginAsRater('Bob');

        const h1 = makeRes();
        await invoke(s.api, makeReq('POST', `/api/recordings/${s.sessionId}/annotations`,
            JSON.stringify({ label: 'confident', text: '' }),
            { cookie: aliceCookie, 'content-type': 'application/json' }), h1);

        const h2 = makeRes();
        await invoke(s.api, makeReq('POST', `/api/recordings/${s.sessionId}/annotations`,
            JSON.stringify({ label: 'blocked', text: '' }),
            { cookie: bobCookie, 'content-type': 'application/json' }), h2);

        const ga = makeRes();
        await invoke(s.api, makeReq('GET', `/api/recordings/${s.sessionId}/annotations`, undefined, { cookie: aliceCookie }), ga);
        const gb = makeRes();
        await invoke(s.api, makeReq('GET', `/api/recordings/${s.sessionId}/annotations`, undefined, { cookie: bobCookie }), gb);

        const aList = JSON.parse(ga.captured.body);
        const bList = JSON.parse(gb.captured.body);
        expect(aList.map((a: { label: string }) => a.label)).toEqual(['confident']);
        expect(bList.map((a: { label: string }) => a.label)).toEqual(['blocked']);
    });

    it('researcher gets 403 on POST', async () => {
        const cookie = await loginAsResearcher();
        const h = makeRes();
        await invoke(s.api, makeReq('POST', `/api/recordings/${s.sessionId}/annotations`,
            JSON.stringify({ label: 'confident', text: '' }),
            { cookie, 'content-type': 'application/json' }), h);
        expect(h.captured.status).toBe(403);
    });
});

describe('DELETE /api/recordings/:id/annotations/:annotationId', () => {
    it('removes a marker the rater owns', async () => {
        const cookie = await loginAsRater('Alice');
        const postH = makeRes();
        await invoke(s.api, makeReq('POST', `/api/recordings/${s.sessionId}/annotations`,
            JSON.stringify({ label: 'confident', text: '' }),
            { cookie, 'content-type': 'application/json' }), postH);
        const id = JSON.parse(postH.captured.body).annotation.id;

        const delH = makeRes();
        await invoke(s.api, makeReq('DELETE', `/api/recordings/${s.sessionId}/annotations/${id}`, undefined, { cookie }), delH);
        expect(delH.captured.status).toBe(200);

        const getH = makeRes();
        await invoke(s.api, makeReq('GET', `/api/recordings/${s.sessionId}/annotations`, undefined, { cookie }), getH);
        expect(JSON.parse(getH.captured.body)).toEqual([]);
    });

    it("returns 404 when rater A tries to delete rater B's marker", async () => {
        const aliceCookie = await loginAsRater('Alice');
        const bobCookie = await loginAsRater('Bob');
        const postH = makeRes();
        await invoke(s.api, makeReq('POST', `/api/recordings/${s.sessionId}/annotations`,
            JSON.stringify({ label: 'confident', text: '' }),
            { cookie: aliceCookie, 'content-type': 'application/json' }), postH);
        const id = JSON.parse(postH.captured.body).annotation.id;
        const delH = makeRes();
        await invoke(s.api, makeReq('DELETE', `/api/recordings/${s.sessionId}/annotations/${id}`, undefined, { cookie: bobCookie }), delH);
        expect(delH.captured.status).toBe(404);
    });

    it('returns 404 for an unknown id with the same body shape', async () => {
        const cookie = await loginAsRater('Alice');
        const h = makeRes();
        await invoke(s.api, makeReq('DELETE', `/api/recordings/${s.sessionId}/annotations/nonexistent-id`, undefined, { cookie }), h);
        expect(h.captured.status).toBe(404);
    });

    it('researcher gets 403 on DELETE', async () => {
        const cookie = await loginAsResearcher();
        const h = makeRes();
        await invoke(s.api, makeReq('DELETE', `/api/recordings/${s.sessionId}/annotations/any-id`, undefined, { cookie }), h);
        expect(h.captured.status).toBe(403);
    });
});

it('PUT /api/recordings/:id/annotations returns 405 regardless of allowWrite', async () => {
    const cookie = await loginAsRater('Alice');
    const h = makeRes();
    await invoke(s.api, makeReq('PUT', `/api/recordings/${s.sessionId}/annotations`,
        JSON.stringify([]), { cookie, 'content-type': 'application/json' }), h);
    expect(h.captured.status).toBe(405);
});
