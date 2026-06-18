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

const STRUGGLE_LABELS = new Set([
    'confident', 'light-struggle', 'medium-struggle', 'high-struggle', 'blocked',
]);
const CONTEXT_LABELS = new Set([
    'idle', 'trial-error', 'reading', 'off-task', 'using-ai', 'iris-moment', 'reading-test-results', 'waiting-for-build-results',
]);

export interface MatrixOptions {
    binMs: number;
    labelSet: 'struggle' | 'context' | 'all';
    conflict: 'first' | 'last' | 'dominant' | 'error';
    missing: 'empty' | 'NA';
}

function labelFilter(set: MatrixOptions['labelSet']): (label: string) => boolean {
    if (set === 'struggle') return l => STRUGGLE_LABELS.has(l);
    if (set === 'context') return l => CONTEXT_LABELS.has(l);
    return () => true;
}

export async function mergeAnnotationsMatrix(sessionDir: string, opts: MatrixOptions): Promise<string> {
    if (opts.labelSet === 'all') {
        throw new Error('--label-set=all emits two files; use --format=irr-matrix once per dimension or call mergeAnnotationsMatrix twice with struggle and context.');
    }
    if (!Number.isFinite(opts.binMs) || !Number.isInteger(opts.binMs) || opts.binMs <= 0) {
        throw new Error(`binMs must be a positive integer (got ${opts.binMs})`);
    }
    const startTime = await resolveSessionStartTime(sessionDir);
    const allowed = labelFilter(opts.labelSet);

    interface Lane { laneName: string; annotations: StoredAnnotation[] }
    const lanes: Lane[] = [];
    for (const raterId of await listRaterIds(sessionDir)) {
        const list = (await materialize(sessionDir, raterId)).filter(a => allowed(a.label));
        if (list.length === 0) continue;
        const laneName = list.find(a => a.raterName.length > 0)?.raterName ?? raterId;
        lanes.push({ laneName, annotations: list });
    }
    const legacy = (await materializeLegacy(sessionDir)).filter(a => allowed(a.label));
    if (legacy.length > 0) lanes.push({ laneName: 'Legacy', annotations: legacy });

    const cells = new Map<number, Map<string, string>>();
    let maxBin = -1;
    for (const lane of lanes) {
        const perBin = new Map<number, string[]>();
        for (const a of lane.annotations) {
            const binIdx = Math.floor((a.timestamp - startTime) / opts.binMs);
            if (binIdx < 0) continue;
            maxBin = Math.max(maxBin, binIdx);
            if (!perBin.has(binIdx)) perBin.set(binIdx, []);
            perBin.get(binIdx)!.push(a.label);
        }
        for (const [binIdx, labels] of perBin.entries()) {
            let collapsed: string;
            if (labels.length === 1) {
                collapsed = labels[0];
            } else if (opts.conflict === 'first') collapsed = labels[0];
            else if (opts.conflict === 'last') collapsed = labels[labels.length - 1];
            else if (opts.conflict === 'dominant') {
                const counts = new Map<string, number>();
                for (const l of labels) counts.set(l, (counts.get(l) ?? 0) + 1);
                let bestLabel = labels[0]; let bestCount = 0;
                for (const [l, c] of counts) if (c > bestCount) { bestLabel = l; bestCount = c; }
                collapsed = bestLabel;
            } else {
                throw new Error(`Conflict: lane "${lane.laneName}" has ${labels.length} marks in bin ${binIdx} (labels: ${labels.join(', ')})`);
            }
            if (!cells.has(binIdx)) cells.set(binIdx, new Map());
            cells.get(binIdx)!.set(lane.laneName, collapsed);
        }
    }

    const laneNames = lanes.map(l => l.laneName);
    const lines: string[] = ['binStartMs,' + laneNames.map(csvEscape).join(',')];
    const fill = opts.missing === 'NA' ? 'NA' : '';
    for (let bin = 0; bin <= maxBin; bin++) {
        const row = [String(bin * opts.binMs)];
        for (const name of laneNames) {
            row.push(cells.get(bin)?.get(name) ?? fill);
        }
        lines.push(row.map(csvEscape).join(','));
    }
    return lines.join('\n') + '\n';
}

if (process.argv[1] && process.argv[1].endsWith('merge-annotations.ts')) {
    const args = process.argv.slice(2);
    const sessionDir = args.find(a => !a.startsWith('--'));
    if (!sessionDir) {
        console.error('Usage: tsx scripts/merge-annotations.ts <sessionDir> [--format=long|irr-matrix] [--bin-ms=N] [--label-set=struggle|context|all] [--conflict=first|last|dominant|error] [--missing=empty|NA] [--out=file]');
        process.exit(1);
    }
    function flag<T extends string>(name: string, def: T, allowed?: readonly T[]): T {
        const found = args.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
        if (found === undefined) return def;
        if (allowed && !allowed.includes(found as T)) {
            console.error(`Invalid --${name}: ${found}; allowed: ${allowed.join(', ')}`);
            process.exit(2);
        }
        return found as T;
    }
    const format = flag<'long' | 'irr-matrix'>('format', 'long', ['long', 'irr-matrix']);
    const out = args.find(a => a.startsWith('--out='))?.slice('--out='.length);
    void (async () => {
        let csv: string;
        if (format === 'long') {
            csv = await mergeAnnotationsLong(path.resolve(sessionDir));
        } else {
            csv = await mergeAnnotationsMatrix(path.resolve(sessionDir), {
                binMs: Number(flag('bin-ms', '1000')),
                labelSet: flag('label-set', 'struggle', ['struggle', 'context', 'all'] as const),
                conflict: flag('conflict', 'error', ['first', 'last', 'dominant', 'error'] as const),
                missing: flag('missing', 'NA', ['empty', 'NA'] as const),
            });
        }
        if (out) await fs.writeFile(out, csv);
        else process.stdout.write(csv);
    })();
}
