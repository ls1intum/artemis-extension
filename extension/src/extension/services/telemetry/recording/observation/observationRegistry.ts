import * as vscode from 'vscode';

import { LogCategory, logger } from '@extension/services/loggingService';
import {
    collectBreakpointChange,
    collectDebugSession,
    collectDiagnostics,
    collectFileSwitch,
    collectSave,
    collectSelectionChange,
    collectTextChange,
    collectVisibleRangeChange,
    collectWindowFocus,
    filterRecordableSourceBreakpoints,
} from '@extension/services/telemetry/recording/eventCollectors';
import type { RecorderLifecycleState } from '@extension/services/telemetry/recording/lifecycleController';
import type { SnapshotManager } from '@extension/services/telemetry/recording/snapshots/snapshotManager';
import type { RecordedEvent } from '@extension/services/telemetry/recording/types';
import { shouldRecordUri } from '@extension/services/telemetry/uriFilter';
import type { PlatformCapabilities } from '@extension/theia';

import { TerminalCollector } from './terminalCollector';

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
 * the debounce state for selection/visibleRange events.
 *
 * Listener lifetime matches the consent enable/disable cycle, not the
 * session lifecycle: once enabled, subscriptions persist across session
 * boundaries. `setExerciseContext(uri)` is called per-session to update the
 * URI-root filter.
 *
 * Three explicit teardown paths:
 *   - `flushDebouncesForEnd(gen)`: on regular sessionEnd, flushes buffered
 *     debounce payloads into the record sink with `allowDuringEnding`.
 *   - `discardDebouncesForConsentDowngrade()`: GDPR path, drops all pending
 *     debounce payloads and aborts terminal pending executions without any
 *     record call.
 *   - `disposeSubscriptions()`: final cleanup on consent-disable or dispose.
 *     Clears timers + disposes all vscode.Disposable subscriptions. Idempotent.
 */
export class ObservationRegistry {
    /**
     * Debounce windows for selection and visible-range events, both of which
     * arrive in high-frequency bursts (typing and cursor movement, scroll
     * inertia). The windows coalesce a burst into one recorded event while
     * keeping distinct user actions separable. Engineering choice calibrated
     * by manual testing, not a paper citation.
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
    private readonly _terminalCollector: TerminalCollector;

    constructor(private readonly _deps: ObservationRegistryDeps) {
        this._terminalCollector = new TerminalCollector({
            state: this._deps.state,
            record: this._deps.record,
        });
    }

    setExerciseContext(root: vscode.Uri | undefined): void {
        this._exerciseRootUri = root;
    }

    seedActiveEditor(uri: string | undefined): void {
        this._lastActiveEditorUri = uri;
    }

    enable(): void {
        const recordingPhase = (): boolean => this._deps.state.phase === 'recording';

        const textChange = vscode.workspace.onDidChangeTextDocument(event => {
            if (!recordingPhase()) { return; }
            if (!shouldRecordUri(event.document.uri, this._exerciseRootUri)) { return; }
            if (event.contentChanges.length === 0) { return; }
            this._deps.record(collectTextChange(event), {}, this._deps.state.currentGeneration);
        });
        this._eventListenerDisposables.push(textChange);

        const save = vscode.workspace.onDidSaveTextDocument(doc => {
            if (!recordingPhase()) { return; }
            if (!shouldRecordUri(doc.uri, this._exerciseRootUri)) { return; }
            this._deps.record(collectSave(doc), {}, this._deps.state.currentGeneration);
        });
        this._eventListenerDisposables.push(save);

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

        const diagnosticsChange = vscode.languages.onDidChangeDiagnostics(event => {
            if (!recordingPhase()) { return; }
            for (const uri of event.uris) {
                if (!shouldRecordUri(uri, this._exerciseRootUri)) { continue; }
                this._deps.record(collectDiagnostics(uri), {}, this._deps.state.currentGeneration);
            }
        });
        this._eventListenerDisposables.push(diagnosticsChange);

        const windowFocus = vscode.window.onDidChangeWindowState(state => {
            if (!recordingPhase()) { return; }
            this._deps.record(collectWindowFocus(state), {}, this._deps.state.currentGeneration);
        });
        this._eventListenerDisposables.push(windowFocus);

        // Payload and generation are captured at trigger time and passed to
        // the delayed record call, so a session switch cannot retag them.
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

        const fileCreate = vscode.workspace.onDidCreateFiles(event =>
            this._emitMultiFileEvent(event.files, 'fileCreate'));
        this._eventListenerDisposables.push(fileCreate);

        const fileDelete = vscode.workspace.onDidDeleteFiles(event =>
            this._emitMultiFileEvent(event.files, 'fileDelete'));
        this._eventListenerDisposables.push(fileDelete);

        // Inline rather than a helper: two URIs per entry, and an entry counts
        // when either side is inside the exercise root.
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

        const debugStart = vscode.debug.onDidStartDebugSession(s =>
            this._recordDebugSession('started', s));
        this._eventListenerDisposables.push(debugStart);

        const debugTerminate = vscode.debug.onDidTerminateDebugSession(s =>
            this._recordDebugSession('terminated', s));
        this._eventListenerDisposables.push(debugTerminate);

        const debugActive = vscode.debug.onDidChangeActiveDebugSession(s =>
            this._recordDebugSession('activeChanged', s));
        this._eventListenerDisposables.push(debugActive);

        // The VS Code API does not guarantee one event per user action, so no
        // coalescing is assumed. Breakpoint changes are low-frequency, so no
        // debounce either.
        const breakpointChange = vscode.debug.onDidChangeBreakpoints(event => {
            this._emitBreakpointChange('added', event.added);
            this._emitBreakpointChange('removed', event.removed);
            this._emitBreakpointChange('changed', event.changed);
        });
        this._eventListenerDisposables.push(breakpointChange);

        // Terminal shell execution tracking exists only in VS Code Desktop.
        if (this._deps.capabilities?.hasTerminalShellExecution !== false) {
            this._terminalCollector.register(this._eventListenerDisposables);
        }
    }

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

        this._terminalCollector.abortAllPending();
    }

    /**
     * GDPR-strict: on consent downgrade, DISCARD buffered debounce payloads.
     * Consent is revoked, so the last cached keystroke derivative must not hit
     * disk. Does NOT dispose subscriptions; that happens next via
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

        this._terminalCollector.abortAllPending();
    }

    /**
     * Final cleanup: clear any leftover timers and dispose all vscode
     * subscriptions. Idempotent. Last-active-editor is reset so a fresh
     * enable starts with a clean slate.
     *
     * Pending terminal executions are aborted here too, even though the caller
     * normally flushes or discards first: the invariant "no pending execution
     * emits after `disposeSubscriptions`" must hold from this method alone,
     * not from caller ordering. `execution.read()` cannot be cancelled, so the
     * async reader may keep consuming output until VS Code closes its stream;
     * `entry.aborted` suppresses any later record call.
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
        this._terminalCollector.abortAllPending();
        while (this._eventListenerDisposables.length > 0) {
            const disposable = this._eventListenerDisposables.pop();
            disposable?.dispose();
        }
        this._lastActiveEditorUri = undefined;
    }

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

    /**
     * Emit a debugSession event. Session fields are populated for
     * started / terminated and for activeChanged with a session; they are left
     * undefined when activeChanged fires with no active session.
     */
    private _recordDebugSession(
        action: 'started' | 'terminated' | 'activeChanged',
        session: vscode.DebugSession | undefined,
    ): void {
        if (this._deps.state.phase !== 'recording') { return; }
        this._deps.record(collectDebugSession(action, session), {}, this._deps.state.currentGeneration);
    }

    /**
     * Emit one breakpointChange event for a non-empty, in-root, source-only
     * subset of a breakpoint-change array. Empty subsets emit nothing.
     */
    private _emitBreakpointChange(
        action: 'added' | 'removed' | 'changed',
        breakpoints: readonly vscode.Breakpoint[],
    ): void {
        if (this._deps.state.phase !== 'recording') { return; }
        const source = filterRecordableSourceBreakpoints(breakpoints, this._exerciseRootUri);
        if (source.length === 0) { return; }
        this._deps.record(collectBreakpointChange(action, source), {}, this._deps.state.currentGeneration);
    }

}
