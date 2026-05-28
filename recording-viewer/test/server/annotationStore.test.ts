import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    appendAdd,
    appendDelete,
    materialize,
    materializeLegacy,
    listRaterIds,
    AnnotationCorruptionError,
} from '../../server/annotationStore';

let tmp: string;
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'astore-')); });
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

const annotation = (over: Partial<{ id: string; label: string; text: string; ts: number }> = {}) => ({
    id: over.id ?? 'a1',
    raterId: 'r_abc',
    raterName: 'Alice',
    timestamp: over.ts ?? 1000,
    createdAt: 1500,
    label: (over.label as 'confident') ?? 'confident',
    text: over.text ?? '',
});

describe('annotationStore', () => {
    it('appendAdd writes an "add" record line', async () => {
        await appendAdd(tmp, annotation());
        const lines = fs.readFileSync(path.join(tmp, 'annotations', 'r_abc.jsonl'), 'utf8').trim().split('\n');
        expect(lines).toHaveLength(1);
        const parsed = JSON.parse(lines[0]);
        expect(parsed.op).toBe('add');
        expect(parsed.annotation.id).toBe('a1');
    });

    it('materialize returns inserted-but-not-tombstoned entries in insertion order', async () => {
        await appendAdd(tmp, annotation({ id: 'a1', ts: 1000 }));
        await appendAdd(tmp, annotation({ id: 'a2', ts: 2000 }));
        const list = await materialize(tmp, 'r_abc');
        expect(list.map(a => a.id)).toEqual(['a1', 'a2']);
    });

    it('tombstone removes a materialized add', async () => {
        await appendAdd(tmp, annotation({ id: 'a1' }));
        await appendAdd(tmp, annotation({ id: 'a2' }));
        await appendDelete(tmp, 'r_abc', 'a1');
        const list = await materialize(tmp, 'r_abc');
        expect(list.map(a => a.id)).toEqual(['a2']);
    });

    it('delete-before-add is silently ignored (sequential log semantics)', async () => {
        await appendDelete(tmp, 'r_abc', 'ghost');
        await appendAdd(tmp, annotation({ id: 'a1' }));
        expect((await materialize(tmp, 'r_abc')).map(a => a.id)).toEqual(['a1']);
    });

    it('add-after-delete with same id is ignored (no resurrect)', async () => {
        await appendAdd(tmp, annotation({ id: 'a1' }));
        await appendDelete(tmp, 'r_abc', 'a1');
        await appendAdd(tmp, annotation({ id: 'a1' }));
        expect(await materialize(tmp, 'r_abc')).toEqual([]);
    });

    it('returns empty array when the rater file does not exist', async () => {
        expect(await materialize(tmp, 'r_unknown')).toEqual([]);
    });

    it('tolerates an unterminated final line (torn write)', async () => {
        await appendAdd(tmp, annotation({ id: 'a1' }));
        const f = path.join(tmp, 'annotations', 'r_abc.jsonl');
        fs.appendFileSync(f, '{"op":"add","annotation":{"id":"a2"'); // partial, no newline, no closing brace
        const list = await materialize(tmp, 'r_abc');
        expect(list.map(a => a.id)).toEqual(['a1']);
    });

    it('fails loudly on an invalid mid-file line with the offending line number', async () => {
        await appendAdd(tmp, annotation({ id: 'a1' }));
        const f = path.join(tmp, 'annotations', 'r_abc.jsonl');
        fs.appendFileSync(f, 'GARBAGE\n');
        await appendAdd(tmp, annotation({ id: 'a3' }));
        await expect(materialize(tmp, 'r_abc')).rejects.toThrow(AnnotationCorruptionError);
        await expect(materialize(tmp, 'r_abc')).rejects.toThrow(/line 2/);
    });

    it('materializeLegacy reads annotations.json and wraps as the synthetic legacy lane', async () => {
        fs.writeFileSync(path.join(tmp, 'annotations.json'), JSON.stringify([
            { id: 'l1', timestamp: 100, text: 'note', label: 'reading', createdAt: 110 },
        ]));
        const list = await materializeLegacy(tmp);
        expect(list).toHaveLength(1);
        expect(list[0].raterId).toBe('legacy');
        expect(list[0].raterName).toBe('Legacy');
    });

    it('materializeLegacy returns [] when no annotations.json', async () => {
        expect(await materializeLegacy(tmp)).toEqual([]);
    });

    it('listRaterIds enumerates the annotations/ dir', async () => {
        await appendAdd(tmp, annotation({ id: 'a1' }));
        await appendAdd(tmp, { ...annotation({ id: 'b1' }), raterId: 'r_xyz', raterName: 'Bob' });
        const ids = await listRaterIds(tmp);
        expect(ids.sort()).toEqual(['r_abc', 'r_xyz']);
    });

    it('same-id delete-before-add does NOT block the subsequent add (spec §3.2)', async () => {
        await appendDelete(tmp, 'r_abc', 'a1');     // ghost delete for id 'a1'
        await appendAdd(tmp, annotation({ id: 'a1' }));  // same id reused
        const list = await materialize(tmp, 'r_abc');
        expect(list.map(a => a.id)).toEqual(['a1']);
    });

    it('rejects mid-file records with the right op but malformed payload', async () => {
        await appendAdd(tmp, annotation({ id: 'a1' }));
        const f = path.join(tmp, 'annotations', 'r_abc.jsonl');
        // Valid JSON, wrong shape: op:add without annotation field.
        fs.appendFileSync(f, JSON.stringify({ op: 'add' }) + '\n');
        await appendAdd(tmp, annotation({ id: 'a3' }));
        await expect(materialize(tmp, 'r_abc')).rejects.toThrow(AnnotationCorruptionError);
        await expect(materialize(tmp, 'r_abc')).rejects.toThrow(/line 2/);
    });

    it('tolerates a torn final line that is valid JSON but wrong shape', async () => {
        await appendAdd(tmp, annotation({ id: 'a1' }));
        const f = path.join(tmp, 'annotations', 'r_abc.jsonl');
        fs.appendFileSync(f, JSON.stringify({ op: 'add' })); // no trailing newline, malformed
        const list = await materialize(tmp, 'r_abc');
        expect(list.map(a => a.id)).toEqual(['a1']);
    });
});
