import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { LiveTailerRegistry } from '../../server/liveTailerRegistry';

let tmpDir: string;
beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reg-'));
    fs.mkdirSync(path.join(tmpDir, 'sess-1'));
    fs.writeFileSync(path.join(tmpDir, 'sess-1/events.jsonl'), '');
});
afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

describe('LiveTailerRegistry', () => {
    it('returns the same tailer for repeat acquires', () => {
        const reg = new LiveTailerRegistry(tmpDir);
        const a = reg.acquire('sess-1');
        const b = reg.acquire('sess-1');
        expect(a.tailer).toBe(b.tailer);
        a.release(); b.release();
    });

    it('stops the tailer when last subscriber releases', () => {
        const reg = new LiveTailerRegistry(tmpDir);
        const h = reg.acquire('sess-1');
        expect(reg.size()).toBe(1);
        h.release();
        expect(reg.size()).toBe(0);
    });

    it('release() is idempotent (calling twice on same handle does not break refcount)', () => {
        const reg = new LiveTailerRegistry(tmpDir);
        const a = reg.acquire('sess-1');
        const b = reg.acquire('sess-1');
        a.release();
        a.release(); // noop
        expect(reg.size()).toBe(1); // b still holds
        b.release();
        expect(reg.size()).toBe(0);
    });

    it('creates a fresh tailer after full release (no zombie reuse)', () => {
        const reg = new LiveTailerRegistry(tmpDir);
        const a = reg.acquire('sess-1');
        a.release();
        const b = reg.acquire('sess-1');
        expect(b.tailer).not.toBe(a.tailer);
        b.release();
    });

    it('seeds tailer cursor at construction time so lines appended before first poll still emit', async () => {
        // Prepare a session file with 2 lines BEFORE registry.acquire.
        fs.writeFileSync(path.join(tmpDir, 'sess-1/events.jsonl'), '{"a":1}\n{"a":2}\n');
        const reg = new LiveTailerRegistry(tmpDir);
        const handle = reg.acquire('sess-1');
        // currentLineNo must reflect the seed (2 lines counted at acquire).
        expect(handle.tailer.currentLineNo()).toBe(2);
        // Append a 3rd line before the tailer's first poll runs. The line
        // must still emit, with lineNo=3, not be skipped as "historical".
        fs.appendFileSync(path.join(tmpDir, 'sess-1/events.jsonl'), '{"a":3}\n');
        const got: Array<{ line: string; lineNo: number }> = [];
        handle.tailer.subscribe((line, lineNo) => got.push({ line, lineNo }));
        await handle.tailer.pollOnce();
        expect(got).toEqual([{ line: '{"a":3}', lineNo: 3 }]);
        handle.release();
    });

    it('disposeAll() stops all tailers and clears the registry', () => {
        fs.mkdirSync(path.join(tmpDir, 'sess-2'));
        fs.writeFileSync(path.join(tmpDir, 'sess-2/events.jsonl'), '');
        const reg = new LiveTailerRegistry(tmpDir);
        reg.acquire('sess-1');
        reg.acquire('sess-2');
        expect(reg.size()).toBe(2);
        reg.disposeAll();
        expect(reg.size()).toBe(0);
    });
});
