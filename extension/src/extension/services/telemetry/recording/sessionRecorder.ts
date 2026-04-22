/**
 * Main orchestrator for session recording.
 *
 * Runs parallel to TelemetryManager with its own VS Code listeners.
 * Only active when consent is Extended. Writes JSONL event streams
 * to {globalStorageUri}/recordings/{sessionId}/.
 *
 * ## Lifecycle FSM (Block AB)
 *
 * The recorder is a finite-state machine with six phases:
 *
 *   idle → starting → recording → ending → idle          (normal cycle)
 *   {idle|starting|recording|ending} → disabling → disabled  (consent downgrade)
 *   disabled → idle                                       (re-enable)
 *
 * `_phase` replaces the legacy `_isRecording` / `_isEnabled` booleans. Phase
 * transitions other than the synchronous `disable()` kick-off happen inside
 * the lifecycle mutex (`_lifecyclePromise`), so only one of `_doStart`,
 * `_doEnd`, or `_doDisable` runs at a time.
 *
 * ## Session Generation Token
 *
 * Every successful `_doStart` increments `_currentGeneration`. `startSession`
 * callers also receive their own `requestedGeneration` — if another start is
 * enqueued before the current one reaches the commit point, the older
 * request aborts (no `sessionStart` written) and the newer wins. Async work
 * (snapshots, terminal output readers, debounce timers) captures the
 * generation at dispatch time and re-checks before writing, so stale
 * callbacks from a previous session can never contaminate a later one.
 *
 * ## Commit Boundary
 *
 * `_sessionStartWritten` flips to `true` only after the `sessionStart` event
 * has been handed to the writer. It is the authoritative signal for
 * "does the on-disk JSONL contain a session header?". `_committedGeneration`
 * pairs with it: on consent downgrade, `_doDisable` finalises a session only
 * when both are set AND the generation matches the one captured synchronously
 * at `disable()` time — guaranteeing no finalise-after-abort races.
 */

import * as vscode from 'vscode';
import * as crypto from 'crypto';
import type { WebSocketMessageHandler, ResultDTO } from '../../../types';
import type { RecordedEvent, SessionMetadata, SerializedErrorSnapshot } from './types';
import type { PlatformCapabilities } from '../../../theia';
import type { ExerciseRegistry } from '../../exerciseRegistry';
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
import { shouldAcceptBuildResult } from '../buildResultGuard';
import { shouldRecordUri } from './uriFilter';
import { logger, LogCategory } from '../../loggingService';
import { RecorderLifecycleState, type RecorderPhase as RecorderPhaseFromState } from './lifecycle/recorderLifecycleState';
import { SnapshotManager } from './snapshots/snapshotManager';
import { StartupCapture, type StartupContext as StartupContextFromModule, type StartupContributor as StartupContributorFromModule } from './startup/startupCapture';

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

export interface RecordingState {
    isEnabled: boolean;
    isRecording: boolean;
    exerciseId: number | undefined;
    eventCount: number;
}

export type StartupContext = StartupContextFromModule;
export type StartupContributor = StartupContributorFromModule;

type RecorderPhase = RecorderPhaseFromState;

interface RecordInternalOptions {
    allowDuringStartup?: boolean;
    allowDuringEnding?: boolean;
}

export class SessionRecorder implements vscode.Disposable, WebSocketMessageHandler {
    // ── Dispose guard ─────────────────────────────────────────────────

    private _disposed = false;

    // ── Lifecycle state (phase + generation + active session) ─────────

    private readonly _state = new RecorderLifecycleState();

    // Forwarding getters — field-level access is preserved so most callers
    // remain unchanged. Writes go through the explicit _state.* methods.
    private get _phase(): RecorderPhase { return this._state.phase; }
    private get _requestedGeneration(): number { return this._state.requestedGeneration; }
    private get _currentGeneration(): number { return this._state.currentGeneration; }
    private get _committedGeneration(): number | undefined { return this._state.committedGeneration; }
    private get _sessionStartWritten(): boolean {
        return this._state.activeSession?.sessionStartWritten ?? false;
    }
    private get _activeSessionId(): string | undefined { return this._state.activeSession?.sessionId; }
    private get _activeExerciseId(): number | undefined { return this._state.activeSession?.exerciseId; }
    private get _participantId(): string | undefined { return this._state.activeSession?.participantId; }
    private get _exerciseRoot(): string | undefined { return this._state.activeSession?.exerciseRoot; }
    private get _sessionStartTime(): number | undefined { return this._state.activeSession?.sessionStartTime; }
    private get _eventCount(): number { return this._state.activeSession?.eventCount ?? 0; }

    /**
     * Single Promise chain that serialises lifecycle transitions (_doStart,
     * _doEnd, _doDisable). Like storageWriter's write lane but for the
     * recorder's own state-mutating operations.
     */
    private _lifecyclePromise: Promise<void> = Promise.resolve();

    // ── Session state ──────────────────────────────────────────────────

    private _lastActiveEditorUri: string | undefined;
    private readonly _snapshots: SnapshotManager;
    /**
     * Per-URI debounce timers for selection-change events (Block J).
     * Keyed by document URI string so rapid switches between File A and File B
     * each maintain an independent timer and neither event overwrites the other.
     */
    private _selectionDebounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
    /**
     * Per-URI debounce timers for visible-range-change events (Block J).
     */
    private _visibleRangeDebounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
    /**
     * Payloads serialized at trigger time (not callback time) for pending
     * selection-change debounces. Keyed by URI so each file's latest event is
     * captured independently. Cleared when the timer fires or on session end.
     */
    private _pendingSelectionPayloads = new Map<string, RecordedEvent>();
    /**
     * Payloads serialized at trigger time for pending visible-range-change
     * debounces. Keyed by URI.
     */
    private _pendingVisibleRangePayloads = new Map<string, RecordedEvent>();
    private _pendingExecutions = new Map<vscode.TerminalShellExecution, PendingExecution>();
    private static readonly MAX_OUTPUT_CHARS = 10240;
    private static readonly SELECTION_DEBOUNCE_MS = 200;
    private static readonly VISIBLE_RANGE_DEBOUNCE_MS = 300;

    private _eventListenerDisposables: vscode.Disposable[] = [];
    private readonly _writer: RecordingStorageWriter;
    private readonly _startup: StartupCapture;

    private readonly _onDidChangeState = new vscode.EventEmitter<RecordingState>();
    public readonly onDidChangeState = this._onDidChangeState.event;

    private readonly _capabilities?: PlatformCapabilities;
    private readonly _exerciseRegistry?: ExerciseRegistry;

    constructor(
        globalStorageUri: vscode.Uri,
        capabilities?: PlatformCapabilities,
        exerciseRegistry?: ExerciseRegistry,
        /** Injection point for tests. Production uses the default writer. */
        writer?: RecordingStorageWriter,
    ) {
        this._writer = writer ?? new RecordingStorageWriter(globalStorageUri.fsPath);
        this._capabilities = capabilities;
        this._exerciseRegistry = exerciseRegistry;
        this._snapshots = new SnapshotManager({
            state: this._state,
            writer: this._writer,
            record: (event, opts, gen) => this._recordInternal(event, opts, gen),
            lifecycleAppend: event => this._writeLifecycleEvent(event),
        });
        this._startup = new StartupCapture({
            record: (event, opts, gen) => this._recordInternal(event, opts, gen),
        });
    }

    // ── Phase reader (for control-flow in async methods) ──────────────

    /**
     * Read `_phase` as the full `RecorderPhase` union. TypeScript narrows the
     * field to the last-assigned literal inside the body of an async method,
     * which would make `if (this._phase === 'disabling')` look like a
     * type-mismatch after we set `this._phase = 'starting'` — even though
     * `disable()` can legally flip it in between awaits. This accessor bypasses
     * the narrowing.
     */
    private _currentPhase(): RecorderPhase {
        return this._phase;
    }

    /**
     * Parsed exercise root URI for use with `shouldRecordUri`. Returns
     * `undefined` when no session is active (i.e. `_exerciseRoot` is unset).
     * The exercise root is stored as a serialized URI string (e.g.
     * "file:///workspace/ex1") so we parse on demand rather than storing a
     * second field.
     */
    private get _exerciseRootUri(): vscode.Uri | undefined {
        return this._exerciseRoot ? vscode.Uri.parse(this._exerciseRoot) : undefined;
    }

    // ── Public state accessors ────────────────────────────────────────

    /**
     * True when the recorder is accepting work (i.e. consent has been granted
     * and we are not in the process of tearing down). False during `disabling`
     * and `disabled`, so listeners using this flag as a gate will also stop.
     */
    get isEnabled(): boolean {
        return this._phase !== 'disabling' && this._phase !== 'disabled';
    }
    get isRecording(): boolean { return this._phase === 'recording'; }
    get activeExerciseId(): number | undefined { return this._activeExerciseId; }
    get eventCount(): number { return this._eventCount; }

    // ── Startup contributors ──────────────────────────────────────────

    /**
     * Register a synchronous startup event producer. Contributor fires once
     * per session, inside `_doStart`, between the initial-state events and the
     * `startupPhaseComplete` marker. Returns a Disposable that deregisters the
     * contributor.
     */
    public registerStartupContributor(contributor: StartupContributor): vscode.Disposable {
        return this._startup.register(contributor);
    }

    // ── Enable / Disable ──────────────────────────────────────────────

    enable(): void {
        if (this._phase !== 'disabled') {
            return;
        }
        this._state.transitionPhase(['disabled'], 'idle');
        this._registerEventListeners();
        this._fireStateChange();
        logger.info('SessionRecorder enabled', LogCategory.TELEMETRY);
    }

    /**
     * Synchronously kicks off teardown. Transitions `_phase` to `disabling`
     * immediately so that any further public record calls no-op, then
     * enqueues the finalisation on the lifecycle mutex.
     */
    disable(): void {
        if (this._phase === 'disabled' || this._phase === 'disabling') {
            return;
        }
        // Capture "is there a committed session that needs a consentChange +
        // sessionEnd?" at the moment consent was revoked. After setting
        // _phase=disabling below, no new record() can commit a session, so
        // these values are stable until _doDisable runs.
        const shouldFinalize = this._sessionStartWritten
            && (this._phase === 'starting' || this._phase === 'recording' || this._phase === 'ending');
        const generation = this._committedGeneration;

        this._state.forcePhase('disabling');
        // Invalidate any pending startSession() requests that have not yet
        // reached their _doStart closure. The counter is MONOTONIC — we
        // advance it so that every already-captured generation becomes less
        // than `_requestedGeneration`. Combined with the post-commit rule
        // that `_currentGeneration = requestedGen` only at commit point, no
        // stale async callback from a previous generation can ever match a
        // future `_currentGeneration` after a later enable/startSession
        // cycle.
        this._state.bumpRequestedGeneration();

        this._enqueueLifecycle('disable', () => this._doDisable({ shouldFinalize, generation }));
        logger.info('SessionRecorder disable requested', LogCategory.TELEMETRY);
    }

    // ── Session lifecycle ─────────────────────────────────────────────

    /**
     * Enqueue a session-start. If a session is already running, the existing
     * one is gracefully ended before the new one begins. Returns as soon as
     * the enqueue is scheduled — callers may await the returned promise to
     * know when the new session has fully started (or was superseded).
     */
    async startSession(exerciseId: number, participantId?: string, exerciseRoot?: string): Promise<void> {
        if (this._phase === 'disabling' || this._phase === 'disabled') {
            return;
        }

        const requestedGen = this._state.bumpRequestedGeneration();
        return this._enqueueLifecycle('startSession', () =>
            this._doStart(requestedGen, exerciseId, participantId, exerciseRoot));
    }

    /**
     * Gracefully end the currently-active session (if any). Safe to call when
     * no session is running; no-ops in that case.
     */
    async endSession(reason: 'user-end' | 'deactivate' = 'user-end'): Promise<void> {
        if (this._phase === 'disabling' || this._phase === 'disabled') {
            return;
        }
        return this._enqueueLifecycle('endSession', () => this._doEnd(reason));
    }

    /**
     * Queue a lifecycle operation on the mutex. Any thrown error is caught and
     * logged — the stored `_lifecyclePromise` always settles fulfilled, so an
     * unexpected throw in one operation cannot poison future lifecycle calls
     * (which chain via `.then()`).
     */
    private _enqueueLifecycle(label: string, op: () => Promise<void>): Promise<void> {
        this._lifecyclePromise = this._lifecyclePromise
            .catch(err => {
                logger.error(`Lifecycle lane recovered before ${label}`, LogCategory.TELEMETRY, err);
            })
            .then(async () => {
                try {
                    await op();
                } catch (err) {
                    logger.error(`Lifecycle operation failed: ${label}`, LogCategory.TELEMETRY, err);
                }
            });
        return this._lifecyclePromise;
    }

    // ── WebSocketMessageHandler ───────────────────────────────────────

    onNewResult(result: ResultDTO): void {
        if (this._phase !== 'recording') {
            return;
        }
        if (!shouldAcceptBuildResult(result, this._activeExerciseId, this._exerciseRegistry)) {
            return;
        }
        this._recordInternal(
            collectBuildResult(result, this._activeExerciseId),
            {},
            this._currentGeneration,
        );
    }

    // ── Public recording methods for chat events ──────────────────────

    recordIrisChatSent(
        text: string,
        messageId?: string,
        sessionId?: string,
        sentAt?: number,
    ): void {
        if (this._phase !== 'recording') {
            return;
        }
        this._recordInternal({
            type: 'irisChatMessage',
            timestamp: Date.now(),
            direction: 'sent',
            content: text,
            messageId,
            sessionId,
            sentAt,
        }, {}, this._currentGeneration);
    }

    recordIrisChatReceived(
        content: string,
        messageId?: string,
        sessionId?: string,
        sentAt?: number,
    ): void {
        if (this._phase !== 'recording') {
            return;
        }
        this._recordInternal({
            type: 'irisChatMessage',
            timestamp: Date.now(),
            direction: 'received',
            content,
            messageId,
            sessionId,
            sentAt,
        }, {}, this._currentGeneration);
    }

    /**
     * Record a send-attempt lifecycle event.
     *
     * Emit with status='pending' immediately before the API call, then again
     * with status='sent' on success or status='failed' on error. This ensures
     * failed sends are visible in the recording even when no irisChatMessage
     * event is produced.
     */
    recordIrisChatSendAttempt(
        content: string,
        status: 'pending' | 'sent' | 'failed',
        errorMessage?: string,
    ): void {
        if (this._phase !== 'recording') {
            return;
        }
        this._recordInternal({
            type: 'irisChatSendAttempt',
            timestamp: Date.now(),
            content,
            status,
            errorMessage,
        }, {}, this._currentGeneration);
    }

    /**
     * Record a helpful/unhelpful feedback submission for an Iris message.
     */
    recordIrisChatFeedback(messageId: string, helpful: boolean): void {
        if (this._phase !== 'recording') {
            return;
        }
        this._recordInternal({
            type: 'irisChatFeedback',
            timestamp: Date.now(),
            messageId,
            helpful,
        }, {}, this._currentGeneration);
    }

    recordEqSnapshot(
        eq: number,
        confidence: 'sufficient' | 'insufficient',
        source: 'save' | 'build' | 'trigger',
        triggerType?: string,
    ): void {
        if (this._phase !== 'recording') {
            return;
        }
        this._recordInternal({
            type: 'eqSnapshot',
            timestamp: Date.now(),
            eq,
            confidence,
            source,
            triggerType,
        }, {}, this._currentGeneration);
    }

    recordIntervention(
        action: 'shown' | 'accepted' | 'dismissed' | 'blocked',
        level: 'subtle' | 'notification' | 'proactive',
        shouldIntervene: boolean,
        eq: number,
        confidence: 'sufficient' | 'insufficient',
        triggerType?: 'execution-error' | 'multiline-paste' | 'idle' | 'selection-maintained',
        opts?: {
            blockedReason?: 'cooldown' | 'warmup' | 'session-limit' | 'low-confidence';
            dismissReason?: 'user-action' | 'hidden' | 'replaced' | 'session-end';
            rawWanted?: boolean;
        },
    ): void {
        if (this._phase !== 'recording') {
            return;
        }
        this._recordInternal({
            type: 'intervention',
            timestamp: Date.now(),
            action,
            level,
            shouldIntervene,
            eq,
            confidence,
            triggerType,
            blockedReason: opts?.blockedReason,
            dismissReason: opts?.dismissReason,
            rawWanted: opts?.rawWanted,
        }, {}, this._currentGeneration);
    }

    recordViewNavigation(from: string, to: string): void {
        if (this._phase !== 'recording') {
            return;
        }
        this._recordInternal({
            type: 'viewNavigation',
            timestamp: Date.now(),
            from,
            to,
        }, {}, this._currentGeneration);
    }

    recordPanelVisibility(panel: 'artemis' | 'chat', visible: boolean): void {
        if (this._phase !== 'recording') {
            return;
        }
        this._recordInternal({
            type: 'panelVisibility',
            timestamp: Date.now(),
            panel,
            visible,
        }, {}, this._currentGeneration);
    }

    recordEqEngineState(
        snapshots: SerializedErrorSnapshot[],
        currentEQ: number,
        pairCount: number,
        confidence: 'sufficient' | 'insufficient',
    ): void {
        if (this._phase !== 'recording') {
            return;
        }
        this._recordInternal({
            type: 'eqEngineState',
            timestamp: Date.now(),
            snapshots,
            currentEQ,
            pairCount,
            confidence,
        }, {}, this._currentGeneration);
    }

    // ── Disposable ────────────────────────────────────────────────────

    async dispose(): Promise<void> {
        if (this._disposed) { return; }
        this._disposed = true;
        if (this._phase === 'recording' || this._phase === 'starting') {
            try {
                await this.endSession('deactivate');
            } catch (err: unknown) {
                logger.error('Failed to end recording session during dispose', LogCategory.TELEMETRY, err);
            }
        }
        // Drain any outstanding lifecycle operations.
        try {
            await this._lifecyclePromise;
        } catch {
            /* lifecycle promise is always settled-success, but be defensive */
        }
        this._disposeEventListeners();
        await this._writer.dispose();
        this._onDidChangeState.dispose();
    }

    // ── Private: State notification ─────────────────────────────────────

    private _fireStateChange(): void {
        this._onDidChangeState.fire({
            isEnabled: this.isEnabled,
            isRecording: this.isRecording,
            exerciseId: this._activeExerciseId,
            eventCount: this._eventCount,
        });
    }

    // ── Private: Event recording ──────────────────────────────────────

    /**
     * Internal event-recording path used by all event sources. Enforces phase
     * and generation gates so stale callbacks from a previous session (or
     * writes during startup / shutdown) cannot leak events into the stream.
     *
     * @param gen   Generation captured by the caller at dispatch time. If set,
     *              the write is dropped when it does not match the current
     *              generation. Omit only for synchronous callers that are
     *              statically guaranteed to run inside the current session.
     */
    private _recordInternal(
        event: RecordedEvent,
        opts: RecordInternalOptions,
        gen?: number,
    ): void {
        if (gen !== undefined && gen !== this._currentGeneration) {
            return;
        }

        const phase = this._phase;
        if (phase === 'recording') {
            // always allowed
        } else if (phase === 'starting' && opts.allowDuringStartup) {
            // allowed
        } else if (phase === 'ending' && opts.allowDuringEnding) {
            // allowed
        } else {
            return;
        }

        this._state.incrementEventCount();
        this._writer.appendEvent(event);
    }

    /**
     * Lifecycle-only writer channel. Bypasses the phase gate used by
     * `_recordInternal` — callers are trusted to write only during valid
     * lifecycle transitions (sessionStart/End, consentChange, startupPhaseComplete).
     */
    private _writeLifecycleEvent(event: RecordedEvent): void {
        this._state.incrementEventCount();
        this._writer.appendEvent(event);
    }

    // ── Private: Lifecycle operations ─────────────────────────────────

    /**
     * Starts a new session. Runs inside the lifecycle mutex, so at most one
     * `_doStart` / `_doEnd` / `_doDisable` executes at a time.
     *
     * The method has two re-check points:
     *   - pre-commit (after `initSession`, before writing `sessionStart`) —
     *     if the request was superseded or disable() fired, abort the writer.
     *   - post-commit (after each async snapshot phase) — if disable() fired,
     *     leave the commit in place so `_doDisable` can finalise it; if a
     *     newer start was requested, end this session gracefully.
     */
    private async _doStart(
        requestedGen: number,
        exerciseId: number,
        participantId: string | undefined,
        exerciseRoot: string | undefined,
    ): Promise<void> {
        // Superseded before we even got scheduled (or disable() ran).
        if (requestedGen !== this._requestedGeneration) {
            return;
        }
        if (this._phase === 'disabling' || this._phase === 'disabled') {
            return;
        }

        // End any in-flight session first. _doEnd sets phase back to idle.
        if (this._phase === 'recording') {
            await this._doEnd('user-end');
            // Re-check after async work: disable() or a newer start may have fired.
            if (requestedGen !== this._requestedGeneration) {
                return;
            }
            if (this._currentPhase() === 'disabling' || this._currentPhase() === 'disabled') {
                return;
            }
        }

        this._state.transitionPhase(['idle'], 'starting');

        const hex = crypto.randomBytes(3).toString('hex');
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const sessionId = `${exerciseId}-${timestamp}-${hex}`;
        this._state.beginSession({
            sessionId,
            exerciseId,
            participantId,
            exerciseRoot,
            sessionStartTime: Date.now(),
        });
        this._lastActiveEditorUri = vscode.window.activeTextEditor?.document.uri.toString();

        await this._writer.initSession(sessionId);

        // Pre-commit re-check: if the request was superseded or consent was
        // revoked while initSession was in flight, abort the writer so no
        // partial session leaks to disk.
        if (requestedGen !== this._requestedGeneration) {
            if (this._currentPhase() === 'starting') {
                this._state.clearActiveSessionAfterFinalize();
            }
            await this._writer.abort();
            return;
        }
        if (this._currentPhase() === 'disabling' || this._currentPhase() === 'disabled') {
            await this._writer.abort();
            return;
        }

        // ── Commit point ── (atomic: generation commit + sessionStart write)
        this._state.markSessionStartWritten(requestedGen);
        const sessionStartTs = Date.now();
        this._writeLifecycleEvent({
            type: 'sessionStart',
            timestamp: sessionStartTs,
            exerciseId,
            participantId,
            exerciseRoot,
            schemaVersion: 2,
        });

        // ── Phase 1: open-file snapshots (async) ──
        await this._snapshots.captureOpenFileSnapshots(requestedGen, this._exerciseRootUri);

        // Post-commit check: phase first (disable() also advances _requestedGeneration,
        // so the generation check below would also fire — we want the phase path).
        if (this._currentPhase() === 'disabling' || this._currentPhase() === 'disabled') {
            return; // _doDisable will finalize the committed session
        }
        if (requestedGen !== this._requestedGeneration) {
            await this._doEnd('user-end');
            return;
        }

        // ── Phases 2-4: diagnostics + contributors + initial-state (sync) ──
        const startupCtx: StartupContext = {
            exerciseId,
            participantId,
            exerciseRoot,
            sessionId,
            timestamp: Date.now(),
        };
        this._startup.emitStartupEvents(
            startupCtx,
            requestedGen,
            this._exerciseRootUri,
            uri => { this._lastActiveEditorUri = uri; },
        );

        // Defensive post-commit re-check (sync path, so only disable can flip phase).
        if (this._currentPhase() === 'disabling' || this._currentPhase() === 'disabled') {
            return;
        }
        if (requestedGen !== this._requestedGeneration) {
            await this._doEnd('user-end');
            return;
        }

        this._writeLifecycleEvent({
            type: 'startupPhaseComplete',
            timestamp: Date.now(),
        });
        this._state.markStartupComplete();
        this._fireStateChange();

        logger.info(`Recording session started: ${sessionId}`, LogCategory.TELEMETRY);
    }

    /**
     * Gracefully end the currently-active session. Only invoked via the
     * normal lifecycle path (explicit endSession, superseded by newer start,
     * or deactivate). Consent-downgrade goes through `_doDisable` instead.
     */
    private async _doEnd(reason: 'user-end' | 'deactivate'): Promise<void> {
        if (this._phase !== 'recording' && this._phase !== 'starting') {
            return;
        }
        const active = this._state.activeSession;
        if (!active) {
            return;
        }

        const generation = this._currentGeneration;
        this._state.transitionPhase(['recording', 'starting'], 'ending');

        // Flush pending debounced payloads so the session ends with a complete
        // picture. These use the ending-allowance so _recordInternal lets them
        // through.
        this._flushPendingDebouncesForEnd(generation);

        // Abort any still-running terminal shell executions.
        for (const entry of this._pendingExecutions.values()) {
            entry.aborted = true;
        }
        this._pendingExecutions.clear();

        const exerciseId = active.exerciseId;
        this._writeLifecycleEvent({
            type: 'sessionEnd',
            timestamp: Date.now(),
            exerciseId,
        });

        const metadata: SessionMetadata = {
            sessionId: active.sessionId,
            exerciseId,
            participantId: active.participantId,
            startTime: active.sessionStartTime,
            endTime: Date.now(),
            eventCount: active.eventCount,
        };

        await this._writer.flush();
        await this._writer.writeMetadata(metadata);
        await this._writer.endSession();

        logger.info(
            `Recording session ended (${reason}): ${active.sessionId} (${active.eventCount} events)`,
            LogCategory.TELEMETRY,
        );

        // Clear commit-boundary flags only after the writer has fully
        // finalized. Until then, a concurrent disable() must still see
        // _sessionStartWritten=true and route through the downgrade path.
        this._state.clearCommitAfterFinalize();
        this._resetSessionState();
        this._state.clearActiveSessionAfterFinalize();
        this._fireStateChange();
    }

    /**
     * Teardown path for consent downgrade. Runs after any in-flight _doStart
     * has drained (via the lifecycle mutex). If `finalizeNow` holds, a
     * consentChange + sessionEnd pair is written and metadata is flushed.
     * Pending debounce payloads are DISCARDED on this path (GDPR-strict
     * Option A): the user revoked consent, so the last cached keystroke
     * derivative must not hit disk.
     */
    private async _doDisable(
        params: { shouldFinalize: boolean; generation: number | undefined },
    ): Promise<void> {
        const { shouldFinalize, generation } = params;

        const finalizeNow = shouldFinalize
            && this._sessionStartWritten
            && generation !== undefined
            && this._committedGeneration === generation;

        if (finalizeNow) {
            try {
                await this._doFinalizeAfterDisable(generation);
            } catch (err) {
                logger.error('Failed to finalize session during disable', LogCategory.TELEMETRY, err);
            }
        }

        this._disposeEventListeners();
        // If _doFinalizeAfterDisable ran, phase already moved to 'disabled'
        // via clearActiveSessionAfterFinalize(). Otherwise, force the flip now.
        if (this._phase !== 'disabled') {
            this._state.forcePhase('disabled');
        }
        this._fireStateChange();
        logger.info('SessionRecorder disabled', LogCategory.TELEMETRY);
    }

    private async _doFinalizeAfterDisable(generation: number): Promise<void> {
        // Guard: another lifecycle op may have already finalized the session.
        if (this._currentGeneration !== generation || !this._sessionStartWritten) {
            return;
        }
        const active = this._state.activeSession;
        if (!active) {
            return;
        }

        const exerciseId = active.exerciseId;
        const consentTs = Date.now();

        this._writeLifecycleEvent({
            type: 'consentChange',
            timestamp: consentTs,
            level: 'downgraded',
        });

        // GDPR-strict: discard any buffered debounced payloads. These are the
        // last bits of observation the user did not want recorded.
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

        // Abort any still-running terminal shell executions.
        for (const entry of this._pendingExecutions.values()) {
            entry.aborted = true;
        }
        this._pendingExecutions.clear();

        this._writeLifecycleEvent({
            type: 'sessionEnd',
            timestamp: Date.now(),
            exerciseId,
        });

        const metadata: SessionMetadata = {
            sessionId: active.sessionId,
            exerciseId,
            participantId: active.participantId,
            startTime: active.sessionStartTime,
            endTime: Date.now(),
            eventCount: active.eventCount,
        };

        await this._writer.flush();
        await this._writer.writeMetadata(metadata);
        await this._writer.endSession();

        this._state.clearCommitAfterFinalize();
        this._resetSessionState();
        this._state.clearActiveSessionAfterFinalize();
    }

    private _resetSessionState(): void {
        this._snapshots.reset();
        this._lastActiveEditorUri = undefined;
    }

    private _flushPendingDebouncesForEnd(generation: number): void {
        // Cancel all per-URI timers and flush their payloads (Block J).
        for (const timer of this._selectionDebounceTimers.values()) {
            clearTimeout(timer);
        }
        this._selectionDebounceTimers.clear();
        for (const payload of this._pendingSelectionPayloads.values()) {
            this._recordInternal(payload, { allowDuringEnding: true }, generation);
        }
        this._pendingSelectionPayloads.clear();

        for (const timer of this._visibleRangeDebounceTimers.values()) {
            clearTimeout(timer);
        }
        this._visibleRangeDebounceTimers.clear();
        for (const payload of this._pendingVisibleRangePayloads.values()) {
            this._recordInternal(payload, { allowDuringEnding: true }, generation);
        }
        this._pendingVisibleRangePayloads.clear();
    }

    // ── Private: Listener setup ───────────────────────────────────────

    private _registerEventListeners(): void {
        // Text changes
        const textChange = vscode.workspace.onDidChangeTextDocument(event => {
            if (this._phase !== 'recording') { return; }
            if (!shouldRecordUri(event.document.uri, this._exerciseRootUri)) { return; }
            if (event.contentChanges.length === 0) { return; }
            this._recordInternal(collectTextChange(event), {}, this._currentGeneration);
        });
        this._eventListenerDisposables.push(textChange);

        // File save
        const save = vscode.workspace.onDidSaveTextDocument(doc => {
            if (this._phase !== 'recording') { return; }
            if (!shouldRecordUri(doc.uri, this._exerciseRootUri)) { return; }
            this._recordInternal(collectSave(doc), {}, this._currentGeneration);
        });
        this._eventListenerDisposables.push(save);

        // Active editor switch + snapshot on first open
        const editorSwitch = vscode.window.onDidChangeActiveTextEditor(editor => {
            if (this._phase !== 'recording') { return; }
            const prev = this._lastActiveEditorUri;
            const toUri = editor?.document.uri.toString();
            this._lastActiveEditorUri = toUri;
            // Record the switch when the destination is a recordable URI, or
            // when there is a previous URI (switching away from a known editor).
            if (prev || (editor && shouldRecordUri(editor.document.uri, this._exerciseRootUri))) {
                this._recordInternal(collectFileSwitch(prev, editor), {}, this._currentGeneration);
            }
            // Snapshot file if it is recordable and opened for the first time this session.
            if (editor && shouldRecordUri(editor.document.uri, this._exerciseRootUri) && toUri && !this._snapshots.hasSnapshot(toUri)) {
                const capturedGen = this._currentGeneration;
                const content = editor.document.getText();
                void this._snapshots.snapshotContent(toUri, content, capturedGen, { allowDuringStartup: false })
                    .catch(err => logger.error('Failed to capture first-open file snapshot', LogCategory.TELEMETRY, err));
            }
        });
        this._eventListenerDisposables.push(editorSwitch);

        // Diagnostics changes
        const diagnosticsChange = vscode.languages.onDidChangeDiagnostics(event => {
            if (this._phase !== 'recording') { return; }
            for (const uri of event.uris) {
                if (!shouldRecordUri(uri, this._exerciseRootUri)) { continue; }
                this._recordInternal(collectDiagnostics(uri), {}, this._currentGeneration);
            }
        });
        this._eventListenerDisposables.push(diagnosticsChange);

        // Window focus
        const windowFocus = vscode.window.onDidChangeWindowState(state => {
            if (this._phase !== 'recording') { return; }
            this._recordInternal(collectWindowFocus(state), {}, this._currentGeneration);
        });
        this._eventListenerDisposables.push(windowFocus);

        // Selection changes (debounced 200ms, per-URI — Block J).
        // Payload is serialized NOW (trigger time), not inside the callback,
        // so the recorded selections reflect the state at the moment the event
        // fired, not whatever the editor shows 200ms later.
        const selectionChange = vscode.window.onDidChangeTextEditorSelection(event => {
            if (this._phase !== 'recording') { return; }
            if (!shouldRecordUri(event.textEditor.document.uri, this._exerciseRootUri)) { return; }
            const uri = event.textEditor.document.uri.toString();
            // Serialize at trigger time (fixes J.2: callback-time read).
            const payload = collectSelectionChange(event.textEditor, event.kind);
            this._pendingSelectionPayloads.set(uri, payload);
            const capturedGen = this._currentGeneration;
            // Clear any existing timer for this URI (fixes J.1: per-URI timer).
            const existing = this._selectionDebounceTimers.get(uri);
            if (existing !== undefined) { clearTimeout(existing); }
            const timer = setTimeout(() => {
                this._selectionDebounceTimers.delete(uri);
                // Only record if this payload is still the pending one for this
                // URI (guards against a race where a new trigger arrived in the
                // tiny window between the timer firing and this line executing).
                if (this._pendingSelectionPayloads.get(uri) === payload) {
                    this._pendingSelectionPayloads.delete(uri);
                    this._recordInternal(payload, {}, capturedGen);
                }
            }, SessionRecorder.SELECTION_DEBOUNCE_MS);
            this._selectionDebounceTimers.set(uri, timer);
        });
        this._eventListenerDisposables.push(selectionChange);

        // Visible range changes (debounced 300ms, per-URI — Block J).
        const visibleRangeChange = vscode.window.onDidChangeTextEditorVisibleRanges(event => {
            if (this._phase !== 'recording') { return; }
            if (!shouldRecordUri(event.textEditor.document.uri, this._exerciseRootUri)) { return; }
            const uri = event.textEditor.document.uri.toString();
            // Serialize at trigger time (fixes J.2).
            const payload = collectVisibleRangeChange(event.textEditor);
            this._pendingVisibleRangePayloads.set(uri, payload);
            const capturedGen = this._currentGeneration;
            // Clear any existing timer for this URI (fixes J.1).
            const existing = this._visibleRangeDebounceTimers.get(uri);
            if (existing !== undefined) { clearTimeout(existing); }
            const timer = setTimeout(() => {
                this._visibleRangeDebounceTimers.delete(uri);
                if (this._pendingVisibleRangePayloads.get(uri) === payload) {
                    this._pendingVisibleRangePayloads.delete(uri);
                    this._recordInternal(payload, {}, capturedGen);
                }
            }, SessionRecorder.VISIBLE_RANGE_DEBOUNCE_MS);
            this._visibleRangeDebounceTimers.set(uri, timer);
        });
        this._eventListenerDisposables.push(visibleRangeChange);

        // Terminal open
        const terminalOpen = vscode.window.onDidOpenTerminal(terminal => {
            if (this._phase !== 'recording') { return; }
            this._recordInternal({
                type: 'terminalOpenClose',
                timestamp: Date.now(),
                action: 'opened',
                terminalName: terminal.name,
            }, {}, this._currentGeneration);
        });
        this._eventListenerDisposables.push(terminalOpen);

        // Terminal close
        const terminalClose = vscode.window.onDidCloseTerminal(terminal => {
            if (this._phase !== 'recording') { return; }
            this._recordInternal({
                type: 'terminalOpenClose',
                timestamp: Date.now(),
                action: 'closed',
                terminalName: terminal.name,
            }, {}, this._currentGeneration);
        });
        this._eventListenerDisposables.push(terminalClose);

        // File workspace events (Block K)
        const fileCreate = vscode.workspace.onDidCreateFiles(event => {
            if (this._phase !== 'recording') { return; }
            const gen = this._currentGeneration;
            for (const uri of event.files) {
                if (!shouldRecordUri(uri, this._exerciseRootUri)) { continue; }
                this._recordInternal({
                    type: 'fileCreate',
                    timestamp: Date.now(),
                    uri: uri.toString(),
                }, {}, gen);
            }
        });
        this._eventListenerDisposables.push(fileCreate);

        const fileDelete = vscode.workspace.onDidDeleteFiles(event => {
            if (this._phase !== 'recording') { return; }
            const gen = this._currentGeneration;
            for (const uri of event.files) {
                if (!shouldRecordUri(uri, this._exerciseRootUri)) { continue; }
                this._recordInternal({
                    type: 'fileDelete',
                    timestamp: Date.now(),
                    uri: uri.toString(),
                }, {}, gen);
            }
        });
        this._eventListenerDisposables.push(fileDelete);

        const fileRename = vscode.workspace.onDidRenameFiles(event => {
            if (this._phase !== 'recording') { return; }
            const gen = this._currentGeneration;
            for (const { oldUri, newUri } of event.files) {
                // Record when either end of the rename is within the exercise root.
                if (!shouldRecordUri(oldUri, this._exerciseRootUri) && !shouldRecordUri(newUri, this._exerciseRootUri)) {
                    continue;
                }
                this._recordInternal({
                    type: 'fileRename',
                    timestamp: Date.now(),
                    oldUri: oldUri.toString(),
                    newUri: newUri.toString(),
                }, {}, gen);
            }
        });
        this._eventListenerDisposables.push(fileRename);

        const textDocumentOpen = vscode.workspace.onDidOpenTextDocument(doc => {
            if (this._phase !== 'recording') { return; }
            if (!shouldRecordUri(doc.uri, this._exerciseRootUri)) { return; }
            const gen = this._currentGeneration;
            this._recordInternal({
                type: 'textDocumentOpen',
                timestamp: Date.now(),
                uri: doc.uri.toString(),
            }, {}, gen);
        });
        this._eventListenerDisposables.push(textDocumentOpen);

        const textDocumentClose = vscode.workspace.onDidCloseTextDocument(doc => {
            if (this._phase !== 'recording') { return; }
            if (!shouldRecordUri(doc.uri, this._exerciseRootUri)) { return; }
            const gen = this._currentGeneration;
            this._recordInternal({
                type: 'textDocumentClose',
                timestamp: Date.now(),
                uri: doc.uri.toString(),
            }, {}, gen);
        });
        this._eventListenerDisposables.push(textDocumentClose);

        // Terminal shell execution tracking — only available in VS Code Desktop (not all Theia builds)
        if (this._capabilities?.hasTerminalShellExecution !== false) {
            const shellExecStart = vscode.window.onDidStartTerminalShellExecution(event => {
                if (this._phase !== 'recording') { return; }
                const entry: PendingExecution = {
                    output: '', startTime: Date.now(), truncated: false,
                    readerDone: false, endInfo: undefined, aborted: false,
                    generation: this._currentGeneration,
                };
                this._pendingExecutions.set(event.execution, entry);
                void this._collectExecutionOutput(event.execution, entry);
            });
            this._eventListenerDisposables.push(shellExecStart);

            const shellExecEnd = vscode.window.onDidEndTerminalShellExecution(event => {
                if (this._phase !== 'recording') { return; }
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
        // Stop all pending debounce timers so their callbacks never fire after
        // the listeners are torn down. Payload maps are cleared here too so no
        // orphaned payloads remain after the timers are cancelled — this is safe
        // because every caller either flushed (endSession path via
        // _flushPendingDebouncesForEnd) or discarded (_doFinalizeAfterDisable)
        // the pending payloads before reaching this point.
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
        while (this._eventListenerDisposables.length > 0) {
            const disposable = this._eventListenerDisposables.pop();
            disposable?.dispose();
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
        if (!entry.endInfo) { return; }
        if (this._phase !== 'recording') { return; }
        const now = Date.now();
        this._recordInternal({
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
