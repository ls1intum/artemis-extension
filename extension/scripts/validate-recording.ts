/* eslint-disable no-console -- CLI tool; stdout/stderr is the output channel */
/**
 * Validates one or more session recording directories for structural integrity.
 *
 * Usage (from extension/):
 *   npm run validate-recording -- <path>
 *   npm run validate-recording -- <parent-dir>           # auto-discovers recordings one level deep
 *   npm run validate-recording -- <root> --recursive     # recursive discovery
 *   npm run validate-recording -- <path> --verbose       # print all checks, not just failures
 *   npm run validate-recording -- <path> --quiet         # summary only, errors on stderr
 *
 * A recording directory is one that contains an events.jsonl file. Optional metadata.json
 * and snapshots/ sub-directory are also inspected if present.
 *
 * Exit codes:
 *   0 - all recordings passed validation
 *   1 - at least one recording has errors
 *   2 - usage error (bad args, no recordings found)
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { KNOWN_EVENT_TYPES } from '@extension/services/recording/parseRecordedData';

// ──────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────

type Severity = 'error' | 'warn';

interface ValidationIssue {
    severity: Severity;
    code: string;
    message: string;
    line?: number;
}

interface RecordingStats {
    sessionId: string;
    eventCount: number;
    distinctTypes: number;
    durationMs: number;
    schemaVersion: number;
}

interface ValidationResult {
    dir: string;
    stats: RecordingStats | undefined;
    issues: ValidationIssue[];
}

interface RecordedEvent {
    type: string;
    timestamp: number;
    [key: string]: unknown;
}

// ──────────────────────────────────────────────────────────────────────
// Core validator
// ──────────────────────────────────────────────────────────────────────
//
// `KNOWN_EVENT_TYPES` is imported from the runtime parser (derived from its
// EVENT_PARSERS dispatch table) so this script and `parseRecordedEvent` stay in
// lock-step instead of maintaining two hand-synced lists that drift (see #215).
// Unknown types produce warnings, not errors — lets the validator survive
// additive schema changes gracefully.

function validateRecording(dir: string): ValidationResult {
    const issues: ValidationIssue[] = [];
    const eventsPath = path.join(dir, 'events.jsonl');
    const metadataPath = path.join(dir, 'metadata.json');
    const snapshotsDir = path.join(dir, 'snapshots');

    if (!fs.existsSync(eventsPath)) {
        issues.push({ severity: 'error', code: 'A1', message: 'events.jsonl not found' });
        return { dir, stats: undefined, issues };
    }

    const raw = fs.readFileSync(eventsPath, 'utf-8');
    const rawLines = raw.split('\n');
    while (rawLines.length > 0 && rawLines[rawLines.length - 1] === '') {
        rawLines.pop();
    }

    const events: RecordedEvent[] = [];
    let lastLineWasPartial = false;
    for (let i = 0; i < rawLines.length; i++) {
        const line = rawLines[i];
        try {
            events.push(JSON.parse(line) as RecordedEvent);
        } catch (e) {
            const isLast = i === rawLines.length - 1;
            issues.push({
                severity: isLast ? 'warn' : 'error',
                code: 'A2',
                message: isLast
                    ? 'last line is malformed JSON (tolerated as partial-write)'
                    : `invalid JSON: ${(e as Error).message}`,
                line: i + 1,
            });
            if (isLast) {
                lastLineWasPartial = true;
            }
        }
    }

    if (events.length === 0) {
        issues.push({ severity: 'error', code: 'A1', message: 'no parseable events in events.jsonl' });
        return { dir, stats: undefined, issues };
    }

    // B5: event shape
    let lastTimestamp = -Infinity;
    for (let i = 0; i < events.length; i++) {
        const ev = events[i];
        const line = i + 1;
        if (typeof ev !== 'object' || ev === null) {
            issues.push({ severity: 'error', code: 'B5', message: 'event is not an object', line });
            continue;
        }
        if (typeof ev.type !== 'string') {
            issues.push({ severity: 'error', code: 'B5', message: "event missing string 'type'", line });
        } else if (!KNOWN_EVENT_TYPES.has(ev.type)) {
            issues.push({
                severity: 'warn',
                code: 'UNKNOWN_TYPE',
                message: `unknown event type '${ev.type}' (validator may be out of date)`,
                line,
            });
        }
        if (typeof ev.timestamp !== 'number' || !Number.isFinite(ev.timestamp)) {
            issues.push({ severity: 'error', code: 'B5', message: "event missing finite 'timestamp'", line });
        } else {
            if (ev.timestamp < lastTimestamp) {
                issues.push({
                    severity: 'warn',
                    code: 'A7',
                    message: `timestamp regressed (${ev.timestamp} < ${lastTimestamp})`,
                    line,
                });
            }
            lastTimestamp = ev.timestamp;
        }
    }

    // A3: first event is sessionStart
    if (events[0].type !== 'sessionStart') {
        issues.push({
            severity: 'error',
            code: 'A3',
            message: `first event is '${events[0].type}', expected 'sessionStart'`,
            line: 1,
        });
    }

    // A4: last event is sessionEnd (tolerate partial last line)
    const last = events[events.length - 1];
    if (last.type !== 'sessionEnd') {
        issues.push({
            severity: lastLineWasPartial ? 'warn' : 'error',
            code: 'A4',
            message: `last event is '${last.type}', expected 'sessionEnd'`,
            line: events.length,
        });
    }

    // A5: exactly one of each lifecycle marker
    const startCount = events.filter(e => e.type === 'sessionStart').length;
    const endCount = events.filter(e => e.type === 'sessionEnd').length;
    if (startCount !== 1) {
        issues.push({ severity: 'error', code: 'A5', message: `found ${startCount} sessionStart events (expected 1)` });
    }
    if (endCount > 1) {
        issues.push({ severity: 'error', code: 'A5', message: `found ${endCount} sessionEnd events (expected ≤1)` });
    }

    // A6: no events after sessionEnd
    const endIdx = events.findIndex(e => e.type === 'sessionEnd');
    if (endIdx !== -1 && endIdx < events.length - 1) {
        issues.push({
            severity: 'error',
            code: 'A6',
            message: `${events.length - 1 - endIdx} event(s) after sessionEnd`,
            line: endIdx + 2,
        });
    }

    // Schema version: metadata wins, then sessionStart, then 1
    const firstEvent = events[0];
    const sessionStartVersion =
        firstEvent.type === 'sessionStart' && typeof firstEvent.schemaVersion === 'number'
            ? (firstEvent.schemaVersion)
            : undefined;

    let metadataVersion: number | undefined;
    let metadataEventCount: number | undefined;
    if (fs.existsSync(metadataPath)) {
        try {
            const meta = JSON.parse(fs.readFileSync(metadataPath, 'utf-8')) as {
                schemaVersion?: number;
                eventCount?: number;
            };
            metadataVersion = meta.schemaVersion;
            metadataEventCount = meta.eventCount;

            // A8: metadata.eventCount matches jsonl
            if (typeof metadataEventCount === 'number' && metadataEventCount !== events.length) {
                issues.push({
                    severity: 'error',
                    code: 'A8',
                    message: `metadata.eventCount=${metadataEventCount} != actual events=${events.length}`,
                });
            }
        } catch (e) {
            issues.push({
                severity: 'error',
                code: 'METADATA',
                message: `metadata.json invalid: ${(e as Error).message}`,
            });
        }
    }

    const schemaVersion = metadataVersion ?? sessionStartVersion ?? 1;

    // B4: metadata vs sessionStart version consistency
    if (metadataVersion !== undefined && sessionStartVersion !== undefined
        && metadataVersion !== sessionStartVersion) {
        issues.push({
            severity: 'warn',
            code: 'B4',
            message: `schemaVersion mismatch: metadata=${metadataVersion}, sessionStart=${sessionStartVersion}`,
        });
    }

    // B1: startupPhaseComplete exactly once for v≥2 (unless consent-disabled pre-startup)
    if (schemaVersion >= 2) {
        const spcCount = events.filter(e => e.type === 'startupPhaseComplete').length;
        const hasConsentChange = events.some(e => e.type === 'consentChange');
        if (spcCount > 1) {
            issues.push({
                severity: 'error',
                code: 'B1',
                message: `found ${spcCount} startupPhaseComplete events (expected ≤1)`,
            });
        } else if (spcCount === 0 && !hasConsentChange) {
            issues.push({
                severity: 'warn',
                code: 'B1',
                message: 'no startupPhaseComplete and no consentChange (possibly truncated session)',
            });
        }
    }

    // B2: consentChange immediately followed by sessionEnd
    for (let i = 0; i < events.length; i++) {
        if (events[i].type !== 'consentChange') {
            continue;
        }
        const next = i + 1 < events.length ? events[i + 1].type : '<EOF>';
        if (next !== 'sessionEnd') {
            issues.push({
                severity: 'error',
                code: 'B2',
                message: `consentChange not followed immediately by sessionEnd (found '${next}')`,
                line: i + 1,
            });
        }
    }

    // B3: every fileSnapshot references an existing file
    const snapshotRefs = new Set<string>();
    for (let i = 0; i < events.length; i++) {
        const ev = events[i];
        if (ev.type !== 'fileSnapshot') {
            continue;
        }
        const ref = ev.snapshotPath;
        if (typeof ref !== 'string') {
            issues.push({
                severity: 'error',
                code: 'B3',
                message: "fileSnapshot event missing 'snapshotPath' field",
                line: i + 1,
            });
            continue;
        }
        snapshotRefs.add(ref);
        if (!fs.existsSync(path.join(dir, ref))) {
            issues.push({
                severity: 'error',
                code: 'B3',
                message: `fileSnapshot references missing file: ${ref}`,
                line: i + 1,
            });
        }
    }

    // C2: orphan snapshot files
    if (fs.existsSync(snapshotsDir)) {
        const entries = fs.readdirSync(snapshotsDir);
        for (const entry of entries) {
            const rel = `snapshots/${entry}`;
            if (!snapshotRefs.has(rel)) {
                issues.push({
                    severity: 'warn',
                    code: 'C2',
                    message: `orphan snapshot file (no referencing fileSnapshot event): ${rel}`,
                });
            }
        }
    }

    // Stats
    const startTs = typeof firstEvent.timestamp === 'number' ? firstEvent.timestamp : 0;
    const endTs = typeof last.timestamp === 'number' ? last.timestamp : startTs;
    const sessionIdValue = typeof firstEvent.sessionId === 'string' ? firstEvent.sessionId : '<unknown>';
    const distinctTypes = new Set(events.map(e => e.type)).size;

    const stats: RecordingStats = {
        sessionId: sessionIdValue,
        eventCount: events.length,
        distinctTypes,
        durationMs: Math.max(0, endTs - startTs),
        schemaVersion,
    };

    return { dir, stats, issues };
}

// ──────────────────────────────────────────────────────────────────────
// CLI
// ──────────────────────────────────────────────────────────────────────

function formatDuration(ms: number): string {
    const s = Math.floor(ms / 1000);
    if (s < 60) {
        return `${s}s`;
    }
    const m = Math.floor(s / 60);
    const sec = s % 60;
    if (m < 60) {
        return `${m}m ${sec}s`;
    }
    const h = Math.floor(m / 60);
    const min = m % 60;
    return `${h}h ${min}m ${sec}s`;
}

function printResult(result: ValidationResult, opts: { verbose: boolean }): void {
    const errors = result.issues.filter(i => i.severity === 'error');
    const warnings = result.issues.filter(i => i.severity === 'warn');
    const ok = errors.length === 0;

    const rel = path.relative(process.cwd(), result.dir) || result.dir;

    if (result.stats) {
        console.log(
            `${ok ? '✓' : '✗'} ${rel} ` +
            `(${result.stats.eventCount} events, ${result.stats.distinctTypes} types, ` +
            `${formatDuration(result.stats.durationMs)}, schemaV${result.stats.schemaVersion}` +
            (warnings.length > 0 ? `, ${warnings.length} warn` : '') +
            (errors.length > 0 ? `, ${errors.length} error` : '') +
            ')',
        );
    } else {
        console.log(`${ok ? '✓' : '✗'} ${rel} (no stats available)`);
    }

    const toPrint = opts.verbose ? result.issues : result.issues.filter(i => i.severity === 'error' || opts.verbose);
    for (const issue of toPrint) {
        const marker = issue.severity === 'error' ? '  ERROR' : '  warn ';
        const loc = issue.line !== undefined ? ` (line ${issue.line})` : '';
        console.log(`${marker} [${issue.code}]${loc} ${issue.message}`);
    }
}

function findRecordings(root: string, recursive: boolean): string[] {
    if (!fs.existsSync(root)) {
        return [];
    }
    const stat = fs.statSync(root);
    if (!stat.isDirectory()) {
        return [];
    }
    // direct hit
    if (fs.existsSync(path.join(root, 'events.jsonl'))) {
        return [root];
    }
    const results: string[] = [];
    const walk = (d: string, depth: number): void => {
        for (const entry of fs.readdirSync(d)) {
            const p = path.join(d, entry);
            try {
                const s = fs.statSync(p);
                if (!s.isDirectory()) {
                    continue;
                }
                if (fs.existsSync(path.join(p, 'events.jsonl'))) {
                    results.push(p);
                } else if (recursive || depth === 0) {
                    walk(p, depth + 1);
                }
            } catch {
                // ignore permission/io errors
            }
        }
    };
    walk(root, 0);
    return results;
}

function main(): void {
    const args = process.argv.slice(2);
    const verbose = args.includes('--verbose');
    const quiet = args.includes('--quiet');
    const recursive = args.includes('--recursive');
    const paths = args.filter(a => !a.startsWith('--'));

    if (paths.length === 0) {
        console.error('Usage: npm run validate-recording -- <path> [--recursive] [--verbose|--quiet]');
        process.exit(2);
    }

    const recordings: string[] = [];
    for (const p of paths) {
        const found = findRecordings(p, recursive);
        if (found.length === 0) {
            console.error(`no recordings found under: ${p}`);
            continue;
        }
        recordings.push(...found);
    }

    if (recordings.length === 0) {
        process.exit(2);
    }

    const results = recordings.map(validateRecording);
    let passed = 0;
    for (const r of results) {
        const errors = r.issues.filter(i => i.severity === 'error').length;
        if (errors === 0) {
            passed++;
        }
        if (!quiet || errors > 0) {
            printResult(r, { verbose });
        }
    }

    console.log();
    console.log(`Total: ${passed}/${results.length} passed`);
    process.exit(passed === results.length ? 0 : 1);
}

main();
