import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import { withFileLock } from './fileLock';

export interface StoredAnnotation {
    id: string;
    raterId: string;
    raterName: string;
    timestamp: number;
    createdAt: number;
    label: string;
    text: string;
}

export interface AddRecord {
    op: 'add';
    annotation: StoredAnnotation;
}

export interface DeleteRecord {
    op: 'delete';
    id: string;
    raterId: string;
    deletedAt: number;
}

export type AnnotationRecord = AddRecord | DeleteRecord;

export class AnnotationCorruptionError extends Error {
    constructor(filepath: string, lineNumber: number, lineExcerpt: string) {
        super(`Corrupt annotation log at ${filepath} line ${lineNumber}: ${lineExcerpt.slice(0, 60)}`);
        this.name = 'AnnotationCorruptionError';
    }
}

function raterFilepath(sessionDir: string, raterId: string): string {
    return path.join(sessionDir, 'annotations', `${raterId}.jsonl`);
}

async function ensureRaterDir(sessionDir: string): Promise<string> {
    const dir = path.join(sessionDir, 'annotations');
    await fs.mkdir(dir, { recursive: true, mode: 0o750 });
    return dir;
}

export async function appendAdd(sessionDir: string, ann: StoredAnnotation): Promise<void> {
    const file = raterFilepath(sessionDir, ann.raterId);
    await ensureRaterDir(sessionDir);
    const record: AddRecord = { op: 'add', annotation: ann };
    const line = JSON.stringify(record) + '\n';
    await withFileLock(file, async () => {
        await fs.appendFile(file, line, { encoding: 'utf8', mode: 0o640 });
    });
}

export async function appendDelete(sessionDir: string, raterId: string, annotationId: string): Promise<void> {
    const file = raterFilepath(sessionDir, raterId);
    await ensureRaterDir(sessionDir);
    const record: DeleteRecord = { op: 'delete', id: annotationId, raterId, deletedAt: Date.now() };
    const line = JSON.stringify(record) + '\n';
    await withFileLock(file, async () => {
        await fs.appendFile(file, line, { encoding: 'utf8', mode: 0o640 });
    });
}

export async function materialize(sessionDir: string, raterId: string): Promise<StoredAnnotation[]> {
    const file = raterFilepath(sessionDir, raterId);
    let raw: string;
    try {
        raw = await fs.readFile(file, 'utf8');
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
        throw err;
    }
    return applyEventLog(file, raw);
}

/** Sequential replay; see spec §3.2 and §7. */
export function applyEventLog(filepath: string, raw: string): StoredAnnotation[] {
    const endsWithNewline = raw.endsWith('\n');
    const lines = raw.split('\n');
    if (endsWithNewline) lines.pop(); // ignore the empty trailing element from split
    const total = lines.length;

    const live = new Map<string, StoredAnnotation>(); // insertion-ordered
    const tombstoned = new Set<string>();

    for (let i = 0; i < total; i++) {
        const line = lines[i];
        if (line.length === 0) continue;
        const isFinal = i === total - 1 && !endsWithNewline;
        let parsed: AnnotationRecord;
        try {
            parsed = JSON.parse(line);
        } catch {
            if (isFinal) continue; // tolerate torn write of final line only
            throw new AnnotationCorruptionError(filepath, i + 1, line);
        }
        if (parsed.op === 'add') {
            if (tombstoned.has(parsed.annotation.id)) continue;
            if (live.has(parsed.annotation.id)) continue; // duplicate add ignored
            live.set(parsed.annotation.id, parsed.annotation);
        } else if (parsed.op === 'delete') {
            tombstoned.add(parsed.id);
            live.delete(parsed.id);
        } else {
            if (isFinal) continue;
            throw new AnnotationCorruptionError(filepath, i + 1, line);
        }
    }
    return [...live.values()];
}

export async function materializeLegacy(sessionDir: string): Promise<StoredAnnotation[]> {
    const file = path.join(sessionDir, 'annotations.json');
    if (!fsSync.existsSync(file)) return [];
    const raw = await fs.readFile(file, 'utf8');
    let arr: unknown;
    try { arr = JSON.parse(raw); } catch { throw new AnnotationCorruptionError(file, 1, raw.slice(0, 60)); }
    if (!Array.isArray(arr)) throw new AnnotationCorruptionError(file, 1, 'not an array');
    return arr
        .filter((a): a is Record<string, unknown> => !!a && typeof a === 'object')
        .map((a): StoredAnnotation => ({
            id: String(a.id ?? ''),
            raterId: 'legacy',
            raterName: 'Legacy',
            timestamp: Number(a.timestamp ?? 0),
            createdAt: Number(a.createdAt ?? 0),
            label: typeof a.label === 'string' ? a.label : '',
            text: typeof a.text === 'string' ? a.text : '',
        }))
        .filter(a => a.id.length > 0);
}

export async function listRaterIds(sessionDir: string): Promise<string[]> {
    const dir = path.join(sessionDir, 'annotations');
    let entries: string[];
    try {
        entries = await fs.readdir(dir);
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
        throw err;
    }
    return entries
        .filter(name => name.endsWith('.jsonl'))
        .map(name => name.slice(0, -'.jsonl'.length));
}
