// extension/test/__shared__/testSensorHub.ts
/**
 * Controllable SensorHub for tests: every channel is backed by a public
 * EventEmitter (fire via `hub.emit.<channel>.fire(...)`), state reads return
 * stubbable values (assign `hub.stub.<name>`).
 */
import * as vscode from 'vscode';

import type { SensorHub } from '@extension/services/sensing/sensorHub';
import type {
    ActiveEditorSignal, BreakpointsSignal, BuildResultSignal, DebugSessionSignal,
    DiagnosticsChangeSignal, DiagnosticsSettledSignal, FileRenameSignal, FileSetSignal,
    PasteSignal, SaveSignal, SelectionSignal, ShellExecutionEndSignal, ShellExecutionStartSignal,
    TaskFeedbackViewSignal, TerminalSignal, TextChangeSignal, TextDocumentSignal,
    VisibleRangesSignal, WindowStateSignal,
} from '@extension/services/sensing/types';
import type { ResultDTO } from '@extension/types';

export class TestSensorHub implements SensorHub {
    readonly emit = {
        textChange: new vscode.EventEmitter<TextChangeSignal>(),
        save: new vscode.EventEmitter<SaveSignal>(),
        activeEditor: new vscode.EventEmitter<ActiveEditorSignal>(),
        diagnostics: new vscode.EventEmitter<DiagnosticsChangeSignal>(),
        diagnosticsSettled: new vscode.EventEmitter<DiagnosticsSettledSignal>(),
        windowState: new vscode.EventEmitter<WindowStateSignal>(),
        selection: new vscode.EventEmitter<SelectionSignal>(),
        visibleRanges: new vscode.EventEmitter<VisibleRangesSignal>(),
        terminalOpen: new vscode.EventEmitter<TerminalSignal>(),
        terminalClose: new vscode.EventEmitter<TerminalSignal>(),
        fileCreate: new vscode.EventEmitter<FileSetSignal>(),
        fileDelete: new vscode.EventEmitter<FileSetSignal>(),
        fileRename: new vscode.EventEmitter<FileRenameSignal>(),
        docOpen: new vscode.EventEmitter<TextDocumentSignal>(),
        docClose: new vscode.EventEmitter<TextDocumentSignal>(),
        debugStart: new vscode.EventEmitter<DebugSessionSignal>(),
        debugTerminate: new vscode.EventEmitter<DebugSessionSignal>(),
        debugActive: new vscode.EventEmitter<DebugSessionSignal>(),
        breakpoints: new vscode.EventEmitter<BreakpointsSignal>(),
        shellStart: new vscode.EventEmitter<ShellExecutionStartSignal>(),
        shellEnd: new vscode.EventEmitter<ShellExecutionEndSignal>(),
        buildResult: new vscode.EventEmitter<BuildResultSignal>(),
        taskFeedbackView: new vscode.EventEmitter<TaskFeedbackViewSignal>(),
        pasteDetected: new vscode.EventEmitter<PasteSignal>(),
    };

    readonly stub = {
        allDiagnostics: [] as Array<[vscode.Uri, vscode.Diagnostic[]]>,
        diagnosticsByUri: new Map<string, vscode.Diagnostic[]>(),
        windowFocused: true,
        visibleTextEditors: [] as vscode.TextEditor[],
        activeTextEditor: undefined as vscode.TextEditor | undefined,
        terminals: [] as vscode.Terminal[],
        breakpoints: [] as vscode.Breakpoint[],
        textDocuments: [] as vscode.TextDocument[],
    };

    readonly onDidChangeTextDocument = this.emit.textChange.event;
    readonly onDidSaveTextDocument = this.emit.save.event;
    readonly onDidChangeActiveTextEditor = this.emit.activeEditor.event;
    readonly onDidChangeDiagnostics = this.emit.diagnostics.event;
    readonly onDiagnosticsSettled = this.emit.diagnosticsSettled.event;
    readonly onDidChangeWindowState = this.emit.windowState.event;
    readonly onDidChangeTextEditorSelection = this.emit.selection.event;
    readonly onDidChangeTextEditorVisibleRanges = this.emit.visibleRanges.event;
    readonly onDidOpenTerminal = this.emit.terminalOpen.event;
    readonly onDidCloseTerminal = this.emit.terminalClose.event;
    readonly onDidCreateFiles = this.emit.fileCreate.event;
    readonly onDidDeleteFiles = this.emit.fileDelete.event;
    readonly onDidRenameFiles = this.emit.fileRename.event;
    readonly onDidOpenTextDocument = this.emit.docOpen.event;
    readonly onDidCloseTextDocument = this.emit.docClose.event;
    readonly onDidStartDebugSession = this.emit.debugStart.event;
    readonly onDidTerminateDebugSession = this.emit.debugTerminate.event;
    readonly onDidChangeActiveDebugSession = this.emit.debugActive.event;
    readonly onDidChangeBreakpoints = this.emit.breakpoints.event;
    readonly onDidStartTerminalShellExecution = this.emit.shellStart.event;
    readonly onDidEndTerminalShellExecution = this.emit.shellEnd.event;
    readonly onBuildResult = this.emit.buildResult.event;
    readonly onTaskFeedbackView = this.emit.taskFeedbackView.event;
    readonly onPasteDetected = this.emit.pasteDetected.event;

    emitBuildResult(result: ResultDTO): void {
        this.emit.buildResult.fire({ ts: Date.now(), result });
    }
    emitTaskFeedbackView(action: 'opened' | 'closed', viewId: string): void {
        this.emit.taskFeedbackView.fire({ ts: Date.now(), action, viewId });
    }

    readTextDocuments(): readonly vscode.TextDocument[] { return this.stub.textDocuments; }

    readAllDiagnostics(): ReadonlyArray<[vscode.Uri, vscode.Diagnostic[]]> { return this.stub.allDiagnostics; }
    readDiagnostics(uri: vscode.Uri): readonly vscode.Diagnostic[] {
        return this.stub.diagnosticsByUri.get(uri.toString()) ?? [];
    }
    readWindowFocused(): boolean { return this.stub.windowFocused; }
    readVisibleTextEditors(): readonly vscode.TextEditor[] { return this.stub.visibleTextEditors; }
    readActiveTextEditor(): vscode.TextEditor | undefined { return this.stub.activeTextEditor; }
    readTerminals(): readonly vscode.Terminal[] { return this.stub.terminals; }
    readBreakpoints(): readonly vscode.Breakpoint[] { return this.stub.breakpoints; }

    dispose(): void {
        for (const emitter of Object.values(this.emit)) {
            emitter.dispose();
        }
    }
}
