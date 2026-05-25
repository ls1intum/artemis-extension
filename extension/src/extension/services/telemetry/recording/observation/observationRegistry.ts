import * as vscode from 'vscode';

import { LogCategory, logger } from '@extension/services/loggingService';
import {
    collectDiagnostics,
    collectFileSwitch,
    collectSave,
    collectSelectionChange,
    collectTextChange,
    collectVisibleRangeChange,
    collectWindowFocus,
} from '@extension/services/telemetry/recording/eventCollectors';
import type { RecorderLifecycleState } from '@extension/services/telemetry/recording/lifecycle/recorderLifecycleState';
import type { SnapshotManager } from '@extension/services/telemetry/recording/snapshots/snapshotManager';
import type { RecordedEvent } from '@extension/services/telemetry/recording/types';
import { shouldRecordUri } from '@extension/services/telemetry/recording/uriFilter';
import type { PlatformCapabilities } from '@extension/theia';

interface PendingExecution {
    output: string;
    startTime: number;
    truncated: boolean;
    readerDone: boolean;
    endInfo: {
        exitCode: number | undefined;
        terminalName: string;
        command: string;
        cwd: string | undefined;
    } | undefined;
    aborted: boolean;
    /** Generation token captured when the execution started. */
    generation: number;
}

interface ObservationRegistryDeps {
    state: RecorderLifecycleState;
    snapshots: SnapshotManager;
    record: (
        event: RecordedEvent,
        opts: { allowDuringStartup?: boolean; allowDuringEnding?: boolean },
        generation: number,
    ) => void;
    capabilities?: PlatformCapabilities;
}

/**
 * Owns every VS Code `onDidChange*` subscription used by the recorder, plus
 * the debounce state for selection/visibleRange events and the pending-
 * execution state for terminal shell-integration output.
 *
 * Listener lifetime matches the consent enable/disable cycle, not the
 * session lifecycle: once enabled, subscriptions persist across session
 * boundaries. `setExerciseContext(uri)` is called per-session to update the
 * URI-root filter.
 *
 * Three explicit teardown paths replace the old single `_disposeEventListeners`:
 *   - `flushDebouncesForEnd(gen)`: on regular sessionEnd, flushes buffered
 *     debounce payloads into the record sink with `allowDuringEnding`.
 *   - `discardDebouncesForConsentDowngrade()`: GDPR path — drops all pending
 *     debounce payloads AND aborts terminal pending executions without any
 *     record call.
 *   - `disposeSubscriptions()`: final cleanup on consent-disable or dispose.
 *     Clears timers + disposes all vscode.Disposable subscriptions. Idempotent.
 */
export class ObservationRegistry {
    static readonly MAX_OUTPUT_CHARS = 10240;

    /**
     * Debounce windows for selection and visible-range events. Engineering
     * choice calibrated by manual testing during recorder development, not a
     * paper citation.
     *
     * Both event types arrive in high-frequency bursts: selection during
     * typing and rapid cursor movement, visible-range during scroll inertia.
     * The chosen windows coalesce a burst into one recorded event while
     * keeping distinct user actions separable in the recording.
     *
     * Tighter values would inflate JSONL size without obvious analysis
     * benefit; looser values would risk merging semantically distinct
     * selections or scrolls. Revisit if downstream analysis needs higher
     * temporal resolution.
     */
    static readonly SELECTION_DEBOUNCE_MS = 200;
    static readonly VISIBLE_RANGE_DEBOUNCE_MS = 300;

    private _exerciseRootUri: vscode.Uri | undefined;
    private _lastActiveEditorUri: string | undefined;

    private readonly _eventListenerDisposables: vscode.Disposable[] = [];
    private readonly _selectionDebounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
    private readonly _visibleRangeDebounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
    private readonly _pendingSelectionPayloads = new Map<string, RecordedEvent>();
    private readonly _pendingVisibleRangePayloads = new Map<string, RecordedEvent>();
    private readonly _pendingExecutions = new Map<vscode.TerminalShellExecution, PendingExecution>();

    constructor(private readonly _deps: ObservationRegistryDeps) {}

    setExerciseContext(root: vscode.Uri | undefined): void {
        this._exerciseRootUri = root;
    }

    seedActiveEditor(uri: string | undefined): void {
        this._lastActiveEditorUri = uri;
    }

    // ── Subscription registration (enable-scoped) ─────────────────────

    enable(): void {
        const recordingPhase = (): boolean => this._deps.state.phase === 'recording';

        // Text changes
        const textChange = vscode.workspace.onDidChangeTextDocument(event => {
            if (!recordingPhase()) { return; }
            if (!shouldRecordUri(event.document.uri, this._exerciseRootUri)) { return; }
            if (event.contentChanges.length === 0) { return; }
            this._deps.record(collectTextChange(event), {}, this._deps.state.currentGeneration);
        });
        this._eventListenerDisposables.push(textChange);

        // File save
        const save = vscode.workspace.onDidSaveTextDocument(doc => {
            if (!recordingPhase()) { return; }
            if (!shouldRecordUri(doc.uri, this._exerciseRootUri)) { return; }
            this._deps.record(collectSave(doc), {}, this._deps.state.currentGeneration);
        });
        this._eventListenerDisposables.push(save);

        // Active editor switch + snapshot on first open
        const editorSwitch = vscode.window.onDidChangeActiveTextEditor(editor => {
            if (!recordingPhase()) { return; }
            const prev = this._lastActiveEditorUri;
            const toUri = editor?.document.uri.toString();
            this._lastActiveEditorUri = toUri;
            if (prev || (editor && shouldRecordUri(editor.document.uri, this._exerciseRootUri))) {
                this._deps.record(collectFileSwitch(prev, editor), {}, this._deps.state.currentGeneration);
            }
            if (editor && shouldRecordUri(editor.document.uri, this._exerciseRootUri) && toUri && !this._deps.snapshots.hasSnapshot(toUri)) {
                const capturedGen = this._deps.state.currentGeneration;
                const content = editor.document.getText();
                void this._deps.snapshots.snapshotContent(toUri, content, capturedGen, { allowDuringStartup: false })
                    .catch(err => logger.error('Failed to capture first-open file snapshot', LogCategory.TELEMETRY, err));
            }
        });
        this._eventListenerDisposables.push(editorSwitch);

        // Diagnostics changes
        const diagnosticsChange = vscode.languages.onDidChangeDiagnostics(event => {
            if (!recordingPhase()) { return; }
            for (const uri of event.uris) {
                if (!shouldRecordUri(uri, this._exerciseRootUri)) { continue; }
                this._deps.record(collectDiagnostics(uri), {}, this._deps.state.currentGeneration);
            }
        });
        this._eventListenerDisposables.push(diagnosticsChange);

        // Window focus
        const windowFocus = vscode.window.onDidChangeWindowState(state => {
            if (!recordingPhase()) { return; }
            this._deps.record(collectWindowFocus(state), {}, this._deps.state.currentGeneration);
        });
        this._eventListenerDisposables.push(windowFocus);

        // Selection changes (debounced 200ms, per-URI — Block J).
        // Payload serialized at trigger time; generation captured at trigger
        // time and passed to the delayed record call.
        const selectionChange = vscode.window.onDidChangeTextEditorSelection(event => {
            if (!recordingPhase()) { return; }
            if (!shouldRecordUri(event.textEditor.document.uri, this._exerciseRootUri)) { return; }
            const uri = event.textEditor.document.uri.toString();
            const payload = collectSelectionChange(event.textEditor, event.kind);
            this._pendingSelectionPayloads.set(uri, payload);
            const capturedGen = this._deps.state.currentGeneration;
            const existing = this._selectionDebounceTimers.get(uri);
            if (existing !== undefined) { clearTimeout(existing); }
            const timer = setTimeout(() => {
                this._selectionDebounceTimers.delete(uri);
                if (this._pendingSelectionPayloads.get(uri) === payload) {
                    this._pendingSelectionPayloads.delete(uri);
                    this._deps.record(payload, {}, capturedGen);
                }
            }, ObservationRegistry.SELECTION_DEBOUNCE_MS);
            this._selectionDebounceTimers.set(uri, timer);
        });
        this._eventListenerDisposables.push(selectionChange);

        // Visible range changes (debounced 300ms, per-URI — Block J).
        const visibleRangeChange = vscode.window.onDidChangeTextEditorVisibleRanges(event => {
            if (!recordingPhase()) { return; }
            if (!shouldRecordUri(event.textEditor.document.uri, this._exerciseRootUri)) { return; }
            const uri = event.textEditor.document.uri.toString();
            const payload = collectVisibleRangeChange(event.textEditor);
            this._pendingVisibleRangePayloads.set(uri, payload);
            const capturedGen = this._deps.state.currentGeneration;
            const existing = this._visibleRangeDebounceTimers.get(uri);
            if (existing !== undefined) { clearTimeout(existing); }
            const timer = setTimeout(() => {
                this._visibleRangeDebounceTimers.delete(uri);
                if (this._pendingVisibleRangePayloads.get(uri) === payload) {
                    this._pendingVisibleRangePayloads.delete(uri);
                    this._deps.record(payload, {}, capturedGen);
                }
            }, ObservationRegistry.VISIBLE_RANGE_DEBOUNCE_MS);
            this._visibleRangeDebounceTimers.set(uri, timer);
        });
        this._eventListenerDisposables.push(visibleRangeChange);

        // Terminal open/close
        const terminalOpen = vscode.window.onDidOpenTerminal(terminal => {
            if (!recordingPhase()) { return; }
            this._deps.record({
                type: 'terminalOpenClose',
                timestamp: Date.now(),
                action: 'opened',
                terminalName: terminal.name,
            }, {}, this._deps.state.currentGeneration);
        });
        this._eventListenerDisposables.push(terminalOpen);

        const terminalClose = vscode.window.onDidCloseTerminal(terminal => {
            if (!recordingPhase()) { return; }
            this._deps.record({
                type: 'terminalOpenClose',
                timestamp: Date.now(),
                action: 'closed',
                terminalName: terminal.name,
            }, {}, this._deps.state.currentGeneration);
        });
        this._eventListenerDisposables.push(terminalClose);

        // File workspace events (Block K). fileCreate/fileDelete and
        // textDocumentOpen/textDocumentClose share the same phase-gate +
        // URI-filter + record pattern and route through private helpers
        // (`_emitMultiFileEvent`, `_emitTextDocumentEvent`). fileRename has its
        // own shape (two URIs per entry, accept-if-either-side-in-root) and
        // stays inline.
        const fileCreate = vscode.workspace.onDidCreateFiles(event =>
            this._emitMultiFileEvent(event.files, 'fileCreate'));
        this._eventListenerDisposables.push(fileCreate);

        const fileDelete = vscode.workspace.onDidDeleteFiles(event =>
            this._emitMultiFileEvent(event.files, 'fileDelete'));
        this._eventListenerDisposables.push(fileDelete);

        const fileRename = vscode.workspace.onDidRenameFiles(event => {
            if (!recordingPhase()) { return; }
            const gen = this._deps.state.currentGeneration;
            for (const { oldUri, newUri } of event.files) {
                if (!shouldRecordUri(oldUri, this._exerciseRootUri) && !shouldRecordUri(newUri, this._exerciseRootUri)) {
                    continue;
                }
                this._deps.record({
                    type: 'fileRename',
                    timestamp: Date.now(),
                    oldUri: oldUri.toString(),
                    newUri: newUri.toString(),
                }, {}, gen);
            }
        });
        this._eventListenerDisposables.push(fileRename);

        const textDocumentOpen = vscode.workspace.onDidOpenTextDocument(doc =>
            this._emitTextDocumentEvent(doc, 'textDocumentOpen'));
        this._eventListenerDisposables.push(textDocumentOpen);

        const textDocumentClose = vscode.workspace.onDidCloseTextDocument(doc =>
            this._emitTextDocumentEvent(doc, 'textDocumentClose'));
        this._eventListenerDisposables.push(textDocumentClose);

        // Terminal shell execution tracking — only available in VS Code Desktop
        if (this._deps.capabilities?.hasTerminalShellExecution !== false) {
            const shellExecStart = vscode.window.onDidStartTerminalShellExecution(event => {
                if (!recordingPhase()) { return; }
                const entry: PendingExecution = {
                    output: '', startTime: Date.now(), truncated: false,
                    readerDone: false, endInfo: undefined, aborted: false,
                    generation: this._deps.state.currentGeneration,
                };
                this._pendingExecutions.set(event.execution, entry);
                void this._collectExecutionOutput(event.execution, entry);
            });
            this._eventListenerDisposables.push(shellExecStart);

            const shellExecEnd = vscode.window.onDidEndTerminalShellExecution(event => {
                if (!recordingPhase()) { return; }
                const entry = this._pendingExecutions.get(event.execution);
                if (!entry) { return; }
                this._pendingExecutions.delete(event.execution);
                entry.endInfo = {
                    exitCode: event.exitCode,
                    terminalName: event.terminal.name,
                    command: event.execution.commandLine.value,
                    cwd: event.execution.cwd?.toString(),
                };
                if (entry.readerDone) {
                    this._emitTerminalCommand(entry);
                }
            });
            this._eventListenerDisposables.push(shellExecEnd);
        }
    }

    // ── Teardown paths ────────────────────────────────────────────────

    /**
     * On regular sessionEnd: flush any buffered debounce payloads to the
     * record sink with `allowDuringEnding` so they're persisted before the
     * sessionEnd event. Does NOT dispose subscriptions (listeners remain
     * alive for the next session under the same consent enable).
     */
    flushDebouncesForEnd(generation: number): void {
        for (const timer of this._selectionDebounceTimers.values()) {
            clearTimeout(timer);
        }
        this._selectionDebounceTimers.clear();
        for (const payload of this._pendingSelectionPayloads.values()) {
            this._deps.record(payload, { allowDuringEnding: true }, generation);
        }
        this._pendingSelectionPayloads.clear();

        for (const timer of this._visibleRangeDebounceTimers.values()) {
            clearTimeout(timer);
        }
        this._visibleRangeDebounceTimers.clear();
        for (const payload of this._pendingVisibleRangePayloads.values()) {
            this._deps.record(payload, { allowDuringEnding: true }, generation);
        }
        this._pendingVisibleRangePayloads.clear();

        // Abort any still-running terminal shell executions.
        for (const entry of this._pendingExecutions.values()) {
            entry.aborted = true;
        }
        this._pendingExecutions.clear();
    }

    /**
     * GDPR-strict: on consent downgrade, DISCARD buffered debounce payloads.
     * The user revoked consent — the last cached keystroke derivative must
     * not hit disk. Does NOT dispose subscriptions; that happens next via
     * disposeSubscriptions() during _doDisable.
     */
    discardDebouncesForConsentDowngrade(): void {
        for (const timer of this._selectionDebounceTimers.values()) {
            clearTimeout(timer);
        }
        this._selectionDebounceTimers.clear();
        this._pendingSelectionPayloads.clear();

        for (const timer of this._visibleRangeDebounceTimers.values()) {
            clearTimeout(timer);
        }
        this._visibleRangeDebounceTimers.clear();
        this._pendingVisibleRangePayloads.clear();

        for (const entry of this._pendingExecutions.values()) {
            entry.aborted = true;
        }
        this._pendingExecutions.clear();
    }

    /**
     * Final cleanup: clear any leftover timers and dispose all vscode
     * subscriptions. Idempotent. Last-active-editor is reset so a fresh
     * enable starts with a clean slate.
     *
     * Pending terminal executions are aborted and cleared here too. In normal
     * call ordering the caller (LifecycleController) already invokes
     * `flushDebouncesForEnd` or `discardDebouncesForConsentDowngrade` first,
     * which empties this map. The explicit clear here is defense-in-depth so
     * that the invariant "no pending execution can emit after
     * `disposeSubscriptions`" is enforced by this method alone, not by caller
     * ordering. Note: `execution.read()` cannot be cancelled, so the async
     * reader may continue to consume output until VS Code closes its stream;
     * the `entry.aborted` flag suppresses any subsequent record call.
     */
    disposeSubscriptions(): void {
        for (const timer of this._selectionDebounceTimers.values()) {
            clearTimeout(timer);
        }
        this._selectionDebounceTimers.clear();
        this._pendingSelectionPayloads.clear();
        for (const timer of this._visibleRangeDebounceTimers.values()) {
            clearTimeout(timer);
        }
        this._visibleRangeDebounceTimers.clear();
        this._pendingVisibleRangePayloads.clear();
        for (const entry of this._pendingExecutions.values()) {
            entry.aborted = true;
        }
        this._pendingExecutions.clear();
        while (this._eventListenerDisposables.length > 0) {
            const disposable = this._eventListenerDisposables.pop();
            disposable?.dispose();
        }
        this._lastActiveEditorUri = undefined;
    }

    // ── Event emit helpers ────────────────────────────────────────────

    /**
     * Emit a recorder event for each URI in a file-set workspace event
     * (`onDidCreateFiles` / `onDidDeleteFiles`). Phase gate + URI filter
     * applied per-URI. Generation is captured once at handler entry so all
     * events from the same workspace event carry the same generation token.
     */
    private _emitMultiFileEvent(
        uris: readonly vscode.Uri[],
        type: 'fileCreate' | 'fileDelete',
    ): void {
        if (this._deps.state.phase !== 'recording') { return; }
        const gen = this._deps.state.currentGeneration;
        for (const uri of uris) {
            if (!shouldRecordUri(uri, this._exerciseRootUri)) { continue; }
            this._deps.record({
                type,
                timestamp: Date.now(),
                uri: uri.toString(),
            }, {}, gen);
        }
    }

    /**
     * Emit a recorder event for a single text-document workspace event
     * (`onDidOpenTextDocument` / `onDidCloseTextDocument`).
     */
    private _emitTextDocumentEvent(
        doc: vscode.TextDocument,
        type: 'textDocumentOpen' | 'textDocumentClose',
    ): void {
        if (this._deps.state.phase !== 'recording') { return; }
        if (!shouldRecordUri(doc.uri, this._exerciseRootUri)) { return; }
        this._deps.record({
            type,
            timestamp: Date.now(),
            uri: doc.uri.toString(),
        }, {}, this._deps.state.currentGeneration);
    }

    // ── Terminal output helpers ───────────────────────────────────────

    private async _collectExecutionOutput(
        execution: vscode.TerminalShellExecution,
        entry: PendingExecution,
    ): Promise<void> {
        try {
            for await (const data of execution.read()) {
                if (entry.aborted) { return; }
                if (!entry.truncated) {
                    const remaining = ObservationRegistry.MAX_OUTPUT_CHARS - entry.output.length;
                    if (data.length <= remaining) {
                        entry.output += data;
                    } else {
                        entry.output += data.substring(0, remaining);
                        entry.truncated = true;
                    }
                }
            }
        } catch (err) {
            logger.error('Failed to read terminal execution output', LogCategory.TELEMETRY, err);
        }
        entry.readerDone = true;
        if (entry.endInfo && !entry.aborted) {
            this._emitTerminalCommand(entry);
        }
    }

    private _emitTerminalCommand(entry: PendingExecution): void {
        if (!entry.endInfo) { return; }
        if (this._deps.state.phase !== 'recording') { return; }
        const now = Date.now();
        this._deps.record({
            type: 'terminalCommand',
            timestamp: now,
            command: entry.endInfo.command,
            exitCode: entry.endInfo.exitCode,
            output: entry.output,
            outputTruncated: entry.truncated,
            cwd: entry.endInfo.cwd,
            terminalName: entry.endInfo.terminalName,
            durationMs: now - entry.startTime,
        }, {}, entry.generation);
    }
}
