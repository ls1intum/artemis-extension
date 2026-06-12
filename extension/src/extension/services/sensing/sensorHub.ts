import * as vscode from 'vscode';

import type { PlatformCapabilities } from '@extension/theia';

import { nextSensorSeq } from './sequence';
import type {
    ActiveEditorSignal,
    BreakpointsSignal,
    DebugSessionSignal,
    DiagnosticsChangeSignal,
    DiagnosticsSettledSignal,
    FileRenameSignal,
    FileSetSignal,
    SaveSignal,
    SelectionSignal,
    ShellExecutionEndSignal,
    ShellExecutionStartSignal,
    TerminalSignal,
    TextChangeSignal,
    TextDocumentSignal,
    VisibleRangesSignal,
    WindowStateSignal,
} from './types';

/**
 * The single place that reads VS Code APIs for behavioral sensing.
 *
 * Every consumer (session recorder, EQ logger, struggle engine) attaches to
 * these typed channels instead of subscribing to `vscode.*` itself, and uses
 * the read* methods instead of global state reads. Policy (phase gates,
 * URI filters, debouncing, consent) lives in the consumers, NOT here.
 *
 * Production creates exactly ONE hub (extension.ts) and injects it
 * everywhere. The default-constructed hubs in TelemetryManager/SessionRecorder
 * exist only so tests can construct those classes standalone.
 */
export interface SensorHub extends vscode.Disposable {
    readonly onDidChangeTextDocument: vscode.Event<TextChangeSignal>;
    readonly onDidSaveTextDocument: vscode.Event<SaveSignal>;
    readonly onDidChangeActiveTextEditor: vscode.Event<ActiveEditorSignal>;
    readonly onDidChangeDiagnostics: vscode.Event<DiagnosticsChangeSignal>;
    /** Save-triggered settle snapshot (500 ms after a save burst). */
    readonly onDiagnosticsSettled: vscode.Event<DiagnosticsSettledSignal>;
    readonly onDidChangeWindowState: vscode.Event<WindowStateSignal>;
    readonly onDidChangeTextEditorSelection: vscode.Event<SelectionSignal>;
    readonly onDidChangeTextEditorVisibleRanges: vscode.Event<VisibleRangesSignal>;
    readonly onDidOpenTerminal: vscode.Event<TerminalSignal>;
    readonly onDidCloseTerminal: vscode.Event<TerminalSignal>;
    readonly onDidCreateFiles: vscode.Event<FileSetSignal>;
    readonly onDidDeleteFiles: vscode.Event<FileSetSignal>;
    readonly onDidRenameFiles: vscode.Event<FileRenameSignal>;
    readonly onDidOpenTextDocument: vscode.Event<TextDocumentSignal>;
    readonly onDidCloseTextDocument: vscode.Event<TextDocumentSignal>;
    readonly onDidStartDebugSession: vscode.Event<DebugSessionSignal>;
    readonly onDidTerminateDebugSession: vscode.Event<DebugSessionSignal>;
    readonly onDidChangeActiveDebugSession: vscode.Event<DebugSessionSignal>;
    readonly onDidChangeBreakpoints: vscode.Event<BreakpointsSignal>;
    /** Not fired on platforms without the shellIntegration API (Theia). */
    readonly onDidStartTerminalShellExecution: vscode.Event<ShellExecutionStartSignal>;
    readonly onDidEndTerminalShellExecution: vscode.Event<ShellExecutionEndSignal>;

    readAllDiagnostics(): ReadonlyArray<[vscode.Uri, vscode.Diagnostic[]]>;
    readDiagnostics(uri: vscode.Uri): readonly vscode.Diagnostic[];
    readWindowFocused(): boolean;
    readVisibleTextEditors(): readonly vscode.TextEditor[];
    readActiveTextEditor(): vscode.TextEditor | undefined;
    readTerminals(): readonly vscode.Terminal[];
    readBreakpoints(): readonly vscode.Breakpoint[];
}

/**
 * A hub channel that subscribes to its VS Code source event only while at
 * least one consumer is attached, and unsubscribes when the last detaches
 * (PR1 decision log #1a). Fan-out is synchronous in attach order.
 */
class LazyRelay<TRaw, TSignal> implements vscode.Disposable {
    private readonly _listeners = new Set<(signal: TSignal) => void>();
    private _source: vscode.Disposable | undefined;

    constructor(
        private readonly _subscribe: (handler: (raw: TRaw) => void) => vscode.Disposable,
        private readonly _map: (raw: TRaw) => TSignal,
    ) {}

    readonly event: vscode.Event<TSignal> = (listener, thisArgs?, disposables?) => {
        const bound: (signal: TSignal) => void =
            thisArgs !== undefined ? listener.bind(thisArgs) : listener;
        this._listeners.add(bound);
        if (this._listeners.size === 1) {
            this._source = this._subscribe(raw => this._fan(this._map(raw)));
        }
        const subscription = new vscode.Disposable(() => {
            this._listeners.delete(bound);
            if (this._listeners.size === 0) {
                this._source?.dispose();
                this._source = undefined;
            }
        });
        disposables?.push(subscription);
        return subscription;
    };

    private _fan(signal: TSignal): void {
        // Copy: a listener may attach/detach during fan-out.
        for (const listener of [...this._listeners]) {
            listener(signal);
        }
    }

    dispose(): void {
        this._listeners.clear();
        this._source?.dispose();
        this._source = undefined;
    }
}

/** Inert subscription for APIs the current platform does not provide. */
const NOOP_SUBSCRIPTION = new vscode.Disposable(() => { /* platform lacks this API */ });

export class VsCodeSensorHub implements SensorHub {
    private readonly _disposables: vscode.Disposable[] = [];

    /** Create a lazily-subscribing channel and track it for dispose(). */
    private _relay<TRaw, TSignal>(
        subscribe: (handler: (raw: TRaw) => void) => vscode.Disposable,
        map: (raw: TRaw) => TSignal,
    ): vscode.Event<TSignal> {
        const relay = new LazyRelay(subscribe, map);
        this._disposables.push(relay);
        return relay.event;
    }

    readonly onDidChangeTextDocument = this._relay(
        h => vscode.workspace.onDidChangeTextDocument(h),
        (event: vscode.TextDocumentChangeEvent): TextChangeSignal => ({ ts: Date.now(), event }),
    );
    readonly onDidSaveTextDocument = this._relay(
        h => vscode.workspace.onDidSaveTextDocument(h),
        (document: vscode.TextDocument): SaveSignal => ({ ts: Date.now(), seq: nextSensorSeq(), document }),
    );
    readonly onDidChangeActiveTextEditor = this._relay(
        h => vscode.window.onDidChangeActiveTextEditor(h),
        (editor: vscode.TextEditor | undefined): ActiveEditorSignal => ({ ts: Date.now(), editor }),
    );
    readonly onDidChangeDiagnostics = this._relay(
        h => vscode.languages.onDidChangeDiagnostics(h),
        (event: vscode.DiagnosticChangeEvent): DiagnosticsChangeSignal => ({ ts: Date.now(), uris: event.uris }),
    );
    readonly onDidChangeWindowState = this._relay(
        h => vscode.window.onDidChangeWindowState(h),
        (state: vscode.WindowState): WindowStateSignal => ({ ts: Date.now(), state }),
    );
    readonly onDidChangeTextEditorSelection = this._relay(
        h => vscode.window.onDidChangeTextEditorSelection(h),
        (event: vscode.TextEditorSelectionChangeEvent): SelectionSignal => ({ ts: Date.now(), event }),
    );
    readonly onDidChangeTextEditorVisibleRanges = this._relay(
        h => vscode.window.onDidChangeTextEditorVisibleRanges(h),
        (event: vscode.TextEditorVisibleRangesChangeEvent): VisibleRangesSignal => ({ ts: Date.now(), event }),
    );
    readonly onDidOpenTerminal = this._relay(
        h => vscode.window.onDidOpenTerminal(h),
        (terminal: vscode.Terminal): TerminalSignal => ({ ts: Date.now(), terminal }),
    );
    readonly onDidCloseTerminal = this._relay(
        h => vscode.window.onDidCloseTerminal(h),
        (terminal: vscode.Terminal): TerminalSignal => ({ ts: Date.now(), terminal }),
    );
    readonly onDidCreateFiles = this._relay(
        h => vscode.workspace.onDidCreateFiles(h),
        (event: vscode.FileCreateEvent): FileSetSignal => ({ ts: Date.now(), files: event.files }),
    );
    readonly onDidDeleteFiles = this._relay(
        h => vscode.workspace.onDidDeleteFiles(h),
        (event: vscode.FileDeleteEvent): FileSetSignal => ({ ts: Date.now(), files: event.files }),
    );
    readonly onDidRenameFiles = this._relay(
        h => vscode.workspace.onDidRenameFiles(h),
        (event: vscode.FileRenameEvent): FileRenameSignal => ({ ts: Date.now(), files: event.files }),
    );
    readonly onDidOpenTextDocument = this._relay(
        h => vscode.workspace.onDidOpenTextDocument(h),
        (document: vscode.TextDocument): TextDocumentSignal => ({ ts: Date.now(), document }),
    );
    readonly onDidCloseTextDocument = this._relay(
        h => vscode.workspace.onDidCloseTextDocument(h),
        (document: vscode.TextDocument): TextDocumentSignal => ({ ts: Date.now(), document }),
    );
    readonly onDidStartDebugSession = this._relay(
        h => vscode.debug.onDidStartDebugSession(h),
        (session: vscode.DebugSession): DebugSessionSignal => ({ ts: Date.now(), session }),
    );
    readonly onDidTerminateDebugSession = this._relay(
        h => vscode.debug.onDidTerminateDebugSession(h),
        (session: vscode.DebugSession): DebugSessionSignal => ({ ts: Date.now(), session }),
    );
    readonly onDidChangeActiveDebugSession = this._relay(
        h => vscode.debug.onDidChangeActiveDebugSession(h),
        (session: vscode.DebugSession | undefined): DebugSessionSignal => ({ ts: Date.now(), session }),
    );
    readonly onDidChangeBreakpoints = this._relay(
        h => vscode.debug.onDidChangeBreakpoints(h),
        (event: vscode.BreakpointsChangeEvent): BreakpointsSignal => ({ ts: Date.now(), event }),
    );
    // Capability-dependent and derived channels are assigned in the constructor.
    readonly onDidStartTerminalShellExecution: vscode.Event<ShellExecutionStartSignal>;
    readonly onDidEndTerminalShellExecution: vscode.Event<ShellExecutionEndSignal>;
    readonly onDiagnosticsSettled: vscode.Event<DiagnosticsSettledSignal>;

    constructor(capabilities?: PlatformCapabilities) {
        // Shell-execution API is Desktop-only; the capability flag guards the
        // subscription so Theia builds never touch the missing API.
        const hasShellExecution = capabilities?.hasTerminalShellExecution !== false;
        this.onDidStartTerminalShellExecution = this._relay(
            hasShellExecution ? h => vscode.window.onDidStartTerminalShellExecution(h) : () => NOOP_SUBSCRIPTION,
            (event: vscode.TerminalShellExecutionStartEvent): ShellExecutionStartSignal => ({ ts: Date.now(), event }),
        );
        this.onDidEndTerminalShellExecution = this._relay(
            hasShellExecution ? h => vscode.window.onDidEndTerminalShellExecution(h) : () => NOOP_SUBSCRIPTION,
            (event: vscode.TerminalShellExecutionEndEvent): ShellExecutionEndSignal => ({ ts: Date.now(), event }),
        );
        // Task 3 replaces this inert stub with the DiagnosticsSettleCollector wiring.
        this.onDiagnosticsSettled = this._relay(
            () => NOOP_SUBSCRIPTION,
            (signal: DiagnosticsSettledSignal) => signal,
        );
    }

    readAllDiagnostics(): ReadonlyArray<[vscode.Uri, vscode.Diagnostic[]]> {
        return vscode.languages.getDiagnostics();
    }
    readDiagnostics(uri: vscode.Uri): readonly vscode.Diagnostic[] {
        return vscode.languages.getDiagnostics(uri);
    }
    readWindowFocused(): boolean { return vscode.window.state.focused; }
    readVisibleTextEditors(): readonly vscode.TextEditor[] { return vscode.window.visibleTextEditors; }
    readActiveTextEditor(): vscode.TextEditor | undefined { return vscode.window.activeTextEditor; }
    readTerminals(): readonly vscode.Terminal[] { return vscode.window.terminals; }
    readBreakpoints(): readonly vscode.Breakpoint[] { return vscode.debug.breakpoints; }

    dispose(): void {
        while (this._disposables.length > 0) {
            this._disposables.pop()?.dispose();
        }
    }
}
