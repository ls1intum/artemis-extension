/* eslint-disable no-console -- CLI tool; stdout/stderr is the output channel */
/**
 * Event-coverage analysis for a recording.
 *
 * Lists every event type present in events.jsonl with counts, and compares
 * against the full set of event types declared in the recorder's source
 * (extension/src/.../recording/types.ts). Flags:
 *   - expected types that did not appear (coverage gaps)
 *   - types that appeared but are not declared in the source (stale schema?)
 *
 * Useful after a comprehensive "trigger every feature" test session to prove
 * the recorder actually captured every category of event it should.
 *
 * Usage (from extension/):
 *   npm run event-coverage -- <recording-dir>
 *   npm run event-coverage -- <recording-dir> --require=intervention,buildResult
 *   npm run event-coverage -- <recording-dir> --verbose
 *
 * Exit codes:
 *   0 - all source-declared types present (or all --require types present)
 *   1 - at least one expected type missing
 *   2 - usage error
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Reads `extension/src/extension/services/recording/types.ts` and
 * extracts every string literal used as `type: '...'` in the RecordedEvent
 * union, so a new event type in the source is picked up here automatically
 * instead of being duplicated in this tool.
 */
function extractEventTypesFromSource(): string[] {
    const candidates = [
        path.resolve(__dirname, '../src/extension/services/recording/types.ts'),
        path.resolve(process.cwd(), 'src/extension/services/recording/types.ts'),
    ];
    let typesFile: string | undefined;
    for (const c of candidates) {
        if (fs.existsSync(c)) {
            typesFile = c;
            break;
        }
    }
    if (!typesFile) {
        throw new Error(
            'could not locate recording types.ts (tried: ' + candidates.join(', ') + ')',
        );
    }
    const source = fs.readFileSync(typesFile, 'utf-8');
    // Match `type: '<name>'` occurrences inside interface declarations
    const re = /type:\s*['"]([a-zA-Z][a-zA-Z0-9]*)['"]/g;
    const types = new Set<string>();
    let m: RegExpExecArray | null;
    while ((m = re.exec(source)) !== null) {
        types.add(m[1]);
    }
    if (types.size === 0) {
        throw new Error(`no event types found in ${typesFile} — parser regex out of date?`);
    }
    return Array.from(types).sort();
}

function countEventTypes(dir: string): Map<string, number> {
    const eventsPath = path.join(dir, 'events.jsonl');
    if (!fs.existsSync(eventsPath)) {
        throw new Error(`events.jsonl not found in ${dir}`);
    }
    const counts = new Map<string, number>();
    const raw = fs.readFileSync(eventsPath, 'utf-8');
    const lines = raw.split('\n').filter(l => l.length > 0);
    for (let i = 0; i < lines.length; i++) {
        try {
            const obj = JSON.parse(lines[i]) as { type?: unknown };
            if (typeof obj.type === 'string') {
                counts.set(obj.type, (counts.get(obj.type) ?? 0) + 1);
            }
        } catch {
            // tolerate partial-write last line
            if (i !== lines.length - 1) {
                throw new Error(`invalid JSON at line ${i + 1}`);
            }
        }
    }
    return counts;
}

function parseRequire(args: string[]): Set<string> | undefined {
    for (const a of args) {
        if (a.startsWith('--require=')) {
            return new Set(a.slice('--require='.length).split(',').map(s => s.trim()).filter(Boolean));
        }
    }
    return undefined;
}

function main(): void {
    const args = process.argv.slice(2);
    const verbose = args.includes('--verbose');
    const required = parseRequire(args);
    const positionals = args.filter(a => !a.startsWith('--'));

    if (positionals.length !== 1) {
        console.error(
            'Usage: npm run event-coverage -- <recording-dir> ' +
            '[--require=type1,type2,...] [--verbose]',
        );
        process.exit(2);
    }

    const dir = positionals[0];
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
        console.error(`not a directory: ${dir}`);
        process.exit(2);
    }

    const declaredTypes = new Set(extractEventTypesFromSource());
    const counts = countEventTypes(dir);
    const presentTypes = new Set(counts.keys());

    const expected = required ?? declaredTypes;
    const missing = new Set([...expected].filter(t => !presentTypes.has(t)));
    const unknown = new Set([...presentTypes].filter(t => !declaredTypes.has(t)));

    const rel = path.relative(process.cwd(), dir) || dir;
    const pass = missing.size === 0;

    console.log(`${pass ? '✓' : '✗'} ${rel}`);
    console.log(
        `    declared types in source: ${declaredTypes.size}, ` +
        `types present in recording: ${presentTypes.size}, ` +
        `missing: ${missing.size}` +
        (unknown.size > 0 ? `, unknown: ${unknown.size}` : ''),
    );

    const sortedCounts = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
    if (verbose || !pass) {
        console.log('    === Event counts ===');
        for (const [t, c] of sortedCounts) {
            const marker = declaredTypes.has(t) ? ' ' : '?';
            console.log(`    ${marker} ${c.toString().padStart(6)}  ${t}`);
        }
    }

    if (missing.size > 0) {
        console.log(`    === Missing (${required ? 'required' : 'declared'}) ===`);
        for (const t of Array.from(missing).sort()) {
            console.log(`      ${t}`);
        }
    }

    if (unknown.size > 0) {
        console.log('    === Unknown (not declared in source) ===');
        for (const t of Array.from(unknown).sort()) {
            console.log(`      ${t} (${counts.get(t)} occurrences)`);
        }
    }

    process.exit(pass ? 0 : 1);
}

main();
