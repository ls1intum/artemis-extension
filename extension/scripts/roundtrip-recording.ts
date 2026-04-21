/* eslint-disable no-console -- CLI tool; stdout/stderr is the output channel */
/**
 * Roundtrip test: reconstructs final file contents from a recording by replaying
 * initial snapshots + textChange events in order, and optionally compares the
 * reconstruction against a reference directory (e.g. the actual exercise workspace).
 *
 * This is the strongest structural evidence for recorder correctness:
 *  - If every textChange applies cleanly (no offset/range errors), the recorder
 *    captured a structurally consistent edit stream.
 *  - If the reconstruction matches the on-disk state (--compare), every edit
 *    was captured lossless.
 *
 * Usage (from extension/):
 *   npm run roundtrip-recording -- <recording-dir>                   # reconstruct + report
 *   npm run roundtrip-recording -- <recording-dir> --output <dir>    # also write reconstructed files
 *   npm run roundtrip-recording -- <recording-dir> --compare <ref>   # diff against reference tree
 *   npm run roundtrip-recording -- <recording-dir> --verbose         # list every URI's status
 *
 * Exit codes:
 *   0 - reconstruction succeeded for every URI; if --compare given, all files match
 *   1 - at least one reconstruction failure or diff mismatch
 *   2 - usage error
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as url from 'node:url';

// ──────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────

interface RecordedEvent {
    type: string;
    timestamp: number;
    uri?: string;
    snapshotPath?: string;
    changes?: Array<{
        range: unknown;
        rangeOffset: number;
        rangeLength: number;
        text: string;
    }>;
    [key: string]: unknown;
}

interface UriReplayResult {
    uri: string;
    initialSource: 'snapshot' | 'empty';
    textChangeCount: number;
    replayErrors: string[];
    finalContent: string;
    initialContent: string;
}

interface RoundtripReport {
    dir: string;
    totalEvents: number;
    urisWithSnapshot: number;
    urisWithoutSnapshot: number;
    urisReplayed: number;
    urisFailed: number;
    results: UriReplayResult[];
    compareResult?: CompareResult;
}

interface CompareResult {
    referenceDir: string;
    matched: Array<{ uri: string; bytes: number }>;
    mismatched: Array<{ uri: string; reason: string }>;
    skipped: Array<{ uri: string; reason: string }>;
}

// ──────────────────────────────────────────────────────────────────────
// Recording loading + grouping
// ──────────────────────────────────────────────────────────────────────

function loadEvents(dir: string): RecordedEvent[] {
    const eventsPath = path.join(dir, 'events.jsonl');
    if (!fs.existsSync(eventsPath)) {
        throw new Error(`events.jsonl not found in ${dir}`);
    }
    const raw = fs.readFileSync(eventsPath, 'utf-8');
    const lines = raw.split('\n').filter(l => l.length > 0);
    const events: RecordedEvent[] = [];
    for (let i = 0; i < lines.length; i++) {
        try {
            events.push(JSON.parse(lines[i]) as RecordedEvent);
        } catch {
            // tolerate partial-write last line; skip silently (validate-recording surfaces it)
            if (i !== lines.length - 1) {
                throw new Error(`invalid JSON at line ${i + 1} in events.jsonl`);
            }
        }
    }
    return events;
}

function groupByUri(events: RecordedEvent[]): {
    snapshots: Map<string, RecordedEvent>;      // uri -> first fileSnapshot event
    textChanges: Map<string, RecordedEvent[]>;  // uri -> ordered textChange events
} {
    const snapshots = new Map<string, RecordedEvent>();
    const textChanges = new Map<string, RecordedEvent[]>();

    for (const ev of events) {
        if (typeof ev.uri !== 'string') {
            continue;
        }
        if (ev.type === 'fileSnapshot' && !snapshots.has(ev.uri)) {
            snapshots.set(ev.uri, ev);
        } else if (ev.type === 'textChange') {
            const list = textChanges.get(ev.uri) ?? [];
            list.push(ev);
            textChanges.set(ev.uri, list);
        }
    }
    // events.jsonl is already timestamp-ordered on write; trust that
    return { snapshots, textChanges };
}

// ──────────────────────────────────────────────────────────────────────
// Core replay
// ──────────────────────────────────────────────────────────────────────

function replayUri(
    uri: string,
    snapshotEvent: RecordedEvent | undefined,
    textChanges: RecordedEvent[],
    recordingDir: string,
): UriReplayResult {
    const errors: string[] = [];
    let content: string;
    let initialSource: 'snapshot' | 'empty';

    if (snapshotEvent && typeof snapshotEvent.snapshotPath === 'string') {
        const snapPath = path.join(recordingDir, snapshotEvent.snapshotPath);
        if (!fs.existsSync(snapPath)) {
            errors.push(`snapshot file not found: ${snapshotEvent.snapshotPath}`);
            content = '';
            initialSource = 'empty';
        } else {
            content = fs.readFileSync(snapPath, 'utf-8');
            // Strip the [TRUNCATED at 1MB] trailer if present — it's written by the
            // recorder when a snapshot exceeded MAX_SNAPSHOT_BYTES. The trailer makes
            // reconstruction meaningless for that file; flag it as a warning.
            if (content.endsWith('\n[TRUNCATED at 1MB]')) {
                errors.push('initial snapshot was truncated at 1MB (reconstruction unreliable)');
                content = content.slice(0, -'\n[TRUNCATED at 1MB]'.length);
            }
            initialSource = 'snapshot';
        }
    } else {
        // No snapshot — treat as empty file. Valid for create-during-session or
        // for text inputs that entered after the session started (e.g. VS Code
        // outputs). If a large positive rangeOffset appears, we'll flag it.
        content = '';
        initialSource = textChanges.length > 0 ? 'empty' : 'empty';
    }

    const initialContent = content;

    // Apply each textChange. VS Code delivers changes[] already sorted so they
    // can be applied in the given order without invalidating later offsets.
    for (let i = 0; i < textChanges.length; i++) {
        const ev = textChanges[i];
        if (!Array.isArray(ev.changes)) {
            errors.push(`textChange event #${i} (ts=${ev.timestamp}) has no changes array`);
            continue;
        }
        for (let j = 0; j < ev.changes.length; j++) {
            const ch = ev.changes[j];
            const off = ch.rangeOffset;
            const len = ch.rangeLength;
            const text = ch.text;
            if (typeof off !== 'number' || typeof len !== 'number' || typeof text !== 'string') {
                errors.push(`textChange #${i}.${j} (ts=${ev.timestamp}) has malformed fields`);
                continue;
            }
            if (off < 0) {
                errors.push(`textChange #${i}.${j} (ts=${ev.timestamp}) rangeOffset<0: ${off}`);
                continue;
            }
            if (off > content.length) {
                errors.push(
                    `textChange #${i}.${j} (ts=${ev.timestamp}) rangeOffset=${off} ` +
                    `exceeds content.length=${content.length}`,
                );
                continue;
            }
            if (off + len > content.length) {
                errors.push(
                    `textChange #${i}.${j} (ts=${ev.timestamp}) range ${off}+${len}=${off + len} ` +
                    `exceeds content.length=${content.length}`,
                );
                continue;
            }
            content = content.slice(0, off) + text + content.slice(off + len);
        }
    }

    return {
        uri,
        initialSource,
        textChangeCount: textChanges.length,
        replayErrors: errors,
        finalContent: content,
        initialContent,
    };
}

// ──────────────────────────────────────────────────────────────────────
// Optional: compare against reference directory
// ──────────────────────────────────────────────────────────────────────

function uriToLocalFsPath(uri: string): string | undefined {
    try {
        if (uri.startsWith('file://')) {
            return url.fileURLToPath(uri);
        }
        return undefined;
    } catch {
        return undefined;
    }
}

function compareAgainstReference(
    results: UriReplayResult[],
    referenceDir: string,
): CompareResult {
    const matched: CompareResult['matched'] = [];
    const mismatched: CompareResult['mismatched'] = [];
    const skipped: CompareResult['skipped'] = [];

    const refResolved = path.resolve(referenceDir);

    for (const r of results) {
        if (r.replayErrors.length > 0) {
            skipped.push({ uri: r.uri, reason: 'replay had errors' });
            continue;
        }
        const originalFsPath = uriToLocalFsPath(r.uri);
        if (!originalFsPath) {
            skipped.push({ uri: r.uri, reason: 'uri is not file:// scheme' });
            continue;
        }
        // Remap: take the tail of originalFsPath relative to some exercise root, then
        // resolve under referenceDir. We don't know the exercise root a priori, so:
        // strategy = try originalFsPath itself first (if still exists), else look up
        // by basename in referenceDir. Basename match is approximate and only reports
        // when the file exists uniquely.
        let candidate: string | undefined;
        if (originalFsPath.startsWith(refResolved + path.sep) || originalFsPath === refResolved) {
            candidate = originalFsPath;
        } else if (fs.existsSync(path.join(refResolved, path.basename(originalFsPath)))) {
            candidate = path.join(refResolved, path.basename(originalFsPath));
        }
        if (!candidate || !fs.existsSync(candidate)) {
            skipped.push({ uri: r.uri, reason: `no matching file under ${referenceDir}` });
            continue;
        }
        const actual = fs.readFileSync(candidate, 'utf-8');
        if (actual === r.finalContent) {
            matched.push({ uri: r.uri, bytes: r.finalContent.length });
        } else {
            const preview = firstDiff(r.finalContent, actual);
            mismatched.push({
                uri: r.uri,
                reason: `diff at byte ${preview.offset}: ` +
                    `expected '${preview.expected}' vs actual '${preview.actual}'`,
            });
        }
    }

    return { referenceDir, matched, mismatched, skipped };
}

function firstDiff(a: string, b: string): { offset: number; expected: string; actual: string } {
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) {
        if (a[i] !== b[i]) {
            return {
                offset: i,
                expected: JSON.stringify(a.slice(Math.max(0, i - 10), i + 10)),
                actual: JSON.stringify(b.slice(Math.max(0, i - 10), i + 10)),
            };
        }
    }
    if (a.length !== b.length) {
        return {
            offset: n,
            expected: `length=${a.length}`,
            actual: `length=${b.length}`,
        };
    }
    return { offset: -1, expected: '', actual: '' };
}

// ──────────────────────────────────────────────────────────────────────
// Output writer
// ──────────────────────────────────────────────────────────────────────

function writeReconstruction(results: UriReplayResult[], outputDir: string): void {
    fs.mkdirSync(outputDir, { recursive: true });
    const manifest: Array<{ uri: string; file: string; bytes: number; errors: number }> = [];
    for (const r of results) {
        const sanitized = sanitizeForFilename(r.uri);
        const file = path.join(outputDir, sanitized);
        fs.writeFileSync(file, r.finalContent, 'utf-8');
        manifest.push({
            uri: r.uri,
            file: path.basename(file),
            bytes: r.finalContent.length,
            errors: r.replayErrors.length,
        });
    }
    fs.writeFileSync(path.join(outputDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8');
}

function sanitizeForFilename(uri: string): string {
    const tail = uri.split('/').pop() ?? 'unknown';
    const safe = tail.replace(/[^a-zA-Z0-9._-]/g, '_');
    // Simple stable hash of full URI to disambiguate same-basename files
    let h = 0;
    for (let i = 0; i < uri.length; i++) {
        h = ((h << 5) - h + uri.charCodeAt(i)) | 0;
    }
    const hashStr = (h >>> 0).toString(16).padStart(8, '0');
    return `${hashStr}_${safe}`;
}

// ──────────────────────────────────────────────────────────────────────
// Orchestration + CLI
// ──────────────────────────────────────────────────────────────────────

function runRoundtrip(dir: string): RoundtripReport {
    const events = loadEvents(dir);
    const { snapshots, textChanges } = groupByUri(events);

    const allUris = new Set<string>([...snapshots.keys(), ...textChanges.keys()]);
    const results: UriReplayResult[] = [];
    for (const uri of allUris) {
        const snap = snapshots.get(uri);
        const changes = textChanges.get(uri) ?? [];
        results.push(replayUri(uri, snap, changes, dir));
    }
    results.sort((a, b) => a.uri.localeCompare(b.uri));

    const urisWithSnapshot = results.filter(r => r.initialSource === 'snapshot').length;
    const urisWithoutSnapshot = results.filter(r => r.initialSource === 'empty').length;
    const urisFailed = results.filter(r => r.replayErrors.length > 0).length;

    return {
        dir,
        totalEvents: events.length,
        urisWithSnapshot,
        urisWithoutSnapshot,
        urisReplayed: results.length,
        urisFailed,
        results,
    };
}

function printReport(report: RoundtripReport, opts: { verbose: boolean }): boolean {
    const rel = path.relative(process.cwd(), report.dir) || report.dir;
    const pass = report.urisFailed === 0
        && (report.compareResult === undefined
            || (report.compareResult.mismatched.length === 0));

    console.log(`${pass ? '✓' : '✗'} ${rel}`);
    console.log(
        `    events: ${report.totalEvents}, ` +
        `uris: ${report.urisReplayed} (${report.urisWithSnapshot} with snapshot, ` +
        `${report.urisWithoutSnapshot} without), ` +
        `replay failures: ${report.urisFailed}`,
    );

    // Per-URI detail
    for (const r of report.results) {
        const status = r.replayErrors.length === 0 ? '    ✓' : '    ✗';
        if (opts.verbose || r.replayErrors.length > 0) {
            console.log(
                `${status} ${shortUri(r.uri)} ` +
                `[${r.initialSource}, ${r.textChangeCount} changes, ${r.finalContent.length} bytes]`,
            );
            for (const err of r.replayErrors) {
                console.log(`      ERROR ${err}`);
            }
        }
    }

    if (report.compareResult) {
        const cr = report.compareResult;
        console.log(`    compared against: ${cr.referenceDir}`);
        console.log(
            `      matched: ${cr.matched.length}, mismatched: ${cr.mismatched.length}, ` +
            `skipped: ${cr.skipped.length}`,
        );
        for (const m of cr.mismatched) {
            console.log(`      MISMATCH ${shortUri(m.uri)}: ${m.reason}`);
        }
        if (opts.verbose) {
            for (const s of cr.skipped) {
                console.log(`      skip     ${shortUri(s.uri)} (${s.reason})`);
            }
            for (const m of cr.matched) {
                console.log(`      ok       ${shortUri(m.uri)} (${m.bytes} bytes)`);
            }
        }
    }

    return pass;
}

function shortUri(uri: string): string {
    if (uri.length <= 80) {
        return uri;
    }
    return `${uri.slice(0, 30)}…${uri.slice(-45)}`;
}

function main(): void {
    const args = process.argv.slice(2);
    const verbose = args.includes('--verbose');
    const outputIdx = args.indexOf('--output');
    const compareIdx = args.indexOf('--compare');
    const output = outputIdx !== -1 ? args[outputIdx + 1] : undefined;
    const compare = compareIdx !== -1 ? args[compareIdx + 1] : undefined;
    const positionals = args.filter((a, i, arr) => {
        if (a.startsWith('--')) {
            return false;
        }
        // skip value consumed by --output/--compare
        if (i > 0 && (arr[i - 1] === '--output' || arr[i - 1] === '--compare')) {
            return false;
        }
        return true;
    });

    if (positionals.length !== 1) {
        console.error(
            'Usage: npm run roundtrip-recording -- <recording-dir> ' +
            '[--output <dir>] [--compare <ref>] [--verbose]',
        );
        process.exit(2);
    }

    const dir = positionals[0];
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
        console.error(`not a directory: ${dir}`);
        process.exit(2);
    }

    const report = runRoundtrip(dir);
    if (compare) {
        if (!fs.existsSync(compare) || !fs.statSync(compare).isDirectory()) {
            console.error(`--compare target is not a directory: ${compare}`);
            process.exit(2);
        }
        report.compareResult = compareAgainstReference(report.results, compare);
    }
    if (output) {
        writeReconstruction(report.results, output);
    }

    const passed = printReport(report, { verbose });
    process.exit(passed ? 0 : 1);
}

main();
