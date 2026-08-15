import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createRecordingsApi } from '../../server/recordingsApi';
import type { AppConfig, IncomingRequest, ServerResponse } from '../../server/types';
import { makeRes, makeWritableRes, makeReq, invoke } from './_helpers';

let tmpDir: string;
let api: (req: IncomingRequest, res: ServerResponse, next: () => void) => void;

function makeApi(overrides: Partial<AppConfig> = {}) {
    return createRecordingsApi({
        recordingsDir: tmpDir,
        liveToken: undefined,
        allowWrite: true,
        ...overrides,
    });
}

beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'regress-test-'));
    api = makeApi();
});
afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

describe('GET /api/recordings (sessions list)', () => {
    it('returns empty array when recordings dir does not exist', async () => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
        const handle = makeRes();
        await invoke(api, makeReq('GET', '/api/recordings'), handle);
        expect(handle.captured.status).toBe(200);
        expect(JSON.parse(handle.captured.body).sessions).toEqual([]);
    });

    it('lists session directories with metadata when present', async () => {
        fs.mkdirSync(path.join(tmpDir, 'sess-1'));
        fs.writeFileSync(path.join(tmpDir, 'sess-1/metadata.json'), JSON.stringify({ startTime: 5, endTime: 6 }));
        const handle = makeRes();
        await invoke(api, makeReq('GET', '/api/recordings'), handle);
        const parsed = JSON.parse(handle.captured.body);
        expect(parsed.sessions).toHaveLength(1);
        expect(parsed.sessions[0].id).toBe('sess-1');
        expect(parsed.sessions[0].metadata.endTime).toBe(6);
    });

    it('includes session dirs without metadata.json', async () => {
        fs.mkdirSync(path.join(tmpDir, 'sess-no-meta'));
        const handle = makeRes();
        await invoke(api, makeReq('GET', '/api/recordings'), handle);
        expect(JSON.parse(handle.captured.body).sessions[0].metadata).toBeNull();
    });
});

describe('GET /api/recordings/:id/events', () => {
    it('parses JSONL into array', async () => {
        fs.mkdirSync(path.join(tmpDir, 'sess-1'));
        fs.writeFileSync(path.join(tmpDir, 'sess-1/events.jsonl'), '{"a":1}\n{"a":2}\n');
        const handle = makeRes();
        await invoke(api, makeReq('GET', '/api/recordings/sess-1/events'), handle);
        expect(handle.captured.status).toBe(200);
        expect(JSON.parse(handle.captured.body)).toEqual([{ a: 1 }, { a: 2 }]);
    });

    it('returns 404 when events.jsonl missing', async () => {
        fs.mkdirSync(path.join(tmpDir, 'sess-1'));
        const handle = makeRes();
        await invoke(api, makeReq('GET', '/api/recordings/sess-1/events'), handle);
        expect(handle.captured.status).toBe(404);
    });
});

describe('subtitle SRT→VTT conversion', () => {
    it('converts uploaded SRT to VTT on disk', async () => {
        fs.mkdirSync(path.join(tmpDir, 'sess-1'));
        const srt = '1\n00:00:01,000 --> 00:00:02,500\nHallo\n\n';
        const handle = makeRes();
        await invoke(
            api,
            makeReq('PUT', '/api/recordings/sess-1/subtitles', srt, { 'content-type': 'application/x-subrip' }),
            handle,
        );
        expect(handle.captured.status).toBe(200);
        const written = fs.readFileSync(path.join(tmpDir, 'sess-1/video.vtt'), 'utf-8');
        expect(written).toMatch(/^WEBVTT/);
        expect(written).toMatch(/00:00:01\.000 --> 00:00:02\.500/);
    });

    it('rejects unrecognised subtitle format', async () => {
        fs.mkdirSync(path.join(tmpDir, 'sess-1'));
        const handle = makeRes();
        await invoke(
            api,
            makeReq('PUT', '/api/recordings/sess-1/subtitles', 'not subtitles', { 'content-type': 'text/plain' }),
            handle,
        );
        expect(handle.captured.status).toBe(400);
    });
});

describe('video serving (Range / HEAD)', () => {
    function writeFakeMp4(p: string, sizeBytes: number) {
        const buf = Buffer.alloc(sizeBytes, 0x00);
        buf.write('ftyp', 4, 'ascii');
        fs.writeFileSync(p, buf);
        fs.writeFileSync(path.join(path.dirname(p), 'video-sync.json'),
            JSON.stringify({ videoTimeAtSessionStartSeconds: 0, videoExtension: 'mp4' }));
    }

    it('HEAD /video returns Content-Length without body', async () => {
        fs.mkdirSync(path.join(tmpDir, 'sess-1'));
        writeFakeMp4(path.join(tmpDir, 'sess-1/video.mp4'), 1024);
        const handle = makeRes();
        await invoke(api, makeReq('HEAD', '/api/recordings/sess-1/video'), handle);
        expect(handle.captured.status).toBe(200);
        expect(handle.captured.headers['Content-Length']).toBe('1024');
        expect(handle.captured.headers['Accept-Ranges']).toBe('bytes');
        expect(handle.captured.body).toBe('');
    });

    it('GET /video with Range returns 206 and the requested byte range', async () => {
        fs.mkdirSync(path.join(tmpDir, 'sess-1'));
        writeFakeMp4(path.join(tmpDir, 'sess-1/video.mp4'), 100);
        const handle = makeWritableRes();
        const req = makeReq('GET', '/api/recordings/sess-1/video', undefined, { range: 'bytes=10-19' });
        await invoke(api, req, handle);
        expect(handle.captured.status).toBe(206);
        expect(handle.captured.headers['Content-Range']).toBe('bytes 10-19/100');
        expect(handle.captured.headers['Content-Length']).toBe('10');
        expect(handle.captured.bodyBuf.length).toBe(10);
    });

    it('GET /video with malformed Range returns 416', async () => {
        fs.mkdirSync(path.join(tmpDir, 'sess-1'));
        writeFakeMp4(path.join(tmpDir, 'sess-1/video.mp4'), 100);
        const handle = makeRes();
        await invoke(api, makeReq('GET', '/api/recordings/sess-1/video', undefined, { range: 'invalid-range' }), handle);
        expect(handle.captured.status).toBe(416);
        expect(handle.captured.headers['Content-Range']).toBe('bytes */100');
    });

    it('GET /video with out-of-bounds Range returns 416', async () => {
        fs.mkdirSync(path.join(tmpDir, 'sess-1'));
        writeFakeMp4(path.join(tmpDir, 'sess-1/video.mp4'), 100);
        const handle = makeRes();
        await invoke(api, makeReq('GET', '/api/recordings/sess-1/video', undefined, { range: 'bytes=200-300' }), handle);
        expect(handle.captured.status).toBe(416);
    });
});

describe('video upload validation', () => {
    it('rejects non-MP4 magic bytes for video/mp4 content-type', async () => {
        fs.mkdirSync(path.join(tmpDir, 'sess-1'));
        const bogusBody = Buffer.from('not-an-mp4-at-all-not-even-close');
        const handle = makeRes();
        await invoke(
            api,
            makeReq('PUT', '/api/recordings/sess-1/video', bogusBody, { 'content-type': 'video/mp4' }),
            handle,
        );
        expect(handle.captured.status).toBe(400);
        expect(handle.captured.body).toMatch(/bad magic bytes/);
        expect(fs.existsSync(path.join(tmpDir, 'sess-1/video.mp4'))).toBe(false);
    });

    it('rejects unsupported content-type', async () => {
        fs.mkdirSync(path.join(tmpDir, 'sess-1'));
        const handle = makeRes();
        await invoke(
            api,
            makeReq('PUT', '/api/recordings/sess-1/video', Buffer.from('xx'), { 'content-type': 'video/avi' }),
            handle,
        );
        expect(handle.captured.status).toBe(400);
    });
});
