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

    it('concurrent pollOnce calls do not double-emit lines (re-entrancy guard)', async () => {
        fs.writeFileSync(filePath, '{"a":1}\n{"a":2}\n{"a":3}\n');
        const got: string[] = [];
        const t = new LiveTailer(filePath);
        t.subscribe((line) => got.push(line));
        // Fire two concurrent pollOnce calls. The guard should make the second one
        // return the same in-flight promise; lines must be emitted exactly once.
        await Promise.all([t.pollOnce(), t.pollOnce()]);
        expect(got).toEqual(['{"a":1}', '{"a":2}', '{"a":3}']);
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

    it('currentLineNo() reports the highest emitted line number', async () => {
        fs.writeFileSync(filePath, '{"a":1}\n{"a":2}\n{"a":3}\n');
        const t = new LiveTailer(filePath);
        t.subscribe(() => {});
        await t.pollOnce();
        expect(t.currentLineNo()).toBe(3);
    });

    describe('initialOffset / initialLineNo', () => {
        it('skips lines below the seeded cursor and emits new ones with continuing line numbers', async () => {
            fs.writeFileSync(filePath, '{"old":1}\n{"old":2}\n');
            const stat = fs.statSync(filePath, { bigint: true });
            const got: Array<{ line: string; lineNo: number }> = [];
            const t = new LiveTailer(filePath, {
                initialOffset: Number(stat.size),
                initialLineNo: 2,
                initialMtimeNs: stat.mtimeNs,
            });
            t.subscribe((line, lineNo) => got.push({ line, lineNo }));
            await t.pollOnce();
            expect(got).toEqual([]);
            expect(t.currentLineNo()).toBe(2);
            fs.appendFileSync(filePath, '{"new":1}\n');
            await t.pollOnce();
            expect(got).toEqual([{ line: '{"new":1}', lineNo: 3 }]);
        });

        it('lines appended between seeding and first poll are still emitted', async () => {
            // Simulate the race: seed cursor at "current EOF", then append
            // a line before the first poll fires. The new line must emit.
            fs.writeFileSync(filePath, '{"old":1}\n');
            const stat = fs.statSync(filePath, { bigint: true });
            // Append BEFORE constructing the tailer is the analogue of the
            // registry → first-poll race: cursor seeded at old size, but
            // file has grown by the time we poll.
            fs.appendFileSync(filePath, '{"between":1}\n');
            const got: Array<{ line: string; lineNo: number }> = [];
            const t = new LiveTailer(filePath, {
                initialOffset: Number(stat.size),
                initialLineNo: 1,
                initialMtimeNs: stat.mtimeNs,
            });
            t.subscribe((line, lineNo) => got.push({ line, lineNo }));
            await t.pollOnce();
            expect(got).toEqual([{ line: '{"between":1}', lineNo: 2 }]);
        });
    });
});
