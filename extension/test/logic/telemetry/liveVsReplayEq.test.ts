import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, expect, it, vi } from 'vitest';

// CompileEquivalentEmitter allocates a `new vscode.EventEmitter()` in a field
// initializer, so constructing it (to drive the REAL live snapshot builder)
// needs that symbol. Mirror the shared vitest vscode stub (DiagnosticSeverity +
// Uri) and add a minimal EventEmitter; nothing else here touches vscode at runtime.
vi.mock('vscode', () => {
    class EventEmitter {
        event = (): { dispose(): void } => ({ dispose: () => { /* no-op */ } });
        fire(): void { /* no-op */ }
        dispose(): void { /* no-op */ }
    }
    const Uri = {
        parse(value: string) {
            try {
                const url = new URL(value);
                const p = decodeURIComponent(url.pathname);
                return { scheme: url.protocol.replace(':', ''), authority: url.host, path: p, fsPath: p, toString: () => value };
            } catch {
                return { scheme: '', authority: '', path: value, fsPath: value, toString: () => value };
            }
        },
    };
    const DiagnosticSeverity = { Error: 0, Warning: 1, Information: 2, Hint: 3 };
    return { EventEmitter, Uri, DiagnosticSeverity };
});

import { CompileEquivalentEmitter } from '@extension/services/telemetry/eventPipeline/compileEquivalentEmitter';
import { ErrorQuotientEngine } from '@extension/services/telemetry/metrics/errorQuotientEngine';
import { collectBuildResult } from '@extension/services/telemetry/recording/eventCollectors';
import { parseRecordedEvent } from '@extension/services/telemetry/recording/parseRecordedData';
import { RecordingStorageWriter } from '@extension/services/telemetry/recording/storageWriter';
import type { RecordedEvent } from '@extension/services/telemetry/recording/types';
import { replaySession } from '@extension/services/telemetry/replay/replayEngine';
import type { ResultDTO } from '@extension/types';

function failedBuild(texts: string[]): ResultDTO {
    return {
        successful: false,
        submission: { buildFailed: true },
        feedbacks: texts.map(text => ({ positive: false, text })),
    } as unknown as ResultDTO;
}

function cleanBuild(): ResultDTO {
    return {
        successful: true,
        submission: { buildFailed: false },
        feedbacks: [{ positive: true, text: 'all tests passed' }],
    } as unknown as ResultDTO;
}

// A varied 8-build sequence: shared-family pairs (raise EQ via the +same-type
// weight), distinct families, and a clean build (no errors) so the curve rises,
// dips, and crosses into 'sufficient' confidence (>= 7 accepted snapshots).
const SEQUENCE: ResultDTO[] = [
    failedBuild(['Cannot find symbol foo']),
    failedBuild(['Cannot find symbol foo']),               // shared family with the previous build
    failedBuild(['Incompatible types: int cannot be String']),
    failedBuild(['Incompatible types: int cannot be String']), // shared family with the previous build
    cleanBuild(),                                          // no errors -> the curve dips
    failedBuild(['Missing return statement']),
    failedBuild(['Cannot find symbol bar', 'Missing return statement']),
    failedBuild(['Cannot find symbol foo']),
];

const BASE_TS = 1_700_000_000_000;
const STEP_MS = 10_000; // > 5s apart so neither the live engine nor replay dedups any snapshot

interface EqPoint { eq: number; confidence: string; errorCount: number; families: string[] }

describe('live EQ == replay EQ across a build sequence (fidelity round-trip)', () => {
    it('reproduces the live EQ curve from the recorded JSONL via replay, element-by-element', async () => {
        const emitter = new CompileEquivalentEmitter();
        const liveEngine = new ErrorQuotientEngine();

        const liveSeries: EqPoint[] = [];
        const recordedEvents: RecordedEvent[] = [];

        SEQUENCE.forEach((dto, i) => {
            const ts = BASE_TS + i * STEP_MS;

            // LIVE path: the production compile-emitter snapshot creation feeding the EQ engine.
            const snapshot = emitter.createErrorSnapshotFromBuildResult(dto);
            snapshot.timestamp = ts;
            if (liveEngine.addSnapshot(snapshot)) {
                const { eq, confidence } = liveEngine.getCurrentEQ();
                liveSeries.push({ eq, confidence, errorCount: snapshot.errorCount, families: [...snapshot.errorFamilies].sort() });
            }

            // RECORD path: the production buildResult collector, stamped with the same timestamp.
            const event = collectBuildResult(dto);
            event.timestamp = ts;
            recordedEvents.push(event);
        });

        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'artemis-fidelity-'));
        const sessionId = 'fidelity-session';
        const writer = new RecordingStorageWriter(tmpDir);
        let replaySeries: ReturnType<typeof replaySession> = [];
        try {
            await writer.initSession(sessionId);
            for (const ev of recordedEvents) {
                writer.appendEvent(ev);
            }
            await writer.shutdown();

            const jsonlPath = path.join(tmpDir, 'recordings', sessionId, 'events.jsonl');
            const lines = fs.readFileSync(jsonlPath, 'utf8').split('\n').filter(l => l.trim().length > 0);
            const parsed = lines
                .map(l => parseRecordedEvent(JSON.parse(l)))
                .filter((e): e is RecordedEvent => e !== null);

            // The strict parser must accept every recorded buildResult event.
            expect(parsed.length).toBe(recordedEvents.length);

            replaySeries = replaySession(parsed).filter(s => s.source === 'build');
        } finally {
            await writer.shutdown(); // idempotent; guarantees the flush timer is cleared even on failure
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }

        // Anti-vacuous guards: a real, non-trivial curve that crosses into 'sufficient'.
        expect(liveSeries.length).toBe(SEQUENCE.length);
        expect(replaySeries.length).toBe(liveSeries.length);
        expect(liveSeries.some(p => p.confidence === 'sufficient')).toBe(true);
        expect(new Set(liveSeries.map(p => p.eq)).size).toBeGreaterThan(1);

        // Element-wise fidelity across the WHOLE sequence: eq, confidence, errorCount, families.
        // Live snapshots come from createErrorSnapshotFromBuildResult; replay snapshots come from
        // createSnapshotFromBuildEvent over the on-disk JSONL. They agree only because both consume
        // the shared buildErrorFamily builder and the same ErrorQuotientEngine.
        replaySeries.forEach((r, i) => {
            const live = liveSeries[i];
            expect(r.eq).toBe(live.eq);
            expect(r.confidence).toBe(live.confidence);
            expect(r.errorCount).toBe(live.errorCount);
            expect([...r.errorFamilies].sort()).toEqual(live.families);
        });
    });
});
