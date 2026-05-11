import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { readLastNLines, readLinesAfter } from '../../server/eventsReader';

let tmpDir: string;
let filePath: string;

beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reader-'));
    filePath = path.join(tmpDir, 'events.jsonl');
    const lines: string[] = [];
    for (let i = 1; i <= 10; i++) lines.push(`line ${i}`);
    fs.writeFileSync(filePath, lines.join('\n') + '\n');
});
afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

describe('readLastNLines', () => {
    it('returns the last N lines with file-line numbers', async () => {
        const { lines, endLineNo } = await readLastNLines(filePath, 3);
        expect(lines.map((l) => l.line)).toEqual(['line 8', 'line 9', 'line 10']);
        expect(lines.map((l) => l.lineNo)).toEqual([8, 9, 10]);
        expect(endLineNo).toBe(10);
    });

    it('returns all lines when N exceeds file size', async () => {
        const { lines } = await readLastNLines(filePath, 999);
        expect(lines).toHaveLength(10);
    });

    it('returns empty when limit=0', async () => {
        const { lines, endLineNo, endByteOffset } = await readLastNLines(filePath, 0);
        expect(lines).toEqual([]);
        expect(endLineNo).toBe(0);
        expect(endByteOffset).toBeGreaterThan(0);
    });

    it('skips empty lines but still increments lineNo', async () => {
        fs.writeFileSync(filePath, 'a\n\nb\n');
        const { lines } = await readLastNLines(filePath, 5);
        // The empty line is filtered out; non-empty lines keep their original numbers
        expect(lines).toEqual([
            { lineNo: 1, line: 'a' },
            { lineNo: 3, line: 'b' },
        ]);
    });
});

describe('readLinesAfter', () => {
    it('returns lines with lineNo > afterLineNo', async () => {
        const { lines, endLineNo } = await readLinesAfter(filePath, 7);
        expect(lines.map((l) => l.lineNo)).toEqual([8, 9, 10]);
        expect(endLineNo).toBe(10);
    });

    it('respects maxLineNo when provided', async () => {
        const { lines } = await readLinesAfter(filePath, 3, 6);
        expect(lines.map((l) => l.lineNo)).toEqual([4, 5, 6]);
    });

    it('returns empty when afterLineNo >= last line', async () => {
        const { lines } = await readLinesAfter(filePath, 100);
        expect(lines).toEqual([]);
    });
});
