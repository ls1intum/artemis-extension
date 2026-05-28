import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { mergeAnnotationsLong } from '../../scripts/merge-annotations';

let tmp: string;
beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'merge-'));
    fs.writeFileSync(path.join(tmp, 'metadata.json'), JSON.stringify({ startTime: 1000 }));
});
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

describe('mergeAnnotationsLong', () => {
    it('emits one row per add, applying tombstones', async () => {
        fs.mkdirSync(path.join(tmp, 'annotations'));
        const aliceLog = [
            { op: 'add', annotation: { id: 'a1', raterId: 'r_alice', raterName: 'Alice', timestamp: 1500, createdAt: 1600, label: 'confident', text: '' } },
            { op: 'add', annotation: { id: 'a2', raterId: 'r_alice', raterName: 'Alice', timestamp: 2500, createdAt: 2600, label: 'blocked', text: 'stuck' } },
            { op: 'delete', id: 'a1', raterId: 'r_alice', deletedAt: 2700 },
        ];
        fs.writeFileSync(path.join(tmp, 'annotations', 'r_alice.jsonl'), aliceLog.map(r => JSON.stringify(r)).join('\n') + '\n');
        const csv = await mergeAnnotationsLong(tmp);
        const lines = csv.trim().split('\n');
        expect(lines[0]).toBe('raterId,raterName,timestamp,offsetMs,label,text,createdAt');
        expect(lines).toHaveLength(2);
        // a1 was tombstoned; only a2 should survive: timestamp=2500, offsetMs=1500, label=blocked, text=stuck
        expect(lines[1]).toBe('r_alice,Alice,2500,1500,blocked,stuck,2600');
    });

    it('includes legacy lane when annotations.json is present', async () => {
        fs.writeFileSync(path.join(tmp, 'annotations.json'), JSON.stringify([
            { id: 'l1', timestamp: 1100, text: '', label: 'reading', createdAt: 1110 },
        ]));
        const csv = await mergeAnnotationsLong(tmp);
        expect(csv).toContain('legacy');
        expect(csv).toContain('Legacy');
    });

    it('falls back to first sessionStart in events.jsonl when metadata.json lacks startTime', async () => {
        fs.writeFileSync(path.join(tmp, 'metadata.json'), JSON.stringify({}));
        fs.writeFileSync(path.join(tmp, 'events.jsonl'), JSON.stringify({ type: 'sessionStart', timestamp: 7000 }) + '\n');
        fs.mkdirSync(path.join(tmp, 'annotations'));
        fs.writeFileSync(path.join(tmp, 'annotations', 'r_a.jsonl'),
            JSON.stringify({ op: 'add', annotation: { id: 'a1', raterId: 'r_a', raterName: 'Alice', timestamp: 7250, createdAt: 7300, label: 'confident', text: '' } }) + '\n');
        const csv = await mergeAnnotationsLong(tmp);
        const dataRow = csv.split('\n')[1];
        // sessionStart=7000, ts=7250 -> offsetMs=250
        expect(dataRow).toBe('r_a,Alice,7250,250,confident,,7300');
    });

    it('escapes CSV quotes and commas in text', async () => {
        fs.mkdirSync(path.join(tmp, 'annotations'));
        fs.writeFileSync(path.join(tmp, 'annotations', 'r_a.jsonl'),
            JSON.stringify({ op: 'add', annotation: { id: 'a1', raterId: 'r_a', raterName: 'Alice', timestamp: 1500, createdAt: 1600, label: 'confident', text: 'has "quote", and comma' } }) + '\n');
        const csv = await mergeAnnotationsLong(tmp);
        expect(csv).toContain('"has ""quote"", and comma"');
    });

    it('quotes text containing carriage returns so it cannot corrupt row structure', async () => {
        fs.mkdirSync(path.join(tmp, 'annotations'));
        fs.writeFileSync(path.join(tmp, 'annotations', 'r_a.jsonl'),
            JSON.stringify({ op: 'add', annotation: { id: 'a1', raterId: 'r_a', raterName: 'Alice', timestamp: 1500, createdAt: 1600, label: 'confident', text: 'line1\rline2' } }) + '\n');
        const csv = await mergeAnnotationsLong(tmp);
        expect(csv).toContain('"line1\rline2"');
    });
});
