// Local golden-replay verification (NOT a CI gate). Skipped unless both
// IRIS_STUDY_DATA (the study data root containing "VSCode Recorded Data/") and
// GOLDEN_DIR (the Python-exported goldens from 26_export_ts_goldens.py) are set.
//
// exact mode: replays each recorded session through the TS engine with the
// reference's N1 paste times injected, and asserts tick-for-tick equality with
// the frozen Python reference (exact decision surface: sBase, boundaries, alerts).
//
// causal mode: replays with the TS engine deriving everything online, and
// REPORTS (does not assert) the divergence from the offline reference — the
// N1 paste-boundary deviation. Numbers are printed locally and intentionally
// never committed.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import type { RecordedEvent } from '@extension/services/recording/types';

import {
    type CausalReport,
    compareExact,
    parseGoldenSession,
    replaySession,
    summarizeCausal,
} from './index';
import {
    assertEveryChangeHasSnapshot,
    assertSpecConstants,
} from './invariants';

const DATA_ROOT = process.env.IRIS_STUDY_DATA;
const GOLDEN_DIR = process.env.GOLDEN_DIR;
const TRUNCATED_TRAILER = '\n[TRUNCATED at 1MB]';

function findSessionFolder(sessionsDir: string, pid: string): string {
    const match = fs.readdirSync(sessionsDir).find(d => d.startsWith(`${pid}-`));
    if (!match) {
        throw new Error(`no session folder for ${pid} under ${sessionsDir}`);
    }
    return path.join(sessionsDir, match);
}

function readEvents(eventsPath: string): RecordedEvent[] {
    return fs.readFileSync(eventsPath, 'utf8')
        .split('\n')
        .map(l => l.trim())
        .filter(l => l.length > 0)
        .map(l => JSON.parse(l) as RecordedEvent);
}

describe('golden replay (local, study dataset)', () => {
    // Skip cleanly with no filesystem I/O when the dataset/goldens are absent
    // (describe.skipIf still evaluates the body, so the readdir must be guarded).
    if (!DATA_ROOT || !GOLDEN_DIR) {
        it.skip('skipped: set IRIS_STUDY_DATA and GOLDEN_DIR to run the dataset verification', () => { /* no dataset available */ });
        return;
    }
    const sessionsDir = path.join(DATA_ROOT, 'VSCode Recorded Data');
    const goldenFiles = fs.readdirSync(GOLDEN_DIR)
        .filter(f => f.endsWith('.json'))
        .sort();
    const causalSummaries: { pid: string; summary: CausalReport }[] = [];

    for (const file of goldenFiles) {
        const pid = path.basename(file, '.json');

        it(`${pid}: exact-mode tick-for-tick match against the Python reference`, () => {
            const golden = parseGoldenSession(
                JSON.parse(fs.readFileSync(path.join(GOLDEN_DIR, file), 'utf8')),
            );
            assertSpecConstants(golden);

            const folder = findSessionFolder(sessionsDir, pid);
            const meta = JSON.parse(fs.readFileSync(path.join(folder, 'metadata.json'), 'utf8'));
            const sessionStartMs: number = meta.startTime;
            const durationS = (meta.endTime - meta.startTime) / 1000;
            const events = readEvents(path.join(folder, 'events.jsonl'));

            // Invariants the harness depends on (fail loud, not silently wrong).
            assertEveryChangeHasSnapshot(events);

            const resolveSnapshotText = (snapshotPath: string): string => {
                let text = fs.readFileSync(path.join(folder, snapshotPath), 'utf8');
                if (text.endsWith(TRUNCATED_TRAILER)) {
                    text = text.slice(0, -TRUNCATED_TRAILER.length);
                }
                return text;
            };

            // exact: inject the reference's N1 paste times; the decision surface must match.
            const exact = replaySession(events, {
                mode: 'exact', inject: golden.inject, sessionStartMs, durationS, resolveSnapshotText,
            });
            const report = compareExact(exact, golden);
            if (!report.ok) {
                throw new Error(`${pid} exact-mode divergence: ${JSON.stringify(report.firstDivergence)}`);
            }
            expect(report.ok).toBe(true);

            // causal: TS derives A8/N2/paste online; report (do not assert) the divergence.
            const causal = replaySession(events, {
                mode: 'causal', sessionStartMs, durationS, resolveSnapshotText,
            });
            const summary = summarizeCausal(causal, golden);
            causalSummaries.push({ pid, summary });
             
            console.log(`[causal ${pid}] ${JSON.stringify(summary)}`);
        });
    }

    afterAll(() => {
        if (causalSummaries.length === 0) { return; }
         
        console.log('\n=== causal-mode divergence (live-vs-reference, local only) ===');
        for (const { pid, summary } of causalSummaries) {
             
            console.log(
                `${pid}: ticks=${summary.ticksCompared} (Δcount ${summary.tickCountDelta}) ` +
                `N1≠ ${summary.pasteBoundaryDisagreeTicks} ` +
                `alerts ts=${summary.alertCountReplay}/ref=${summary.alertCountGolden} (Δ ${summary.alertCountDelta}) ` +
                `alert-only ts/ref ${summary.alertTimesOnlyInReplay}/${summary.alertTimesOnlyInGolden} ` +
                `fieldΔ ${summary.alertSharedTimeFieldMismatches}`,
            );
        }
    });
});
