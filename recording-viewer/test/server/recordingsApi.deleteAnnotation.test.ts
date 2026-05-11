import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createRecordingsApi } from '../../server/recordingsApi';
import type { AppConfig } from '../../server/types';
import { makeReq, makeRes, invoke } from './_helpers';

let tmpDir: string;
beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'annot-del-'));
    fs.mkdirSync(path.join(tmpDir, 'sess-1'));
});
afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

const cfg = (overrides: Partial<AppConfig> = {}): AppConfig => ({
    recordingsDir: tmpDir,
    liveToken: undefined,
    allowWrite: true,
    ...overrides,
});

function seedAnnotations(items: Array<{ id: string; timestamp: number; text?: string }>): void {
    fs.writeFileSync(
        path.join(tmpDir, 'sess-1/annotations.json'),
        JSON.stringify(items.map(a => ({ text: '', createdAt: a.timestamp, ...a }))),
    );
}

describe('DELETE /api/recordings/:id/annotations/:annotId', () => {
    it('removes the matching annotation and leaves the rest', async () => {
        seedAnnotations([
            { id: 'a1', timestamp: 100 },
            { id: 'a2', timestamp: 200 },
            { id: 'a3', timestamp: 300 },
        ]);
        const api = createRecordingsApi(cfg());
        const handle = makeRes();
        await invoke(api, makeReq('DELETE', '/api/recordings/sess-1/annotations/a2'), handle);
        expect(handle.captured.status).toBe(200);
        const stored = JSON.parse(fs.readFileSync(path.join(tmpDir, 'sess-1/annotations.json'), 'utf-8'));
        expect(stored.map((a: { id: string }) => a.id)).toEqual(['a1', 'a3']);
    });

    it('returns 404 when annotation id does not exist', async () => {
        seedAnnotations([{ id: 'a1', timestamp: 100 }]);
        const api = createRecordingsApi(cfg());
        const handle = makeRes();
        await invoke(api, makeReq('DELETE', '/api/recordings/sess-1/annotations/nope'), handle);
        expect(handle.captured.status).toBe(404);
    });

    it('returns 404 when annotations.json is missing', async () => {
        const api = createRecordingsApi(cfg());
        const handle = makeRes();
        await invoke(api, makeReq('DELETE', '/api/recordings/sess-1/annotations/a1'), handle);
        expect(handle.captured.status).toBe(404);
    });

    it('returns 409 when annotations.json is corrupt JSON', async () => {
        fs.writeFileSync(path.join(tmpDir, 'sess-1/annotations.json'), 'not json {');
        const api = createRecordingsApi(cfg());
        const handle = makeRes();
        await invoke(api, makeReq('DELETE', '/api/recordings/sess-1/annotations/a1'), handle);
        expect(handle.captured.status).toBe(409);
    });

    it('returns 409 when annotations.json is not an array', async () => {
        fs.writeFileSync(path.join(tmpDir, 'sess-1/annotations.json'), JSON.stringify({ wrong: 'shape' }));
        const api = createRecordingsApi(cfg());
        const handle = makeRes();
        await invoke(api, makeReq('DELETE', '/api/recordings/sess-1/annotations/a1'), handle);
        expect(handle.captured.status).toBe(409);
    });

    it('rejects path-traversal-style annotation ids with 400', async () => {
        seedAnnotations([{ id: 'a1', timestamp: 100 }]);
        const api = createRecordingsApi(cfg());
        const handle = makeRes();
        await invoke(api, makeReq('DELETE', '/api/recordings/sess-1/annotations/..%2Fevil'), handle);
        expect(handle.captured.status).toBe(400);
    });

    it('rejects empty-ish ids (after decoding) with 400', async () => {
        seedAnnotations([{ id: 'a1', timestamp: 100 }]);
        const api = createRecordingsApi(cfg());
        const handle = makeRes();
        // %20 decodes to space, which is not in [A-Za-z0-9_-]
        await invoke(api, makeReq('DELETE', '/api/recordings/sess-1/annotations/%20'), handle);
        expect(handle.captured.status).toBe(400);
    });

    it('rejects invalid session id segment with 400', async () => {
        seedAnnotations([{ id: 'a1', timestamp: 100 }]);
        const api = createRecordingsApi(cfg());
        const handle = makeRes();
        await invoke(api, makeReq('DELETE', '/api/recordings/..%2Fevil/annotations/a1'), handle);
        expect(handle.captured.status).toBe(400);
    });

    it('atomic-style: a second DELETE on the same id returns 404 (already removed)', async () => {
        seedAnnotations([{ id: 'a1', timestamp: 100 }]);
        const api = createRecordingsApi(cfg());
        const first = makeRes();
        await invoke(api, makeReq('DELETE', '/api/recordings/sess-1/annotations/a1'), first);
        expect(first.captured.status).toBe(200);
        const second = makeRes();
        await invoke(api, makeReq('DELETE', '/api/recordings/sess-1/annotations/a1'), second);
        expect(second.captured.status).toBe(404);
    });

    describe('live-mode carve-out (allowWrite=false)', () => {
        it('allows DELETE on annotation id endpoint', async () => {
            seedAnnotations([{ id: 'a1', timestamp: 100 }]);
            const api = createRecordingsApi(cfg({ allowWrite: false }));
            const handle = makeRes();
            await invoke(api, makeReq('DELETE', '/api/recordings/sess-1/annotations/a1'), handle);
            expect(handle.captured.status).toBe(200);
        });

        it('still rejects PUT on the annotation list endpoint', async () => {
            seedAnnotations([{ id: 'a1', timestamp: 100 }]);
            const api = createRecordingsApi(cfg({ allowWrite: false }));
            const handle = makeRes();
            await invoke(api, makeReq('PUT', '/api/recordings/sess-1/annotations', JSON.stringify([])), handle);
            expect(handle.captured.status).toBe(403);
        });

        it('still rejects DELETE on a different (non-annotation) endpoint shape', async () => {
            const api = createRecordingsApi(cfg({ allowWrite: false }));
            const handle = makeRes();
            await invoke(api, makeReq('DELETE', '/api/recordings/sess-1'), handle);
            expect(handle.captured.status).toBe(403);
        });
    });
});
