/**
 * A `SensorHub` that replays a recorded session into the struggle engine.
 *
 * The engine has ONE intake path for live and replay (struggleEngine.ts §5): it
 * subscribes to the hub channels and reads the hub's state methods. This class
 * turns a `RecordedEvent[]` into exactly those channel signals, reconstructing
 * file text (recorded textDocumentOpen/textChange carry no text) and diagnostics
 * state along the way.
 *
 * Determinism: every recorded event is mapped to a queue entry stamped with its
 * session-relative time and its ORIGINAL index. `pumpUpTo(tS)` fires all
 * not-yet-fired entries with time <= tS, sorted by (time, originalIndex) so
 * equal timestamps preserve recording order (the engine's own intake queue is
 * stable-sorted the same way — struggleEngine.ts#_drainUpTo).
 *
 * Signal `ts` convention: the engine computes `relS(ts) = (ts - sessionStartMs)
 * / 1000`, so every fired signal carries `ts = sessionStartMs + tSeconds * 1000`.
 * Recorded events store absolute `timestamp` already on that clock, so we reuse
 * it verbatim; injected pastes are stamped `sessionStartMs + t * 1000`.
 *
 * Read methods the engine never calls in replay throw rather than return fake
 * data: a silent fake would mask an engine change that starts reading them.
 */
import * as vscode from 'vscode';

import type { RecordedEvent } from '@extension/services/recording/types';
import { detectPastes } from '@extension/services/sensing/collectors/paste';
import type { SensorHub } from '@extension/services/sensing/sensorHub';
import type {
    ActiveEditorSignal, BreakpointsSignal, BuildResultSignal, DebugSessionSignal,
    DiagnosticsChangeSignal, DiagnosticsSettledSignal, FileRenameSignal, FileSetSignal,
    PasteSignal, SaveSignal, SelectionSignal, ShellExecutionEndSignal, ShellExecutionStartSignal,
    TaskFeedbackViewSignal, TerminalSignal, TextChangeSignal, TextDocumentSignal,
    VisibleRangesSignal, WindowStateSignal,
} from '@extension/services/sensing/types';

import { rehydrateResultDTO } from './buildResultRehydrate';
import { makeDocument, makeEditor, makeUri } from './fakeVscode';
import { FileTextState } from './textReconstruction';

export interface ReplaySensorHubOptions {
    /** Resolve a recorded snapshot path to its text. Injected to keep the hub
     *  disk-free and unit-testable. */
    readonly resolveSnapshotText: (snapshotPath: string) => string;
    /** 'derive' runs each textChange through the live paste heuristic; 'inject'
     *  derives nothing and instead fires pastes at `injectedPasteEventTimes`. */
    readonly pasteMode: 'derive' | 'inject';
    /** Session-relative seconds for injected pastes. Required in 'inject' mode. */
    readonly injectedPasteEventTimes?: number[];
    /** Absolute ms of session start; signal ts = sessionStartMs + tSeconds*1000. */
    readonly sessionStartMs: number;
}

/** One queued signal: its session-relative time, recording index (tie-break),
 *  and the side effect that fires it. */
interface QueuedSignal {
    readonly tS: number;
    readonly seq: number;
    readonly fire: () => void;
}

export class ReplaySensorHub implements SensorHub {
    // ── channel emitters ────────────────────────────────────────────────
    // Engine-consumed channels get fired; the remaining interface members are
    // backed by idle emitters that never fire (the engine never subscribes).
    private readonly _textChange = new vscode.EventEmitter<TextChangeSignal>();
    private readonly _save = new vscode.EventEmitter<SaveSignal>();
    private readonly _activeEditor = new vscode.EventEmitter<ActiveEditorSignal>();
    private readonly _diagnostics = new vscode.EventEmitter<DiagnosticsChangeSignal>();
    private readonly _diagnosticsSettled = new vscode.EventEmitter<DiagnosticsSettledSignal>();
    private readonly _windowState = new vscode.EventEmitter<WindowStateSignal>();
    private readonly _selection = new vscode.EventEmitter<SelectionSignal>();
    private readonly _visibleRanges = new vscode.EventEmitter<VisibleRangesSignal>();
    private readonly _terminalOpen = new vscode.EventEmitter<TerminalSignal>();
    private readonly _terminalClose = new vscode.EventEmitter<TerminalSignal>();
    private readonly _fileCreate = new vscode.EventEmitter<FileSetSignal>();
    private readonly _fileDelete = new vscode.EventEmitter<FileSetSignal>();
    private readonly _fileRename = new vscode.EventEmitter<FileRenameSignal>();
    private readonly _docOpen = new vscode.EventEmitter<TextDocumentSignal>();
    private readonly _docClose = new vscode.EventEmitter<TextDocumentSignal>();
    private readonly _debugStart = new vscode.EventEmitter<DebugSessionSignal>();
    private readonly _debugTerminate = new vscode.EventEmitter<DebugSessionSignal>();
    private readonly _debugActive = new vscode.EventEmitter<DebugSessionSignal>();
    private readonly _breakpoints = new vscode.EventEmitter<BreakpointsSignal>();
    private readonly _shellStart = new vscode.EventEmitter<ShellExecutionStartSignal>();
    private readonly _shellEnd = new vscode.EventEmitter<ShellExecutionEndSignal>();
    private readonly _buildResult = new vscode.EventEmitter<BuildResultSignal>();
    private readonly _taskFeedbackView = new vscode.EventEmitter<TaskFeedbackViewSignal>();
    private readonly _pasteDetected = new vscode.EventEmitter<PasteSignal>();

    readonly onDidChangeTextDocument = this._textChange.event;
    readonly onDidSaveTextDocument = this._save.event;
    readonly onDidChangeActiveTextEditor = this._activeEditor.event;
    readonly onDidChangeDiagnostics = this._diagnostics.event;
    readonly onDiagnosticsSettled = this._diagnosticsSettled.event;
    readonly onDidChangeWindowState = this._windowState.event;
    readonly onDidChangeTextEditorSelection = this._selection.event;
    readonly onDidChangeTextEditorVisibleRanges = this._visibleRanges.event;
    readonly onDidOpenTerminal = this._terminalOpen.event;
    readonly onDidCloseTerminal = this._terminalClose.event;
    readonly onDidCreateFiles = this._fileCreate.event;
    readonly onDidDeleteFiles = this._fileDelete.event;
    readonly onDidRenameFiles = this._fileRename.event;
    readonly onDidOpenTextDocument = this._docOpen.event;
    readonly onDidCloseTextDocument = this._docClose.event;
    readonly onDidStartDebugSession = this._debugStart.event;
    readonly onDidTerminateDebugSession = this._debugTerminate.event;
    readonly onDidChangeActiveDebugSession = this._debugActive.event;
    readonly onDidChangeBreakpoints = this._breakpoints.event;
    readonly onDidStartTerminalShellExecution = this._shellStart.event;
    readonly onDidEndTerminalShellExecution = this._shellEnd.event;
    readonly onBuildResult = this._buildResult.event;
    readonly onTaskFeedbackView = this._taskFeedbackView.event;
    readonly onPasteDetected = this._pasteDetected.event;

    // ── replay state ────────────────────────────────────────────────────
    private readonly _opts: ReplaySensorHubOptions;
    private readonly _fileText = new FileTextState();
    /** URIs whose fileSnapshot precedes startupPhaseComplete; readTextDocuments()
     *  returns exactly these (the docs the engine treats as already-open). */
    private readonly _startupUris: string[] = [];
    /** Current diagnostics, by URI string, as of the last pumped diagnostics event. */
    private readonly _diagByUri = new Map<string, vscode.Diagnostic[]>();
    private readonly _queue: QueuedSignal[];
    private _cursor = 0;

    constructor(events: RecordedEvent[], opts: ReplaySensorHubOptions) {
        this._opts = opts;
        if (opts.pasteMode === 'inject' && opts.injectedPasteEventTimes === undefined) {
            throw new Error("ReplaySensorHub: pasteMode 'inject' requires injectedPasteEventTimes");
        }
        this._seedSnapshots(events);
        if (
            opts.pasteMode === 'inject'
            && (opts.injectedPasteEventTimes?.length ?? 0) > 0
            && this._startupUris.length === 0
        ) {
            // Injected pastes must attach to a real in-root URI or the engine's
            // shouldRecordUri filter silently drops every N1. Fail loud rather
            // than fabricate an out-of-root URI.
            throw new Error('ReplaySensorHub: injected pastes require at least one startup file snapshot to anchor the URI');
        }
        this._queue = this._buildQueue(events);
    }

    // ── startup seeding ─────────────────────────────────────────────────

    private _relS(timestampMs: number): number {
        return (timestampMs - this._opts.sessionStartMs) / 1000;
    }

    /**
     * Seed FileTextState from EVERY recorded fileSnapshot up front, and record
     * which URIs are "startup" (snapshotted before startupPhaseComplete).
     *
     * fileSnapshot is not a runtime mutation in the recorder: each URI is
     * snapshotted at most once per session (snapshotManager gates on
     * _snapshotedUris), the content is captured synchronously at open/switch
     * time, and all of that URI's textChange offsets are relative to that single
     * baseline (exactly like roundtrip-recording.ts). Installing every baseline
     * before any pump therefore (a) guarantees the baseline exists before the
     * first textChange regardless of recording order (the snapshot event is
     * written only after async I/O, so it can land AFTER an early edit), and
     * (b) makes a mid-stream rollback impossible. Snapshots are never re-applied
     * from the pump queue.
     *
     * The recorder writes sessionStart, THEN the startup fileSnapshots (with
     * Date.now() > sessionStartTs, i.e. relS > 0), THEN one startupPhaseComplete
     * marker — its documented "seed state vs runtime events" cut-point. Snapshots
     * before that marker are the already-open docs the engine seeds in start().
     * Fallback when no marker exists (truncated recording): treat snapshots
     * before the first textChange as startup.
     */
    private _seedSnapshots(events: RecordedEvent[]): void {
        // Cut-point: the index of the first startupPhaseComplete marker; snapshots
        // before it are startup. Authoritative when the marker exists. Fallback
        // for marker-less (truncated) recordings: the first textChange index, or
        // the end of the stream if neither marker nor textChange exists.
        const markerIdx = events.findIndex(e => e.type === 'startupPhaseComplete');
        const firstChangeIdx = events.findIndex(e => e.type === 'textChange');
        let startupCutIdx: number;
        if (markerIdx >= 0) {
            startupCutIdx = markerIdx;
        } else if (firstChangeIdx >= 0) {
            startupCutIdx = firstChangeIdx;
        } else {
            startupCutIdx = events.length;
        }

        const seeded = new Set<string>();
        events.forEach((ev, idx) => {
            if (ev.type !== 'fileSnapshot') {
                return;
            }
            if (seeded.has(ev.uri)) {
                // Enforce the one-snapshot-per-URI recorder contract: a second
                // snapshot for a URI would make the single-baseline model unsafe.
                throw new Error(`ReplaySensorHub: duplicate fileSnapshot for URI "${ev.uri}"`);
            }
            this._fileText.seedSnapshot(ev.uri, this._opts.resolveSnapshotText(ev.snapshotPath));
            seeded.add(ev.uri);
            if (idx < startupCutIdx) {
                this._startupUris.push(ev.uri);
            }
        });
    }

    // ── queue construction ──────────────────────────────────────────────

    /** Map every recorded event (and injected pastes) to a queued signal. */
    private _buildQueue(events: RecordedEvent[]): QueuedSignal[] {
        const queue: QueuedSignal[] = [];
        let seq = 0;
        const push = (tS: number, fire: () => void): void => {
            queue.push({ tS, seq: seq++, fire });
        };

        for (const ev of events) {
            const tS = this._relS(ev.timestamp);
            switch (ev.type) {
                case 'fileSnapshot':
                    // All snapshots are pre-seeded into FileTextState at construction
                    // (see _seedSnapshots); they are baselines, never pumped mutations.
                    break;
                case 'textDocumentOpen':
                    push(tS, () => this._fireDocOpen(ev.uri, ev.timestamp));
                    break;
                case 'textChange': {
                    const { uri, changes } = ev;
                    // Paste derivation (derive mode) rides the SAME queue entry as
                    // its textChange (inside _fireTextChange), so it can never be
                    // reordered relative to the change that produced it.
                    push(tS, () => this._fireTextChange(uri, changes, ev.timestamp));
                    break;
                }
                case 'selectionChange':
                    push(tS, () => this._fireSelection(ev.uri, ev.selections, ev.timestamp));
                    break;
                case 'visibleRangeChange':
                    push(tS, () => this._fireVisibleRanges(ev.uri, ev.visibleRanges, ev.timestamp));
                    break;
                case 'diagnostics':
                    push(tS, () => this._fireDiagnostics(ev.uri, ev.diagnostics, ev.timestamp));
                    break;
                case 'terminalCommand':
                    push(tS, () => this._shellEnd.fire(
                        { ts: ev.timestamp, event: {} as vscode.TerminalShellExecutionEndEvent },
                    ));
                    break;
                case 'buildResult':
                    push(tS, () => this._buildResult.fire({ ts: ev.timestamp, result: rehydrateResultDTO(ev) }));
                    break;
                case 'taskFeedbackView':
                    push(tS, () => this._taskFeedbackView.fire(
                        { ts: ev.timestamp, action: ev.action, viewId: ev.viewId },
                    ));
                    break;
                default:
                    // Every other recorded event type is not consumed by the engine.
                    break;
            }
        }

        if (this._opts.pasteMode === 'inject') {
            // The constructor guarantees a startup URI exists whenever there are
            // injected paste times, so _startupUris[0] is always defined here.
            const uriKey = this._startupUris[0];
            for (const t of this._opts.injectedPasteEventTimes ?? []) {
                const tsMs = this._opts.sessionStartMs + t * 1000;
                // chars/lines are unused by the engine — it reads only ts + uri for
                // the N1 boundary — so they carry placeholder values.
                push(t, () => this._pasteDetected.fire(
                    { ts: tsMs, uri: makeUri(uriKey), chars: 0, lines: 1 },
                ));
            }
        }

        queue.sort((a, b) => (a.tS - b.tS) || (a.seq - b.seq));
        return queue;
    }

    // ── fire helpers ────────────────────────────────────────────────────

    private _fireDocOpen(uri: string, tsMs: number): void {
        if (!this._fileText.has(uri)) {
            // textDocumentOpen carries no text; without a prior snapshot there is
            // nothing to reconstruct. Seed empty so getText() never returns undefined.
            this._fileText.seedSnapshot(uri, '');
        }
        const text = this._fileText.getText(uri) ?? '';
        this._docOpen.fire({ ts: tsMs, document: makeDocument(makeUri(uri), () => text) });
    }

    private _fireTextChange(
        uri: string,
        changes: {
            range: { startLine: number; endLine: number };
            rangeOffset: number;
            rangeLength: number;
            text: string;
        }[],
        tsMs: number,
    ): void {
        this._fileText.applyChanges(uri, changes);
        // Snapshot the post-change text NOW: the engine reads document.getText()
        // synchronously in its handler, but tests may capture the signal and read
        // it later, after further changes have mutated FileTextState.
        const postText = this._fileText.getText(uri) ?? '';
        const contentChanges = changes.map(c => ({
            range: {
                start: { line: c.range.startLine },
                // Paste heuristic reads range.isEmpty / range.isSingleLine; derive
                // both from the recorded range (rangeLength==0 ⇒ pure insert).
                isEmpty: c.rangeLength === 0,
                isSingleLine: c.range.startLine === c.range.endLine,
            },
            rangeOffset: c.rangeOffset,
            rangeLength: c.rangeLength,
            text: c.text,
        }));
        const signal: TextChangeSignal = {
            ts: tsMs,
            event: {
                document: makeDocument(makeUri(uri), () => postText),
                contentChanges,
            } as unknown as vscode.TextDocumentChangeEvent,
        };
        this._textChange.fire(signal);

        if (this._opts.pasteMode === 'derive') {
            for (const paste of detectPastes(signal)) {
                this._pasteDetected.fire(paste);
            }
        }
    }

    private _fireSelection(uri: string, selections: { endLine: number }[], tsMs: number): void {
        const editor = makeEditor(makeUri(uri), selections.map(s => ({ end: { line: s.endLine } })));
        this._selection.fire({
            ts: tsMs,
            event: { textEditor: editor, selections: editor.selections } as unknown as vscode.TextEditorSelectionChangeEvent,
        });
    }

    private _fireVisibleRanges(
        uri: string,
        visibleRanges: { startLine: number; endLine: number }[],
        tsMs: number,
    ): void {
        const editor = makeEditor(
            makeUri(uri), [],
            visibleRanges.map(r => ({ start: { line: r.startLine }, end: { line: r.endLine } })),
        );
        this._visibleRanges.fire({
            ts: tsMs,
            event: { textEditor: editor, visibleRanges: editor.visibleRanges } as unknown as vscode.TextEditorVisibleRangesChangeEvent,
        });
    }

    private _fireDiagnostics(
        uri: string,
        diagnostics: { code: string | number | undefined; message: string; severity: number; range: { startLine: number } }[],
        tsMs: number,
    ): void {
        const rehydrated = diagnostics.map(d => ({
            severity: d.severity === 0 ? vscode.DiagnosticSeverity.Error : (d.severity as vscode.DiagnosticSeverity),
            range: { start: { line: d.range.startLine } },
            code: d.code,
            message: d.message,
        } as unknown as vscode.Diagnostic));
        this._diagByUri.set(uri, rehydrated);
        this._diagnostics.fire({ ts: tsMs, uris: [makeUri(uri)] });
    }

    // ── pump ────────────────────────────────────────────────────────────

    /** Fire all not-yet-fired signals with session-relative time <= tS. */
    pumpUpTo(tS: number): void {
        while (this._cursor < this._queue.length && this._queue[this._cursor].tS <= tS) {
            this._queue[this._cursor].fire();
            this._cursor++;
        }
    }

    // ── internal sources (engine never pushes these in replay) ──────────

    emitBuildResult(): void {
        throw new Error('not supported in replay: emitBuildResult (use recorded buildResult events)');
    }
    emitTaskFeedbackView(): void {
        throw new Error('not supported in replay: emitTaskFeedbackView (use recorded taskFeedbackView events)');
    }

    // ── state reads ─────────────────────────────────────────────────────

    readTextDocuments(): readonly vscode.TextDocument[] {
        return this._startupUris.map(uri =>
            makeDocument(makeUri(uri), () => this._fileText.getText(uri) ?? ''),
        );
    }
    readDiagnostics(uri: vscode.Uri): readonly vscode.Diagnostic[] {
        return this._diagByUri.get(uri.toString()) ?? [];
    }
    readAllDiagnostics(): ReadonlyArray<[vscode.Uri, vscode.Diagnostic[]]> {
        return [...this._diagByUri.entries()].map(([uri, ds]) => [makeUri(uri), ds]);
    }
    readWindowFocused(): boolean { throw new Error('not supported in replay: readWindowFocused'); }
    readVisibleTextEditors(): readonly vscode.TextEditor[] { throw new Error('not supported in replay: readVisibleTextEditors'); }
    readActiveTextEditor(): vscode.TextEditor | undefined { throw new Error('not supported in replay: readActiveTextEditor'); }
    readTerminals(): readonly vscode.Terminal[] { throw new Error('not supported in replay: readTerminals'); }
    readBreakpoints(): readonly vscode.Breakpoint[] { throw new Error('not supported in replay: readBreakpoints'); }

    dispose(): void {
        for (const emitter of [
            this._textChange, this._save, this._activeEditor, this._diagnostics,
            this._diagnosticsSettled, this._windowState, this._selection, this._visibleRanges,
            this._terminalOpen, this._terminalClose, this._fileCreate, this._fileDelete,
            this._fileRename, this._docOpen, this._docClose, this._debugStart,
            this._debugTerminate, this._debugActive, this._breakpoints, this._shellStart,
            this._shellEnd, this._buildResult, this._taskFeedbackView, this._pasteDetected,
        ]) {
            emitter.dispose();
        }
    }
}
