// extension/src/extension/services/sensing/types.ts
/**
 * Typed payloads for the sensing layer (see services/sensing/sensorHub.ts).
 *
 * `ts` is the canonical arrival timestamp: Date.now() captured synchronously
 * when the VS Code event fires, before any fan-out. Downstream consumers that
 * need event time must use this value instead of re-stamping, so that live
 * operation and offline replay agree (struggle-engine requirement).
 */
import type * as vscode from 'vscode';

interface Stamped {
    readonly ts: number;
}

export interface TextChangeSignal extends Stamped { readonly event: vscode.TextDocumentChangeEvent }
export interface SaveSignal extends Stamped {
    /** Strictly monotonic arrival token (see sensing/sequence.ts). */
    readonly seq: number;
    readonly document: vscode.TextDocument;
}
export interface ActiveEditorSignal extends Stamped { readonly editor: vscode.TextEditor | undefined }
export interface DiagnosticsChangeSignal extends Stamped { readonly uris: readonly vscode.Uri[] }
/** Bulk diagnostics dump taken 500 ms after a save burst (language-server settle). */
export interface DiagnosticsSettledSignal extends Stamped {
    /**
     * Ordering token of the most recent save in the coalesced burst. Consumers
     * with session semantics (EQ emitter) compare it against their own
     * session-start token to drop settles whose triggering save predates the
     * session (PR1 decision log #1b). Tokens, not timestamps: a save and a
     * session switch in the same millisecond must still be strictly ordered.
     */
    readonly savedSeq: number;
    readonly entries: ReadonlyArray<[vscode.Uri, vscode.Diagnostic[]]>;
}
export interface WindowStateSignal extends Stamped { readonly state: vscode.WindowState }
export interface SelectionSignal extends Stamped { readonly event: vscode.TextEditorSelectionChangeEvent }
export interface VisibleRangesSignal extends Stamped { readonly event: vscode.TextEditorVisibleRangesChangeEvent }
export interface TerminalSignal extends Stamped { readonly terminal: vscode.Terminal }
export interface FileSetSignal extends Stamped { readonly files: readonly vscode.Uri[] }
export interface FileRenameSignal extends Stamped {
    readonly files: ReadonlyArray<{ readonly oldUri: vscode.Uri; readonly newUri: vscode.Uri }>;
}
export interface TextDocumentSignal extends Stamped { readonly document: vscode.TextDocument }
export interface DebugSessionSignal extends Stamped { readonly session: vscode.DebugSession | undefined }
export interface BreakpointsSignal extends Stamped { readonly event: vscode.BreakpointsChangeEvent }
export interface ShellExecutionStartSignal extends Stamped { readonly event: vscode.TerminalShellExecutionStartEvent }
export interface ShellExecutionEndSignal extends Stamped { readonly event: vscode.TerminalShellExecutionEndEvent }
