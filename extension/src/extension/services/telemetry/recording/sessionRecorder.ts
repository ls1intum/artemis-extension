/**
 * Main orchestrator for session recording.
 *
 * Runs parallel to TelemetryManager with its own VS Code listeners.
 * Only active when consent is Extended. Writes JSONL event streams
 * to {globalStorageUri}/recordings/{sessionId}/.
 */

import * as vscode from 'vscode';
import * as crypto from 'crypto';
import type { WebSocketMessageHandler, ResultDTO } from '../../../types';
import type { RecordedEvent, SessionMetadata, SerializedErrorSnapshot } from './types';
import type { PlatformCapabilities } from '../../../theia';
import { RecordingStorageWriter } from './storageWriter';
import {
    collectTextChange,
    collectSave,
    collectFileSwitch,
    collectDiagnostics,
    collectBuildResult,
    collectWindowFocus,
    collectSelectionChange,
    collectVisibleRangeChange,
} from './eventCollectors';
import { logger, LogCategory } from '../../loggingService';

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
}

export interface RecordingState {
    isEnabled: boolean;
    isRecording: boolean;
    exerciseId: number | undefined;
    eventCount: number;
}

export class SessionRecorder implements vscode.Disposable, WebSocketMessageHandler {
    private _isEnabled = false;
    private _isRecording = false;
    private _activeSessionId: string | undefined;
    private _activeExerciseId: number | undefined;
    private _lastActiveEditorUri: string | undefined;
    private _eventCount = 0;
    private _sessionStartTime: number | undefined;
    private _participantId: string | undefined;

    private _exerciseRoot: string | undefined;
    private _snapshotedUris = new Set<string>();
    private _selectionDebounceTimer: ReturnType<typeof setTimeout> | undefined;
    private _visibleRangeDebounceTimer: ReturnType<typeof setTimeout> | undefined;
    private _pendingExecutions = new Map<vscode.TerminalShellExecution, PendingExecution>();
    private static readonly MAX_OUTPUT_CHARS = 10240;
    private static readonly SELECTION_DEBOUNCE_MS = 200;
    private static readonly VISIBLE_RANGE_DEBOUNCE_MS = 300;

    private _eventListenerDisposables: vscode.Disposable[] = [];
    private readonly _writer: RecordingStorageWriter;

    private readonly _onDidChangeState = new vscode.EventEmitter<RecordingState>();
    public readonly onDidChangeState = this._onDidChangeState.event;

    private readonly _capabilities?: PlatformCapabilities;

    constructor(globalStorageUri: vscode.Uri, capabilities?: PlatformCapabilities) {
        this._writer = new RecordingStorageWriter(globalStorageUri.fsPath);
        this._capabilities = capabilities;
    }

    // ── Public state accessors ────────────────────────────────────────

    get isEnabled(): boolean { return this._isEnabled; }
    get isRecording(): boolean { return this._isRecording; }
    get activeExerciseId(): number | undefined { return this._activeExerciseId; }
    get eventCount(): number { return this._eventCount; }

    // ── Enable / Disable ──────────────────────────────────────────────

    enable(): void {
        if (this._isEnabled) {
            return;
        }
        this._isEnabled = true;
        this._registerEventListeners();
        this._fireStateChange();
        logger.info('SessionRecorder enabled', LogCategory.TELEMETRY);
    }

    disable(): void {
        if (!this._isEnabled) {
            return;
        }
        this._isEnabled = false;
        if (this._isRecording) {
            void this.endSession().catch((err: unknown) => {
                logger.error('Failed to end recording session during disable', LogCategory.TELEMETRY, err);
            });
        }
        this._disposeEventListeners();
        this._fireStateChange();
        logger.info('SessionRecorder disabled', LogCategory.TELEMETRY);
    }

    // ── Session lifecycle ─────────────────────────────────────────────

    async startSession(exerciseId: number, participantId?: string, exerciseRoot?: string): Promise<void> {
        if (!this._isEnabled) {
            return;
        }

        // End any active session first
        if (this._isRecording) {
            await this.endSession();
        }

        const hex = crypto.randomBytes(3).toString('hex');
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        this._activeSessionId = `${exerciseId}-${timestamp}-${hex}`;
        this._activeExerciseId = exerciseId;
        this._participantId = participantId;
        this._exerciseRoot = exerciseRoot;
        this._eventCount = 0;
        this._sessionStartTime = Date.now();
        this._lastActiveEditorUri = vscode.window.activeTextEditor?.document.uri.toString();

        await this._writer.initSession(this._activeSessionId);
        this._isRecording = true;
        this._fireStateChange();

        // Record session start
        this._record({
            type: 'sessionStart',
            timestamp: Date.now(),
            exerciseId,
            participantId,
            exerciseRoot,
        });

        // Capture file snapshots of all open file:// documents
        await this._captureOpenFileSnapshots();

        // Capture pre-existing diagnostics so replay sees errors before first diagnostics event
        this._captureInitialDiagnostics();

        logger.info(`Recording session started: ${this._activeSessionId}`, LogCategory.TELEMETRY);
    }

    async endSession(): Promise<void> {
        if (!this._isRecording || !this._activeSessionId || this._activeExerciseId === undefined) {
            return;
        }

        // Record session end
        this._record({
            type: 'sessionEnd',
            timestamp: Date.now(),
            exerciseId: this._activeExerciseId,
        });

        // Write metadata
        const metadata: SessionMetadata = {
            sessionId: this._activeSessionId,
            exerciseId: this._activeExerciseId,
            participantId: this._participantId,
            startTime: this._sessionStartTime!,
            endTime: Date.now(),
            eventCount: this._eventCount,
        };
        await this._writer.writeMetadata(metadata);
        await this._writer.endSession();

        logger.info(
            `Recording session ended: ${this._activeSessionId} (${this._eventCount} events)`,
            LogCategory.TELEMETRY,
        );

        this._isRecording = false;
        this._activeSessionId = undefined;
        this._activeExerciseId = undefined;
        this._participantId = undefined;
        this._exerciseRoot = undefined;
        this._sessionStartTime = undefined;
        this._snapshotedUris.clear();
        for (const entry of this._pendingExecutions.values()) {
            entry.aborted = true;
        }
        this._pendingExecutions.clear();
        this._fireStateChange();
    }

    // ── WebSocketMessageHandler ───────────────────────────────────────

    onNewResult(result: ResultDTO): void {
        if (!this._isRecording) {
            return;
        }
        this._record(collectBuildResult(result));
    }

    // ── Public recording methods for chat events ──────────────────────

    recordIrisChatSent(text: string): void {
        if (!this._isRecording) {
            return;
        }
        this._record({
            type: 'irisChatMessage',
            timestamp: Date.now(),
            direction: 'sent',
            content: text,
        });
    }

    recordIrisChatReceived(content: string): void {
        if (!this._isRecording) {
            return;
        }
        this._record({
            type: 'irisChatMessage',
            timestamp: Date.now(),
            direction: 'received',
            content,
        });
    }

    recordEqSnapshot(
        eq: number,
        confidence: 'sufficient' | 'insufficient',
        source: 'save' | 'build' | 'trigger',
        triggerType?: string,
    ): void {
        if (!this._isRecording) {
            return;
        }
        this._record({
            type: 'eqSnapshot',
            timestamp: Date.now(),
            eq,
            confidence,
            source,
            triggerType,
        });
    }

    recordIntervention(
        action: 'shown' | 'accepted' | 'dismissed',
        level: 'subtle' | 'notification' | 'proactive',
        shouldIntervene: boolean,
        eq: number,
        confidence: 'sufficient' | 'insufficient',
        triggerType?: string,
    ): void {
        if (!this._isRecording) {
            return;
        }
        this._record({
            type: 'intervention',
            timestamp: Date.now(),
            action,
            level,
            shouldIntervene,
            eq,
            confidence,
            triggerType: triggerType as 'execution-error' | 'multiline-paste' | 'idle' | 'selection-maintained' | undefined,
        });
    }

    recordViewNavigation(from: string, to: string): void {
        if (!this._isRecording) {
            return;
        }
        this._record({
            type: 'viewNavigation',
            timestamp: Date.now(),
            from,
            to,
        });
    }

    recordPanelVisibility(panel: 'artemis' | 'chat', visible: boolean): void {
        if (!this._isRecording) {
            return;
        }
        this._record({
            type: 'panelVisibility',
            timestamp: Date.now(),
            panel,
            visible,
        });
    }

    recordEqEngineState(
        snapshots: SerializedErrorSnapshot[],
        currentEQ: number,
        pairCount: number,
        confidence: 'sufficient' | 'insufficient',
    ): void {
        if (!this._isRecording) {
            return;
        }
        this._record({
            type: 'eqEngineState',
            timestamp: Date.now(),
            snapshots,
            currentEQ,
            pairCount,
            confidence,
        });
    }

    // ── Disposable ────────────────────────────────────────────────────

    async dispose(): Promise<void> {
        if (this._isRecording) {
            try {
                await this.endSession();
            } catch (err: unknown) {
                logger.error('Failed to end recording session during dispose', LogCategory.TELEMETRY, err);
            }
        }
        this._disposeEventListeners();
        await this._writer.dispose();
        this._onDidChangeState.dispose();
    }

    // ── Private: State notification ─────────────────────────────────────

    private _fireStateChange(): void {
        this._onDidChangeState.fire({
            isEnabled: this._isEnabled,
            isRecording: this._isRecording,
            exerciseId: this._activeExerciseId,
            eventCount: this._eventCount,
        });
    }

    // ── Private: Event recording ──────────────────────────────────────

    private _record(event: RecordedEvent): void {
        this._eventCount++;
        this._writer.appendEvent(event);
    }

    // ── Private: Listener setup ───────────────────────────────────────

    private _registerEventListeners(): void {
        // Text changes
        const textChange = vscode.workspace.onDidChangeTextDocument(event => {
            if (!this._isRecording) { return; }
            if (event.document.uri.scheme !== 'file') { return; }
            if (event.contentChanges.length === 0) { return; }
            this._record(collectTextChange(event));
        });
        this._eventListenerDisposables.push(textChange);

        // File save
        const save = vscode.workspace.onDidSaveTextDocument(doc => {
            if (!this._isRecording) { return; }
            if (doc.uri.scheme !== 'file') { return; }
            this._record(collectSave(doc));
        });
        this._eventListenerDisposables.push(save);

        // Active editor switch + snapshot on first open
        const editorSwitch = vscode.window.onDidChangeActiveTextEditor(editor => {
            if (!this._isRecording) { return; }
            const prev = this._lastActiveEditorUri;
            const toUri = editor?.document.uri.toString();
            this._lastActiveEditorUri = toUri;
            // Only record if at least one side is a file
            if (prev || editor?.document.uri.scheme === 'file') {
                this._record(collectFileSwitch(prev, editor));
            }
            // Snapshot file if opened for the first time this session
            if (editor && editor.document.uri.scheme === 'file' && toUri && !this._snapshotedUris.has(toUri)) {
                void this._captureFirstOpenSnapshot(editor);
            }
        });
        this._eventListenerDisposables.push(editorSwitch);

        // Diagnostics changes
        const diagnosticsChange = vscode.languages.onDidChangeDiagnostics(event => {
            if (!this._isRecording) { return; }
            for (const uri of event.uris) {
                if (uri.scheme !== 'file') { continue; }
                this._record(collectDiagnostics(uri));
            }
        });
        this._eventListenerDisposables.push(diagnosticsChange);

        // Window focus
        const windowFocus = vscode.window.onDidChangeWindowState(state => {
            if (!this._isRecording) { return; }
            this._record(collectWindowFocus(state));
        });
        this._eventListenerDisposables.push(windowFocus);

        // Selection changes (debounced 200ms)
        const selectionChange = vscode.window.onDidChangeTextEditorSelection(event => {
            if (!this._isRecording) { return; }
            if (event.textEditor.document.uri.scheme !== 'file') { return; }
            clearTimeout(this._selectionDebounceTimer);
            this._selectionDebounceTimer = setTimeout(() => {
                if (!this._isRecording) { return; }
                this._record(collectSelectionChange(event.textEditor, event.kind));
            }, SessionRecorder.SELECTION_DEBOUNCE_MS);
        });
        this._eventListenerDisposables.push(selectionChange);

        // Visible range changes (debounced 300ms)
        const visibleRangeChange = vscode.window.onDidChangeTextEditorVisibleRanges(event => {
            if (!this._isRecording) { return; }
            if (event.textEditor.document.uri.scheme !== 'file') { return; }
            clearTimeout(this._visibleRangeDebounceTimer);
            this._visibleRangeDebounceTimer = setTimeout(() => {
                if (!this._isRecording) { return; }
                this._record(collectVisibleRangeChange(event.textEditor));
            }, SessionRecorder.VISIBLE_RANGE_DEBOUNCE_MS);
        });
        this._eventListenerDisposables.push(visibleRangeChange);

        // Terminal open
        const terminalOpen = vscode.window.onDidOpenTerminal(terminal => {
            if (!this._isRecording) { return; }
            this._record({
                type: 'terminalOpenClose',
                timestamp: Date.now(),
                action: 'opened',
                terminalName: terminal.name,
            });
        });
        this._eventListenerDisposables.push(terminalOpen);

        // Terminal close
        const terminalClose = vscode.window.onDidCloseTerminal(terminal => {
            if (!this._isRecording) { return; }
            this._record({
                type: 'terminalOpenClose',
                timestamp: Date.now(),
                action: 'closed',
                terminalName: terminal.name,
            });
        });
        this._eventListenerDisposables.push(terminalClose);

        // Terminal shell execution tracking — only available in VS Code Desktop (not all Theia builds)
        if (this._capabilities?.hasTerminalShellExecution !== false) {
            // Terminal shell execution start — begin collecting output
            const shellExecStart = vscode.window.onDidStartTerminalShellExecution(event => {
                if (!this._isRecording) { return; }
                const entry: PendingExecution = {
                    output: '', startTime: Date.now(), truncated: false,
                    readerDone: false, endInfo: undefined, aborted: false,
                };
                this._pendingExecutions.set(event.execution, entry);
                void this._collectExecutionOutput(event.execution, entry);
            });
            this._eventListenerDisposables.push(shellExecStart);

            // Terminal shell execution end — emit once reader is also done
            const shellExecEnd = vscode.window.onDidEndTerminalShellExecution(event => {
                if (!this._isRecording) { return; }
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

    private _disposeEventListeners(): void {
        clearTimeout(this._selectionDebounceTimer);
        clearTimeout(this._visibleRangeDebounceTimer);
        while (this._eventListenerDisposables.length > 0) {
            const disposable = this._eventListenerDisposables.pop();
            disposable?.dispose();
        }
    }

    // ── Private: Snapshot capture ─────────────────────────────────────

    private async _snapshotDocument(uri: string, content: string): Promise<void> {
        const snapshotPath = this._writer.getSnapshotRelativePath(uri);
        await this._writer.writeSnapshot(uri, content);
        this._snapshotedUris.add(uri);
        this._record({ type: 'fileSnapshot', timestamp: Date.now(), uri, snapshotPath });
    }

    private async _captureOpenFileSnapshots(): Promise<void> {
        for (const doc of vscode.workspace.textDocuments) {
            if (doc.uri.scheme !== 'file') {
                continue;
            }
            try {
                await this._snapshotDocument(doc.uri.toString(), doc.getText());
            } catch (err) {
                logger.error('Failed to capture file snapshot', LogCategory.TELEMETRY, err);
            }
        }
    }

    private _captureInitialDiagnostics(): void {
        const allDiagnostics = vscode.languages.getDiagnostics();
        for (const [uri, diagnostics] of allDiagnostics) {
            if (uri.scheme !== 'file' || diagnostics.length === 0) {
                continue;
            }
            this._record(collectDiagnostics(uri));
        }
    }

    private async _collectExecutionOutput(
        execution: vscode.TerminalShellExecution,
        entry: PendingExecution,
    ): Promise<void> {
        try {
            for await (const data of execution.read()) {
                if (entry.aborted) { return; }
                if (!entry.truncated) {
                    const remaining = SessionRecorder.MAX_OUTPUT_CHARS - entry.output.length;
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
        if (!entry.endInfo || !this._isRecording) { return; }
        const now = Date.now();
        this._record({
            type: 'terminalCommand',
            timestamp: now,
            command: entry.endInfo.command,
            exitCode: entry.endInfo.exitCode,
            output: entry.output,
            outputTruncated: entry.truncated,
            cwd: entry.endInfo.cwd,
            terminalName: entry.endInfo.terminalName,
            durationMs: now - entry.startTime,
        });
    }

    private async _captureFirstOpenSnapshot(editor: vscode.TextEditor): Promise<void> {
        try {
            await this._snapshotDocument(editor.document.uri.toString(), editor.document.getText());
        } catch (err) {
            logger.error('Failed to capture first-open file snapshot', LogCategory.TELEMETRY, err);
        }
    }
}
