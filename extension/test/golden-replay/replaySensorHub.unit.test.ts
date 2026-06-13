import { describe, expect, it } from 'vitest';

import type { RecordedEvent, SerializedRange } from '@extension/services/recording/types';
import type {
    BuildResultSignal, DiagnosticsChangeSignal, PasteSignal, SelectionSignal,
    ShellExecutionEndSignal, TaskFeedbackViewSignal, TextChangeSignal, TextDocumentSignal,
    VisibleRangesSignal,
} from '@extension/services/sensing/types';

import { ReplaySensorHub } from './replaySensorHub';

const URI = 'file:///Users/x/exercise/src/Foo.java';
const SNAPSHOT_PATH = 'snapshots/Foo.java.0.txt';
const SESSION_START_MS = 1_000_000_000_000;

function range(startLine: number): SerializedRange {
    return { startLine, startCharacter: 0, endLine: startLine, endCharacter: 0 };
}

/** Build the synthetic recorded stream the harness will drive.
 *  Mirrors real recorder ordering: sessionStart, then startup fileSnapshot with
 *  a timestamp STRICTLY AFTER sessionStart (the recorder uses Date.now() for the
 *  snapshot, captured after the async open-file capture), then the
 *  startupPhaseComplete marker, then runtime events. */
function buildEvents(): RecordedEvent[] {
    return [
        { type: 'sessionStart', timestamp: SESSION_START_MS, exerciseId: 1, participantId: 'P1' },
        // startup snapshot at +20ms (relS > 0, yet still a startup doc because it
        // precedes startupPhaseComplete): seeds FileTextState + readTextDocuments()
        { type: 'fileSnapshot', timestamp: SESSION_START_MS + 20, uri: URI, snapshotPath: SNAPSHOT_PATH },
        { type: 'startupPhaseComplete', timestamp: SESSION_START_MS + 50 },
        // textChange #1 at t=1s: append "X" at offset 5 (one-char insert)
        {
            type: 'textChange', timestamp: SESSION_START_MS + 1000, uri: URI,
            changes: [{ range: range(0), rangeOffset: 5, rangeLength: 0, text: 'X' }],
        },
        // textChange #2 at t=2s: append "YY" at offset 6
        {
            type: 'textChange', timestamp: SESSION_START_MS + 2000, uri: URI,
            changes: [{ range: range(0), rangeOffset: 6, rangeLength: 0, text: 'YY' }],
        },
        // diagnostics at t=3s
        {
            type: 'diagnostics', timestamp: SESSION_START_MS + 3000, uri: URI,
            diagnostics: [{ code: 'E1', message: 'boom', severity: 0, range: range(7), source: 'javac' }],
        },
        // terminal command at t=4s
        {
            type: 'terminalCommand', timestamp: SESSION_START_MS + 4000, command: 'gradle test',
            exitCode: 0, output: '', outputTruncated: false, cwd: undefined,
            terminalName: 'bash', durationMs: 10,
        },
        // build result at t=5s (one failed test)
        {
            type: 'buildResult', timestamp: SESSION_START_MS + 5000, successful: false,
            errorCount: 1, failedTests: ['fail-detail'], buildFailed: false,
            failedTestDetails: [{ testName: 'testA', detail: 'fail-detail' }],
        },
        // task feedback view opened at t=6s
        {
            type: 'taskFeedbackView', action: 'opened', timestamp: SESSION_START_MS + 6000,
            viewId: 'view-1', exerciseId: 1, taskName: 'Task 1',
            testIds: [1], totalTests: 1, passedTests: 0, failedTests: 1,
        },
    ];
}

function resolveSnapshotText(path: string): string {
    if (path === SNAPSHOT_PATH) {
        return 'hello';
    }
    throw new Error(`unexpected snapshot path: ${path}`);
}

describe('ReplaySensorHub — channel mapping + state reads', () => {
    it('seeds readTextDocuments() from startup snapshot before any pump', () => {
        const hub = new ReplaySensorHub(buildEvents(), {
            resolveSnapshotText, pasteMode: 'derive', sessionStartMs: SESSION_START_MS,
        });
        const docs = hub.readTextDocuments();
        expect(docs).toHaveLength(1);
        expect(docs[0].uri.toString()).toBe(URI);
        expect(docs[0].getText()).toBe('hello');
    });

    it('fires every engine-consumed channel once, mapped, at the right time', () => {
        const hub = new ReplaySensorHub(buildEvents(), {
            resolveSnapshotText, pasteMode: 'inject', injectedPasteEventTimes: [],
            sessionStartMs: SESSION_START_MS,
        });

        const textChanges: TextChangeSignal[] = [];
        const opens: TextDocumentSignal[] = [];
        const selections: SelectionSignal[] = [];
        const visibles: VisibleRangesSignal[] = [];
        const diags: DiagnosticsChangeSignal[] = [];
        const shells: ShellExecutionEndSignal[] = [];
        const builds: BuildResultSignal[] = [];
        const feedbacks: TaskFeedbackViewSignal[] = [];

        hub.onDidChangeTextDocument(s => textChanges.push(s));
        hub.onDidOpenTextDocument(s => opens.push(s));
        hub.onDidChangeTextEditorSelection(s => selections.push(s));
        hub.onDidChangeTextEditorVisibleRanges(s => visibles.push(s));
        hub.onDidChangeDiagnostics(s => diags.push(s));
        hub.onDidEndTerminalShellExecution(s => shells.push(s));
        hub.onBuildResult(s => builds.push(s));
        hub.onTaskFeedbackView(s => feedbacks.push(s));

        hub.pumpUpTo(10);

        // textChange: two events, post-change text + mapped contentChanges
        expect(textChanges).toHaveLength(2);
        expect(textChanges[0].ts).toBe(SESSION_START_MS + 1000);
        expect(textChanges[0].event.document.uri.toString()).toBe(URI);
        expect(textChanges[0].event.document.getText()).toBe('helloX'); // post-change
        expect(textChanges[0].event.contentChanges[0].text).toBe('X');
        expect(textChanges[0].event.contentChanges[0].rangeLength).toBe(0);
        expect(textChanges[0].event.contentChanges[0].range.start.line).toBe(0);
        expect(textChanges[1].event.document.getText()).toBe('helloXYY'); // cumulative

        // no open events in this stream
        expect(opens).toHaveLength(0);
        expect(selections).toHaveLength(0);
        expect(visibles).toHaveLength(0);

        // diagnostics channel fired once with the affected URI
        expect(diags).toHaveLength(1);
        expect(diags[0].uris.map(u => u.toString())).toEqual([URI]);
        expect(diags[0].ts).toBe(SESSION_START_MS + 3000);

        // terminal shell-execution end fired once
        expect(shells).toHaveLength(1);
        expect(shells[0].ts).toBe(SESSION_START_MS + 4000);

        // build result: rehydrated DTO with one failed feedback, mapped ts
        expect(builds).toHaveLength(1);
        expect(builds[0].ts).toBe(SESSION_START_MS + 5000);
        expect(builds[0].result.submission?.buildFailed).toBe(false);
        expect((builds[0].result.feedbacks ?? []).map(f => f.detailText)).toEqual(['fail-detail']);

        // task feedback view
        expect(feedbacks).toHaveLength(1);
        expect(feedbacks[0].action).toBe('opened');
        expect(feedbacks[0].viewId).toBe('view-1');
        expect(feedbacks[0].ts).toBe(SESSION_START_MS + 6000);
    });

    it('reflects pumped diagnostics through readDiagnostics()', () => {
        const hub = new ReplaySensorHub(buildEvents(), {
            resolveSnapshotText, pasteMode: 'inject', injectedPasteEventTimes: [],
            sessionStartMs: SESSION_START_MS,
        });
        const uri = hub.readTextDocuments()[0].uri;

        // Before pumping past the diagnostics event, no diagnostics.
        hub.pumpUpTo(2);
        expect(hub.readDiagnostics(uri)).toHaveLength(0);

        // After pumping past t=3s, the recorded error is reflected.
        hub.pumpUpTo(3);
        const ds = hub.readDiagnostics(uri);
        expect(ds).toHaveLength(1);
        expect(ds[0].severity).toBe(0); // DiagnosticSeverity.Error
        expect(ds[0].range.start.line).toBe(7);
        expect(ds[0].code).toBe('E1');
        expect(ds[0].message).toBe('boom');
        expect(hub.readAllDiagnostics().map(([u]) => u.toString())).toEqual([URI]);
    });

    it('inject-mode fires onPasteDetected at the injected times only', () => {
        const hub = new ReplaySensorHub(buildEvents(), {
            resolveSnapshotText, pasteMode: 'inject', injectedPasteEventTimes: [2],
            sessionStartMs: SESSION_START_MS,
        });
        const pastes: PasteSignal[] = [];
        hub.onPasteDetected(s => pastes.push(s));
        hub.pumpUpTo(10);
        // Exactly one injected paste at t=2s; the textChanges do NOT derive pastes.
        expect(pastes).toHaveLength(1);
        expect(pastes[0].ts).toBe(SESSION_START_MS + 2000);
    });

    it('derive-mode fires onPasteDetected from the paste heuristic (the >10-char insert)', () => {
        // textChange #2 inserts "YY" (2 chars, single-line, non-empty range start):
        // does NOT qualify. Add a long insert that DOES qualify under detectPastes.
        const events = buildEvents();
        events.push({
            type: 'textChange', timestamp: SESSION_START_MS + 7000, uri: URI,
            changes: [{ range: range(0), rangeOffset: 8, rangeLength: 0, text: 'this-is-a-long-paste' }],
        });
        const hub = new ReplaySensorHub(events, {
            resolveSnapshotText, pasteMode: 'derive', sessionStartMs: SESSION_START_MS,
        });
        const pastes: PasteSignal[] = [];
        hub.onPasteDetected(s => pastes.push(s));
        hub.pumpUpTo(10);
        // Only the long insert qualifies; the short "X"/"YY" inserts do not.
        expect(pastes).toHaveLength(1);
        expect(pastes[0].ts).toBe(SESSION_START_MS + 7000);
        expect(pastes[0].chars).toBe('this-is-a-long-paste'.length);
    });

    it('preserves original event order for equal timestamps', () => {
        const sameTs = SESSION_START_MS + 1500;
        const events: RecordedEvent[] = [
            { type: 'sessionStart', timestamp: SESSION_START_MS, exerciseId: 1, participantId: 'P1' },
            { type: 'fileSnapshot', timestamp: SESSION_START_MS, uri: URI, snapshotPath: SNAPSHOT_PATH },
            {
                type: 'textChange', timestamp: sameTs, uri: URI,
                changes: [{ range: range(0), rangeOffset: 5, rangeLength: 0, text: 'A' }],
            },
            {
                type: 'textChange', timestamp: sameTs, uri: URI,
                changes: [{ range: range(0), rangeOffset: 6, rangeLength: 0, text: 'B' }],
            },
        ];
        const hub = new ReplaySensorHub(events, {
            resolveSnapshotText, pasteMode: 'inject', injectedPasteEventTimes: [],
            sessionStartMs: SESSION_START_MS,
        });
        const seen: string[] = [];
        hub.onDidChangeTextDocument(s => seen.push(s.event.contentChanges[0].text));
        hub.pumpUpTo(10);
        expect(seen).toEqual(['A', 'B']); // A enqueued first, B second — stable on tie
    });

    it('throws a clear error for read methods not supported in replay', () => {
        const hub = new ReplaySensorHub(buildEvents(), {
            resolveSnapshotText, pasteMode: 'inject', injectedPasteEventTimes: [],
            sessionStartMs: SESSION_START_MS,
        });
        expect(() => hub.readActiveTextEditor()).toThrow(/not supported in replay/);
        expect(() => hub.readTerminals()).toThrow(/not supported in replay/);
    });

    it('returns every snapshot URI from readTextDocuments() (relS and marker irrelevant)', () => {
        // The real recorder writes snapshots lazily on first open/switch, with
        // Date.now() > sessionStartMs and AFTER startupPhaseComplete. Every
        // snapshotted URI is treated as an already-open doc; the marker is not used.
        const hub = new ReplaySensorHub(buildEvents(), {
            resolveSnapshotText, pasteMode: 'derive', sessionStartMs: SESSION_START_MS,
        });
        const docs = hub.readTextDocuments();
        expect(docs.map(d => d.uri.toString())).toEqual([URI]);
        expect(docs[0].getText()).toBe('hello');
    });

    it('returns a post-marker snapshot from readTextDocuments() and pre-seeds its baseline', () => {
        const OTHER = 'file:///Users/x/exercise/src/Bar.java';
        const events = buildEvents();
        // A file opened mid-session: its (single) snapshot lands after the marker.
        events.push(
            { type: 'fileSnapshot', timestamp: SESSION_START_MS + 7000, uri: OTHER, snapshotPath: 'snapshots/Bar.txt' },
            {
                type: 'textChange', timestamp: SESSION_START_MS + 8000, uri: OTHER,
                changes: [{ range: range(0), rangeOffset: 3, rangeLength: 0, text: 'Z' }],
            },
        );
        const resolve = (path: string): string =>
            path === SNAPSHOT_PATH ? 'hello' : path === 'snapshots/Bar.txt' ? 'bar' : (() => { throw new Error(path); })();
        const hub = new ReplaySensorHub(events, {
            resolveSnapshotText: resolve, pasteMode: 'inject', injectedPasteEventTimes: [],
            sessionStartMs: SESSION_START_MS,
        });
        // Both snapshotted URIs are returned (insertion order); the marker is ignored.
        expect(hub.readTextDocuments().map(d => d.uri.toString())).toEqual([URI, OTHER]);
        // Bar's baseline was pre-seeded, so the post-marker textChange applies
        // against 'bar' (no unseeded-apply throw) and reconstructs correctly.
        const seen: { uri: string; text: string }[] = [];
        hub.onDidChangeTextDocument(s => seen.push({ uri: s.event.document.uri.toString(), text: s.event.document.getText() }));
        hub.pumpUpTo(10);
        const barChange = seen.find(s => s.uri === OTHER)!;
        expect(barChange.text).toBe('barZ');
    });

    it('throws on a duplicate fileSnapshot for the same URI (recorder contract)', () => {
        const events = buildEvents();
        events.push({ type: 'fileSnapshot', timestamp: SESSION_START_MS + 9000, uri: URI, snapshotPath: SNAPSHOT_PATH });
        expect(() => new ReplaySensorHub(events, {
            resolveSnapshotText, pasteMode: 'inject', injectedPasteEventTimes: [],
            sessionStartMs: SESSION_START_MS,
        })).toThrow(/duplicate fileSnapshot/);
    });

    it('fails loud when inject pastes have no snapshot URI to anchor', () => {
        const events: RecordedEvent[] = [
            { type: 'sessionStart', timestamp: SESSION_START_MS, exerciseId: 1, participantId: 'P1' },
            { type: 'startupPhaseComplete', timestamp: SESSION_START_MS + 50 },
            // no fileSnapshot at all
        ];
        expect(() => new ReplaySensorHub(events, {
            resolveSnapshotText, pasteMode: 'inject', injectedPasteEventTimes: [2],
            sessionStartMs: SESSION_START_MS,
        })).toThrow(/injected pastes require/);
    });
});
