import * as fs from 'fs/promises';
import * as path from 'path';
import { existsSync } from 'fs';
import { materialize, materializeLegacy, listRaterIds, type StoredAnnotation } from '../server/annotationStore';

async function resolveSessionStartTime(sessionDir: string): Promise<number> {
    const metaPath = path.join(sessionDir, 'metadata.json');
    if (existsSync(metaPath)) {
        try {
            const meta = JSON.parse(await fs.readFile(metaPath, 'utf8'));
            if (typeof meta?.startTime === 'number') return meta.startTime;
        } catch { /* fall through */ }
    }
    const eventsPath = path.join(sessionDir, 'events.jsonl');
    if (existsSync(eventsPath)) {
        const raw = await fs.readFile(eventsPath, 'utf8');
        for (const line of raw.split('\n')) {
            if (line.length === 0) continue;
            try {
                const ev = JSON.parse(line);
                if (ev?.type === 'sessionStart' && typeof ev.timestamp === 'number') return ev.timestamp;
            } catch { /* skip bad lines */ }
        }
    }
    throw new Error(`Cannot determine sessionStartTime for ${sessionDir} (no metadata.startTime, no sessionStart event)`);
}

function csvEscape(value: string): string {
    if (value.includes('"') || value.includes(',') || value.includes('\n') || value.includes('\r')) {
        return '"' + value.replace(/"/g, '""') + '"';
    }
    return value;
}

function row(a: StoredAnnotation, startTime: number): string {
    return [
        a.raterId,
        a.raterName,
        String(a.timestamp),
        String(a.timestamp - startTime),
        a.label,
        a.text,
        String(a.createdAt),
    ].map(csvEscape).join(',');
}

export async function mergeAnnotationsLong(sessionDir: string): Promise<string> {
    const startTime = await resolveSessionStartTime(sessionDir);
    const lines: string[] = ['raterId,raterName,timestamp,offsetMs,label,text,createdAt'];
    const raterIds = await listRaterIds(sessionDir);
    for (const raterId of raterIds) {
        const list = await materialize(sessionDir, raterId);
        for (const a of list) lines.push(row(a, startTime));
    }
    const legacy = await materializeLegacy(sessionDir);
    for (const a of legacy) lines.push(row(a, startTime));
    return lines.join('\n') + '\n';
}

// CLI entry
if (process.argv[1] && process.argv[1].endsWith('merge-annotations.ts')) {
    const sessionDir = process.argv[2];
    if (!sessionDir) {
        console.error('Usage: tsx scripts/merge-annotations.ts <sessionDir>');
        process.exit(1);
    }
    void (async () => {
        const csv = await mergeAnnotationsLong(path.resolve(sessionDir));
        process.stdout.write(csv);
    })();
}
