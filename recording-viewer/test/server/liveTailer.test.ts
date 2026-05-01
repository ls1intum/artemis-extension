import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { LiveTailer } from '../../server/liveTailer';

let tmpDir: string;
let filePath: string;

beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tailer-'));
    filePath = path.join(tmpDir, 'events.jsonl');
    fs.writeFileSync(filePath, '');
});
afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

describe('LiveTailer (deterministic)', () => {
    it('emits all existing lines on first pollOnce', async () => {
        fs.writeFileSync(filePath, '{"a":1}\n{"a":2}\n');
        const got: Array<{ line: string; lineNo: number }> = [];
        const t = new LiveTailer(filePath);
        t.subscribe((line, lineNo) => got.push({ line, lineNo }));
        await t.pollOnce();
        expect(got).toEqual([
            { line: '{"a":1}', lineNo: 1 },
            { line: '{"a":2}', lineNo: 2 },
        ]);
    });

    it('emits only new lines on second pollOnce', async () => {
        const got: string[] = [];
        const t = new LiveTailer(filePath);
        t.subscribe((line) => got.push(line));
        await t.pollOnce();
        fs.appendFileSync(filePath, '{"x":1}\n');
        await t.pollOnce();
        expect(got).toEqual(['{"x":1}']);
    });

    it('buffers a partial last line until newline arrives', async () => {
        const got: string[] = [];
        const t = new LiveTailer(filePath);
        t.subscribe((line) => got.push(line));
        fs.appendFileSync(filePath, '{"partial":');
        await t.pollOnce();
        expect(got).toEqual([]);
        fs.appendFileSync(filePath, 'true}\n');
        await t.pollOnce();
        expect(got).toEqual(['{"partial":true}']);
    });

    it('detects truncation (size < offset) and re-reads from start with reset lineNo', async () => {
        fs.writeFileSync(filePath, '{"old":1}\n');
        const got: Array<{ line: string; lineNo: number }> = [];
        const t = new LiveTailer(filePath);
        t.subscribe((line, lineNo) => got.push({ line, lineNo }));
        await t.pollOnce();
        fs.writeFileSync(filePath, '{"new":1}\n');
        await t.pollOnce();
        expect(got).toEqual([
            { line: '{"old":1}', lineNo: 1 },
            { line: '{"new":1}', lineNo: 1 },
        ]);
    });

    it('handles UTF-8 multi-byte characters split across chunks', async () => {
        const got: string[] = [];
        const t = new LiveTailer(filePath, { maxChunkBytes: 2 });
        t.subscribe((line) => got.push(line));
        fs.writeFileSync(filePath, '€\n€\n');
        await t.pollOnce();
        await t.pollOnce();
        await t.pollOnce();
        await t.pollOnce();
        expect(got).toEqual(['€', '€']);
    });

    it('multiple subscribers each receive lines', async () => {
        const a: string[] = []; const b: string[] = [];
        const t = new LiveTailer(filePath);
        t.subscribe((line) => a.push(line));
        t.subscribe((line) => b.push(line));
        fs.appendFileSync(filePath, '{"k":1}\n');
        await t.pollOnce();
        expect(a).toEqual(['{"k":1}']);
        expect(b).toEqual(['{"k":1}']);
    });

    it('unsubscribe removes the listener', async () => {
        const got: string[] = [];
        const t = new LiveTailer(filePath);
        const off = t.subscribe((line) => got.push(line));
        off();
        fs.appendFileSync(filePath, '{"k":1}\n');
        await t.pollOnce();
        expect(got).toEqual([]);
    });

    it('handles missing file gracefully', async () => {
        const missing = path.join(tmpDir, 'nope.jsonl');
        const got: string[] = [];
        const t = new LiveTailer(missing);
        t.subscribe((line) => got.push(line));
        await t.pollOnce();
        expect(got).toEqual([]);
        fs.writeFileSync(missing, '{"late":1}\n');
        await t.pollOnce();
        expect(got).toEqual(['{"late":1}']);
    });
});
