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
import type { WebSocketMessageHandler, ResultDTO } from '../../../types';
import type { RecordedEvent, SerializedErrorSnapshot } from './types';

/**
 * Distributive `Omit` over `RecordedEvent` — keeps each union variant intact
 * after stripping the `timestamp` discriminator-adjacent field.
 */
type RecordedEventWithoutTimestamp = RecordedEvent extends infer E
    ? E extends RecordedEvent
        ? Omit<E, 'timestamp'>
        : never
    : never;
import type { PlatformCapabilities } from '../../../theia';
import type { ExerciseRegistry } from '../../exerciseRegistry';
import { RecordingStorageWriter } from './storageWriter';
import { collectBuildResult } from './eventCollectors';
import { shouldAcceptBuildResult } from '../buildResultGuard';
import { logger, LogCategory } from '../../loggingService';
import { RecorderLifecycleState, type RecorderPhase as RecorderPhaseFromState } from './lifecycle/recorderLifecycleState';
import { LifecycleController } from './lifecycle/lifecycleController';
import { SnapshotManager } from './snapshots/snapshotManager';
import { StartupCapture, type StartupContext as StartupContextFromModule, type StartupContributor as StartupContributorFromModule } from './startup/startupCapture';
import { ObservationRegistry } from './observation/observationRegistry';

interface RecordingState {
    isEnabled: boolean;
    isRecording: boolean;
    exerciseId: number | undefined;
    eventCount: number;
}

type StartupContext = StartupContextFromModule;
type StartupContributor = StartupContributorFromModule;

type RecorderPhase = RecorderPhaseFromState;

export class SessionRecorder implements vscode.Disposable, WebSocketMessageHandler {
    // ── Dispose guard ─────────────────────────────────────────────────

    private _disposed = false;

    // ── Lifecycle state (phase + generation + active session) ─────────

    private readonly _state = new RecorderLifecycleState();

    // Forwarding getters — used internally by record-phase guards and by
    // whitebox tests. Writes go through explicit _state.* methods.
    private get _phase(): RecorderPhase { return this._state.phase; }
    private get _currentGeneration(): number { return this._state.currentGeneration; }
    private get _activeExerciseId(): number | undefined { return this._state.activeSession?.exerciseId; }
    private get _eventCount(): number { return this._state.activeSession?.eventCount ?? 0; }

    // ── Session state ──────────────────────────────────────────────────

    private readonly _snapshots: SnapshotManager;
    private readonly _observation: ObservationRegistry;

    // Test-access shims (getters only). Forward to ObservationRegistry —
    // existing sessionRecorder.test.ts whiteboxes these per-URI maps.
    private get _pendingSelectionPayloads(): Map<string, RecordedEvent> {
        return (this._observation as unknown as { _pendingSelectionPayloads: Map<string, RecordedEvent> })._pendingSelectionPayloads;
    }
    private get _pendingVisibleRangePayloads(): Map<string, RecordedEvent> {
        return (this._observation as unknown as { _pendingVisibleRangePayloads: Map<string, RecordedEvent> })._pendingVisibleRangePayloads;
    }

    private readonly _writer: RecordingStorageWriter;
    private readonly _startup: StartupCapture;

    private readonly _onDidChangeState = new vscode.EventEmitter<RecordingState>();
    public readonly onDidChangeState = this._onDidChangeState.event;

    private readonly _capabilities?: PlatformCapabilities;
    private readonly _exerciseRegistry?: ExerciseRegistry;

    private readonly _lifecycle: LifecycleController;

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
            record: (event, opts, gen) => this._lifecycle.recordInternal(event, opts, gen),
            lifecycleAppend: event => this._lifecycle.writeLifecycleEvent(event),
        });
        this._startup = new StartupCapture({
            record: (event, opts, gen) => this._lifecycle.recordInternal(event, opts, gen),
        });
        this._observation = new ObservationRegistry({
            state: this._state,
            snapshots: this._snapshots,
            record: (event, opts, gen) => this._lifecycle.recordInternal(event, opts, gen),
            capabilities: this._capabilities,
        });
        this._lifecycle = new LifecycleController({
            state: this._state,
            writer: this._writer,
            snapshots: this._snapshots,
            observation: this._observation,
            startup: this._startup,
            onStateChange: () => this._fireStateChange(),
        });
    }

    // ── Public state accessors ────────────────────────────────────────

    get isEnabled(): boolean { return this._state.isEnabled; }
    get isRecording(): boolean { return this._state.isRecording; }
    get activeExerciseId(): number | undefined { return this._state.activeSession?.exerciseId; }
    get eventCount(): number { return this._state.activeSession?.eventCount ?? 0; }

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

    // ── Enable / Disable (delegated to LifecycleController) ──────────

    enable(): void {
        this._lifecycle.enable();
    }

    disable(): void {
        this._lifecycle.disable();
    }

    // ── Session lifecycle (delegated) ────────────────────────────────

    async startSession(exerciseId: number, participantId?: string, exerciseRoot?: string): Promise<void> {
        return this._lifecycle.startSession(exerciseId, participantId, exerciseRoot);
    }

    async endSession(reason: 'user-end' | 'deactivate' = 'user-end'): Promise<void> {
        return this._lifecycle.endSession(reason);
    }

    // ── WebSocketMessageHandler ───────────────────────────────────────

    onNewResult(result: ResultDTO): void {
        if (this._phase !== 'recording') {
            return;
        }
        if (!shouldAcceptBuildResult(result, this._activeExerciseId, this._exerciseRegistry)) {
            return;
        }
        this._lifecycle.recordInternal(
            collectBuildResult(result, this._activeExerciseId),
            {},
            this._currentGeneration,
        );
    }

    // ── Public recording methods for chat / view / EQ / lifecycle events ──
    //
    // The public `record*` wrappers below are thin shells around `_record`,
    // which centralises the phase check, the timestamp, the generation capture,
    // and the empty-opts call to `LifecycleController.recordInternal`. Keep
    // these methods this shape — anything that needs custom `opts`, a
    // pre-existing timestamp (e.g. from a collector), or a different
    // generation snapshot must go through `_lifecycle.recordInternal` directly
    // and is NOT a candidate for this helper.

    /**
     * Centralised recording helper for the public `record*` methods.
     * Captures the phase guard, the synchronous `Date.now()` timestamp, and
     * the current generation in one place so the wrapper methods stay
     * declarative payloads.
     *
     * `timestamp` is spread first so the field stays near the head of the
     * serialised JSON line (preserves byte-level layout of existing
     * recordings against the pre-refactor structure).
     *
     * `RecordedEventWithoutTimestamp` is a *distributive* omit — the built-in
     * `Omit<RecordedEvent, 'timestamp'>` collapses the discriminated union and
     * drops per-variant fields like `action`, `eq`, `panel`, etc.
     */
    private _record(event: RecordedEventWithoutTimestamp): void {
        if (this._phase !== 'recording') {
            return;
        }
        this._lifecycle.recordInternal(
            { timestamp: Date.now(), ...event } as RecordedEvent,
            {},
            this._currentGeneration,
        );
    }

    recordIrisChatSent(
        text: string,
        messageId?: string,
        sessionId?: string,
        sentAt?: number,
    ): void {
        this._record({
            type: 'irisChatMessage',
            direction: 'sent',
            content: text,
            messageId,
            sessionId,
            sentAt,
        });
    }

    recordIrisChatReceived(
        content: string,
        messageId?: string,
        sessionId?: string,
        sentAt?: number,
    ): void {
        this._record({
            type: 'irisChatMessage',
            direction: 'received',
            content,
            messageId,
            sessionId,
            sentAt,
        });
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
        this._record({
            type: 'irisChatSendAttempt',
            content,
            status,
            errorMessage,
        });
    }

    /**
     * Record a helpful/unhelpful feedback submission for an Iris message.
     */
    recordIrisChatFeedback(messageId: string, helpful: boolean): void {
        this._record({
            type: 'irisChatFeedback',
            messageId,
            helpful,
        });
    }

    /**
     * Record a test-results-overview view opened event.
     */
    recordTestResultsOverviewOpened(payload: {
        viewId: string;
        exerciseId: number;
        participationId?: number;
        resultId?: number;
        totalTests: number;
        passedTests: number;
        failedTests: number;
    }): void {
        this._record({
            type: 'testResultsOverviewView',
            action: 'opened',
            ...payload,
        });
    }

    /**
     * Record a test-results-overview view closed event.
     */
    recordTestResultsOverviewClosed(payload: {
        viewId: string;
        exerciseId: number;
        participationId?: number;
        resultId?: number;
        durationMs: number;
        closeReason: 'button' | 'escape';
    }): void {
        this._record({
            type: 'testResultsOverviewView',
            action: 'closed',
            ...payload,
        });
    }

    /**
     * Record a task-feedback view opened event.
     */
    recordTaskFeedbackOpened(payload: {
        viewId: string;
        exerciseId: number;
        participationId?: number;
        resultId?: number;
        taskName: string;
        testIds: number[];
        totalTests: number;
        passedTests: number;
        failedTests: number;
    }): void {
        this._record({
            type: 'taskFeedbackView',
            action: 'opened',
            ...payload,
        });
    }

    /**
     * Record a task-feedback view closed event.
     */
    recordTaskFeedbackClosed(payload: {
        viewId: string;
        exerciseId: number;
        participationId?: number;
        resultId?: number;
        taskName: string;
        durationMs: number;
        closeReason: 'button' | 'escape';
    }): void {
        this._record({
            type: 'taskFeedbackView',
            action: 'closed',
            ...payload,
        });
    }

    recordEqSnapshot(
        eq: number,
        confidence: 'sufficient' | 'insufficient',
        source: 'save' | 'build' | 'trigger',
        triggerType?: string,
    ): void {
        this._record({
            type: 'eqSnapshot',
            eq,
            confidence,
            source,
            triggerType,
        });
    }

    recordIntervention(
        action: 'shown' | 'accepted' | 'dismissed' | 'blocked' | 'suppressed',
        level: 'subtle' | 'notification' | 'proactive',
        shouldIntervene: boolean,
        eq: number,
        confidence: 'sufficient' | 'insufficient',
        triggerType?: 'execution-error' | 'multiline-paste' | 'idle' | 'selection-maintained',
        opts?: {
            blockedReason?: 'cooldown' | 'warmup' | 'session-limit' | 'low-confidence';
            suppressionReason?: 'user-disabled';
            dismissReason?: 'user-action' | 'hidden' | 'replaced' | 'session-end';
            rawWanted?: boolean;
        },
    ): void {
        this._record({
            type: 'intervention',
            action,
            level,
            shouldIntervene,
            eq,
            confidence,
            triggerType,
            blockedReason: opts?.blockedReason,
            suppressionReason: opts?.suppressionReason,
            dismissReason: opts?.dismissReason,
            rawWanted: opts?.rawWanted,
        });
    }

    recordViewNavigation(from: string, to: string): void {
        this._record({
            type: 'viewNavigation',
            from,
            to,
        });
    }

    recordPanelVisibility(panel: 'artemis' | 'chat', visible: boolean): void {
        this._record({
            type: 'panelVisibility',
            panel,
            visible,
        });
    }

    recordConfigurationSnapshot(struggleDetectionEnabled: boolean, showInterventions: boolean): void {
        this._record({
            type: 'configurationSnapshot',
            struggleDetectionEnabled,
            showInterventions,
        });
    }

    recordConfigurationChange(changes: {
        struggleDetectionEnabled?: boolean;
        showInterventions?: boolean;
    }): void {
        this._record({
            type: 'configurationChange',
            changes,
        });
    }

    recordEqEngineState(
        snapshots: SerializedErrorSnapshot[],
        currentEQ: number,
        pairCount: number,
        confidence: 'sufficient' | 'insufficient',
    ): void {
        this._record({
            type: 'eqEngineState',
            snapshots,
            currentEQ,
            pairCount,
            confidence,
        });
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
        await this._lifecycle.drainPending();
        this._observation.disposeSubscriptions();
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



}
