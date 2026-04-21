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
import type { RecordedEvent, SessionMetadata, SerializedErrorSnapshot, FileSnapshotErrorEvent } from './types';
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

/**
 * Context supplied to startup contributors. Contributors run synchronously
 * inside `_doStart`, after `sessionStart` + snapshots + initial diagnostics
 * and before `startupPhaseComplete`, so they see a fully-committed session.
 */
export interface StartupContext {
    exerciseId: number;
    participantId: string | undefined;
    exerciseRoot: string | undefined;
    sessionId: string;
    timestamp: number;
}

/**
 * Synchronous producer of startup events. Returns zero or more events to be
 * appended to the stream as part of session startup. MUST NOT perform async
 * work — the recorder calls the contributor synchronously to guarantee
 * deterministic event ordering.
 */
export type StartupContributor = (ctx: StartupContext) => RecordedEvent[];

type RecorderPhase =
    | 'idle'
    | 'starting'
    | 'recording'
    | 'ending'
    | 'disabling'
    | 'disabled';

interface RecordInternalOptions {
    allowDuringStartup?: boolean;
    allowDuringEnding?: boolean;
}

export class SessionRecorder implements vscode.Disposable, WebSocketMessageHandler {
    // ── Dispose guard ─────────────────────────────────────────────────

    private _disposed = false;

    // ── Phase + generation tracking ────────────────────────────────────

    private _phase: RecorderPhase = 'disabled';
    /** Monotonic counter; bumped every time startSession() or disable() is invoked. */
    private _requestedGeneration = 0;
    /** Generation of the currently-running (or just-committed) session. */
    private _currentGeneration = 0;
    /** Generation that owns the on-disk sessionStart event, if any. */
    private _committedGeneration: number | undefined;
    /** True iff `sessionStart` has been handed to the writer for the current session. */
    private _sessionStartWritten = false;

    /**
     * Single Promise chain that serialises lifecycle transitions (_doStart,
     * _doEnd, _doDisable). Like storageWriter's write lane but for the
     * recorder's own state-mutating operations.
     */
    private _lifecyclePromise: Promise<void> = Promise.resolve();

    // ── Session state ──────────────────────────────────────────────────

    private _activeSessionId: string | undefined;
    private _activeExerciseId: number | undefined;
    private _lastActiveEditorUri: string | undefined;
    private _eventCount = 0;
    private _sessionStartTime: number | undefined;
    private _participantId: string | undefined;

    private _exerciseRoot: string | undefined;
    private _snapshotedUris = new Set<string>();
    /**
     * Tracks the number of consecutive write failures per URI during the
     * current session. Once the count reaches MAX_SNAPSHOT_RETRIES, the URI
     * is added to `_snapshotedUris` to prevent further attempts and a
     * `fileSnapshotError` lifecycle event is emitted once.
     */
    private _snapshotRetries = new Map<string, number>();
    private static readonly MAX_SNAPSHOT_RETRIES = 3;
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
    private readonly _startupContributors: StartupContributor[] = [];

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
        this._startupContributors.push(contributor);
        return new vscode.Disposable(() => {
            const idx = this._startupContributors.indexOf(contributor);
            if (idx >= 0) {
                this._startupContributors.splice(idx, 1);
            }
        });
    }

    // ── Enable / Disable ──────────────────────────────────────────────

    enable(): void {
        if (this._phase !== 'disabled') {
            return;
        }
        this._phase = 'idle';
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

        this._phase = 'disabling';
        // Invalidate any pending startSession() requests that have not yet
        // reached their _doStart closure. The counter is MONOTONIC — we
        // advance it so that every already-captured generation becomes less
        // than `_requestedGeneration`. Combined with the post-commit rule
        // that `_currentGeneration = requestedGen` only at commit point, no
        // stale async callback from a previous generation can ever match a
        // future `_currentGeneration` after a later enable/startSession
        // cycle.
        this._requestedGeneration++;

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

        const requestedGen = ++this._requestedGeneration;
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

        this._eventCount++;
        this._writer.appendEvent(event);
    }

    /**
     * Lifecycle-only writer channel. Bypasses the phase gate used by
     * `_recordInternal` — callers are trusted to write only during valid
     * lifecycle transitions (sessionStart/End, consentChange, startupPhaseComplete).
     */
    private _writeLifecycleEvent(event: RecordedEvent): void {
        this._eventCount++;
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

        this._phase = 'starting';
        this._sessionStartWritten = false;

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

        // Pre-commit re-check: if the request was superseded or consent was
        // revoked while initSession was in flight, abort the writer so no
        // partial session leaks to disk.
        if (requestedGen !== this._requestedGeneration) {
            if (this._currentPhase() === 'starting') {
                this._phase = 'idle';
            }
            await this._writer.abort();
            return;
        }
        if (this._currentPhase() === 'disabling' || this._currentPhase() === 'disabled') {
            await this._writer.abort();
            return;
        }

        // ── Commit point ──
        this._currentGeneration = requestedGen;
        const sessionStartTs = Date.now();
        this._writeLifecycleEvent({
            type: 'sessionStart',
            timestamp: sessionStartTs,
            exerciseId,
            participantId,
            exerciseRoot,
            schemaVersion: 2,
        });
        this._sessionStartWritten = true;
        this._committedGeneration = requestedGen;

        // ── Phase 1: open-file snapshots (async) ──
        await this._captureOpenFileSnapshots(requestedGen);

        // Post-commit check: phase first (disable() also advances _requestedGeneration,
        // so the generation check below would also fire — we want the phase path).
        if (this._currentPhase() === 'disabling' || this._currentPhase() === 'disabled') {
            return; // _doDisable will finalize the committed session
        }
        if (requestedGen !== this._requestedGeneration) {
            await this._doEnd('user-end');
            return;
        }

        // ── Phase 2: initial diagnostics (sync) ──
        this._captureInitialDiagnostics(requestedGen);

        // ── Phase 3: startup contributors (sync) ──
        const startupCtx: StartupContext = {
            exerciseId,
            participantId,
            exerciseRoot,
            sessionId: this._activeSessionId,
            timestamp: Date.now(),
        };
        for (const contributor of this._startupContributors) {
            let events: RecordedEvent[] = [];
            try {
                events = contributor(startupCtx);
            } catch (err) {
                logger.error('Startup contributor threw', LogCategory.TELEMETRY, err);
                continue;
            }
            for (const ev of events) {
                this._recordInternal(ev, { allowDuringStartup: true }, requestedGen);
            }
        }

        // ── Phase 4: initial-state events (Block E, sync) ──
        this._captureInitialStateEvents(requestedGen);

        // Defensive post-commit re-check (sync path, so only disable can flip phase).
        if (this._currentPhase() === 'disabling' || this._currentPhase() === 'disabled') {
            return;
        }
        if (requestedGen !== this._requestedGeneration) {
            await this._doEnd('user-end');
            return;
        }

        this._phase = 'recording';
        this._writeLifecycleEvent({
            type: 'startupPhaseComplete',
            timestamp: Date.now(),
        });
        this._fireStateChange();

        logger.info(`Recording session started: ${this._activeSessionId}`, LogCategory.TELEMETRY);
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
        if (!this._activeSessionId || this._activeExerciseId === undefined) {
            return;
        }

        const generation = this._currentGeneration;
        this._phase = 'ending';

        // Flush pending debounced payloads so the session ends with a complete
        // picture. These use the ending-allowance so _recordInternal lets them
        // through.
        this._flushPendingDebouncesForEnd(generation);

        // Abort any still-running terminal shell executions.
        for (const entry of this._pendingExecutions.values()) {
            entry.aborted = true;
        }
        this._pendingExecutions.clear();

        const exerciseId = this._activeExerciseId;
        this._writeLifecycleEvent({
            type: 'sessionEnd',
            timestamp: Date.now(),
            exerciseId,
        });

        const metadata: SessionMetadata = {
            sessionId: this._activeSessionId,
            exerciseId,
            participantId: this._participantId,
            startTime: this._sessionStartTime!,
            endTime: Date.now(),
            eventCount: this._eventCount,
        };

        await this._writer.flush();
        await this._writer.writeMetadata(metadata);
        await this._writer.endSession();

        logger.info(
            `Recording session ended (${reason}): ${this._activeSessionId} (${this._eventCount} events)`,
            LogCategory.TELEMETRY,
        );

        // Clear commit-boundary flags only after the writer has fully
        // finalized. Until then, a concurrent disable() must still see
        // _sessionStartWritten=true and route through the downgrade path.
        this._sessionStartWritten = false;
        this._committedGeneration = undefined;
        this._resetSessionState();
        this._phase = 'idle';
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
        this._phase = 'disabled';
        this._fireStateChange();
        logger.info('SessionRecorder disabled', LogCategory.TELEMETRY);
    }

    private async _doFinalizeAfterDisable(generation: number): Promise<void> {
        // Guard: another lifecycle op may have already finalized the session.
        if (this._currentGeneration !== generation || !this._sessionStartWritten) {
            return;
        }
        if (!this._activeSessionId || this._activeExerciseId === undefined) {
            return;
        }

        const exerciseId = this._activeExerciseId;
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
            sessionId: this._activeSessionId,
            exerciseId,
            participantId: this._participantId,
            startTime: this._sessionStartTime!,
            endTime: Date.now(),
            eventCount: this._eventCount,
        };

        await this._writer.flush();
        await this._writer.writeMetadata(metadata);
        await this._writer.endSession();

        this._sessionStartWritten = false;
        this._committedGeneration = undefined;
        this._resetSessionState();
    }

    private _resetSessionState(): void {
        this._activeSessionId = undefined;
        this._activeExerciseId = undefined;
        this._participantId = undefined;
        this._exerciseRoot = undefined;
        this._sessionStartTime = undefined;
        this._snapshotedUris.clear();
        this._snapshotRetries.clear();
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
            if (editor && shouldRecordUri(editor.document.uri, this._exerciseRootUri) && toUri && !this._snapshotedUris.has(toUri)) {
                const capturedGen = this._currentGeneration;
                void this._captureFirstOpenSnapshot(editor, capturedGen);
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

    // ── Private: Snapshot capture ─────────────────────────────────────

    /**
     * Check that the captured generation is still current AND that the phase
     * is a valid writing phase. Used as the gate before snapshot file I/O so
     * we don't write user code to disk after consent revocation.
     *
     * Caveat: this predicate is evaluated synchronously before the writer
     * enqueues the write. A snapshot that is already queued in the writer's
     * lane when disable() fires will still hit disk. Fully-cancellable lane
     * writes would need a lane-level predicate; not implemented here because
     * the write lane's serialisation already makes this window very small
     * and the alternative adds material complexity.
     */
    private _canWriteSnapshot(generation: number): boolean {
        if (generation !== this._currentGeneration) { return false; }
        const phase = this._currentPhase();
        return phase === 'starting' || phase === 'recording';
    }

    private async _snapshotDocument(
        uri: string,
        content: string,
        generation: number,
        allowDuringStartup: boolean,
    ): Promise<void> {
        // Re-check BEFORE handing bytes to the writer. Protects against
        // enqueuing snapshot file writes after consent revocation.
        if (!this._canWriteSnapshot(generation)) {
            return;
        }
        const snapshotPath = this._writer.getSnapshotRelativePath(uri);
        const success = await this._writer.writeSnapshot(uri, content);

        // After the async writeSnapshot, the session may have rotated OR the
        // phase may have flipped to disabled. Use the same consent/session
        // gate as the pre-write check so that disabled-but-same-generation
        // does not pollute `_snapshotedUris` (which tracks state for the
        // next session).
        if (!this._canWriteSnapshot(generation)) {
            return;
        }

        if (!success) {
            // Increment retry counter for this URI.
            const retries = (this._snapshotRetries.get(uri) ?? 0) + 1;
            this._snapshotRetries.set(uri, retries);

            if (retries >= SessionRecorder.MAX_SNAPSHOT_RETRIES) {
                // Max retries reached: mark URI as permanently "vergeben" so no
                // further attempts are made, then emit a single error lifecycle event.
                this._snapshotedUris.add(uri);
                this._snapshotRetries.delete(uri);
                const errorEvent: FileSnapshotErrorEvent = {
                    type: 'fileSnapshotError',
                    timestamp: Date.now(),
                    uri,
                    reason: 'snapshot-write-failed-after-3-retries',
                };
                this._writeLifecycleEvent(errorEvent);
                logger.warn(
                    `[SessionRecorder] Snapshot permanently failed for ${uri} after ${SessionRecorder.MAX_SNAPSHOT_RETRIES} retries`,
                    LogCategory.TELEMETRY,
                );
            }
            // On failure (below max retries), do NOT add to _snapshotedUris so
            // _captureFirstOpenSnapshot will retry on the next editor switch.
            return;
        }

        this._snapshotedUris.add(uri);
        this._snapshotRetries.delete(uri);
        this._recordInternal(
            { type: 'fileSnapshot', timestamp: Date.now(), uri, snapshotPath },
            { allowDuringStartup },
            generation,
        );
    }

    private async _captureOpenFileSnapshots(generation: number): Promise<void> {
        for (const doc of vscode.workspace.textDocuments) {
            if (!shouldRecordUri(doc.uri, this._exerciseRootUri)) {
                continue;
            }
            // Stop starting new snapshot writes as soon as the session is
            // superseded or disabled. Previously-queued snapshots may still
            // complete — _snapshotDocument re-checks before the writer call
            // to narrow that window.
            if (!this._canWriteSnapshot(generation)) {
                return;
            }
            try {
                await this._snapshotDocument(doc.uri.toString(), doc.getText(), generation, true);
            } catch (err) {
                logger.error('Failed to capture file snapshot', LogCategory.TELEMETRY, err);
            }
        }
    }

    private _captureInitialDiagnostics(generation: number): void {
        const allDiagnostics = vscode.languages.getDiagnostics();
        for (const [uri, diagnostics] of allDiagnostics) {
            if (!shouldRecordUri(uri, this._exerciseRootUri) || diagnostics.length === 0) {
                continue;
            }
            this._recordInternal(
                collectDiagnostics(uri),
                { allowDuringStartup: true },
                generation,
            );
        }
    }

    /**
     * Emit the Block E initial-state events: windowFocus, selectionChange +
     * visibleRangeChange for every visible editor, a synthetic fileSwitch
     * seeding the active editor, and terminalOpenClose('opened') for every
     * currently-open terminal. Panel-visibility seeds are supplied by
     * Startup-Contributors registered from the provider layer.
     */
    private _captureInitialStateEvents(generation: number): void {
        // 1. Window focus.
        try {
            this._recordInternal(
                {
                    type: 'windowFocus',
                    timestamp: Date.now(),
                    focused: vscode.window.state.focused,
                },
                { allowDuringStartup: true },
                generation,
            );
        } catch (err) {
            logger.error('Failed to emit initial windowFocus', LogCategory.TELEMETRY, err);
        }

        // 2. Selection + visible range for every visible file editor.
        for (const editor of vscode.window.visibleTextEditors) {
            if (!shouldRecordUri(editor.document.uri, this._exerciseRootUri)) {
                continue;
            }
            try {
                this._recordInternal(
                    collectSelectionChange(editor, undefined),
                    { allowDuringStartup: true },
                    generation,
                );
                this._recordInternal(
                    collectVisibleRangeChange(editor),
                    { allowDuringStartup: true },
                    generation,
                );
            } catch (err) {
                logger.error('Failed to emit initial editor state', LogCategory.TELEMETRY, err);
            }
        }

        // 3. fileSwitch for the active editor (if any).
        const activeUri = vscode.window.activeTextEditor?.document.uri.toString();
        if (activeUri) {
            this._recordInternal(
                { type: 'fileSwitch', timestamp: Date.now(), fromUri: undefined, toUri: activeUri },
                { allowDuringStartup: true },
                generation,
            );
            this._lastActiveEditorUri = activeUri;
        }

        // 4. terminalOpenClose('opened') for every already-open terminal.
        for (const terminal of vscode.window.terminals) {
            this._recordInternal(
                {
                    type: 'terminalOpenClose',
                    timestamp: Date.now(),
                    action: 'opened',
                    terminalName: terminal.name,
                },
                { allowDuringStartup: true },
                generation,
            );
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

    private async _captureFirstOpenSnapshot(editor: vscode.TextEditor, generation: number): Promise<void> {
        try {
            await this._snapshotDocument(editor.document.uri.toString(), editor.document.getText(), generation, false);
        } catch (err) {
            logger.error('Failed to capture first-open file snapshot', LogCategory.TELEMETRY, err);
        }
    }
}
